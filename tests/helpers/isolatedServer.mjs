import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Starts an isolated Next.js dev server against a throwaway database on the LOCAL
 * loopback MongoDB, seeds users, and returns helpers. Never touches the real DB.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rootRequire = createRequire(join(repo, "package.json"));
export const { MongoClient, Decimal128 } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolveListening) => server.once("listening", resolveListening));
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated Next server exited early (${child.exitCode}): ${output()}`);
    try {
      const response = await fetch(`${baseUrl}/register`);
      if (response.status === 200) return;
    } catch {
      /* server starting */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`isolated Next server did not become ready: ${output()}`);
}

export async function startIsolatedServer(label, users, options = {}) {
  const production = options.production === true;
  const dbName = `whyte_quotation_${label}_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
  const mongoUri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  const parsed = new URL(mongoUri);
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017");
  assert.equal(parsed.username, "");

  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
  await mongo.connect();
  await mongo.db(dbName).command({ ping: 1 });

  const tempRoot = await mkdtemp(join(tmpdir(), `whyte-${label}-isolated-`));
  const distDir = `.next-${label}-test`;
  await mkdir(join(tempRoot, distDir));
  await cp(join(repo, "src"), join(tempRoot, "src"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(tempRoot, "node_modules"), "junction");
  await symlink(join(repo, "public"), join(tempRoot, "public"), "junction");
  await copyFile(join(repo, "tsconfig.json"), join(tempRoot, "tsconfig.json"));
  await copyFile(join(repo, "postcss.config.mjs"), join(tempRoot, "postcss.config.mjs"));
  await writeFile(
    join(tempRoot, "package.json"),
    JSON.stringify({ private: true, scripts: { dev: "next dev --webpack", build: "next build --webpack", start: "next start" } })
  );
  await writeFile(
    join(tempRoot, "next.config.mjs"),
    `export default { distDir: process.env.TEST_DIST_DIR || ".next", images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] } };`
  );

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "development",
    MONGODB_URI: mongoUri,
    NEXTAUTH_SECRET: randomBytes(48).toString("base64url"),
    NEXTAUTH_URL: baseUrl,
    TEST_DIST_DIR: distDir,
  };

  const { spawn } = await import("node:child_process");
  let serverOutput = "";
  if (production) {
    // A production build hydrates reliably in a headless browser (dev-mode HMR does not).
    const build = spawn("cmd.exe", ["/d", "/s", "/c", "npm run build"], { cwd: tempRoot, env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let buildOutput = "";
    build.stdout.on("data", (chunk) => (buildOutput += chunk.toString()));
    build.stderr.on("data", (chunk) => (buildOutput += chunk.toString()));
    const code = await new Promise((resolveExit) => build.on("exit", resolveExit));
    if (code !== 0) throw new Error(`isolated next build failed (${code}): ${buildOutput.slice(-2000)}`);
  }
  const child = spawn("cmd.exe", ["/d", "/s", "/c", production ? "npm run start" : "npm run dev"], {
    cwd: tempRoot,
    env: production ? { ...env, NODE_ENV: "production" } : env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
  child.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));
  await waitForServer(baseUrl, child, () => serverOutput);

  const db = mongo.db(dbName);
  const now = new Date();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  await db.collection("adminusers").insertMany(
    users.map((u) => ({
      passwordHash,
      isActive: true,
      discountAllocationPercent: 0,
      createdAt: now,
      updatedAt: now,
      ...u,
    }))
  );

  async function login(email, portal) {
    const cookieStore = new Map();
    const remember = (response) => {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        cookieStore.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
    };
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    remember(csrfResponse);
    const csrf = (await csrfResponse.json()).csrfToken;
    const callback = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: new URLSearchParams({ csrfToken: csrf, email, password: "Password123!", portal, callbackUrl: `${baseUrl}/`, json: "true" }).toString(),
      redirect: "manual",
    });
    remember(callback);
    return [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async function api(cookie, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const data = json && typeof json === "object" && "data" in json ? json.data : json;
    return { status: res.status, json, data, text };
  }

  async function cleanup() {
    if (child && child.pid) {
      try {
        const { execSync } = await import("node:child_process");
        execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
    try {
      await mongo.db(dbName).dropDatabase();
      await mongo.close();
    } catch {
      /* ignore */
    }
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return { baseUrl, db, login, api, cleanup, dbName, getOutput: () => serverOutput };
}

export function createRunner() {
  const results = [];
  return {
    results,
    async assertCase(name, fn) {
      try {
        await fn();
        results.push({ name, status: "PASS" });
        console.log(`PASS ${name}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ name, status: "FAIL", detail });
        console.log(`FAIL ${name}: ${detail}`);
      }
    },
    summary() {
      const failed = results.filter((r) => r.status === "FAIL");
      console.log(`\n${results.length - failed.length}/${results.length} tests passed.`);
      for (const f of failed) console.log(`  FAILED: ${f.name}: ${f.detail}`);
      return failed.length;
    },
  };
}
