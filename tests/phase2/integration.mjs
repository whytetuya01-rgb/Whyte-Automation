import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rootRequire = createRequire(join(repo, "package.json"));
const { MongoClient } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

function checkSafeTarget(uri, dbName) {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "test MongoDB must use mongodb://");
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017", "test MongoDB port must be local default");
  assert.equal(parsed.username, "", "test MongoDB must not include credentials");
  assert.equal(parsed.password, "", "test MongoDB must not include credentials");
  assert.equal(parsed.pathname, `/${dbName}`, "URI database must match generated test database");
  assert.deepEqual([...parsed.searchParams.keys()], ["directConnection"], "test MongoDB URI has unexpected options");
  assert.equal(parsed.searchParams.get("directConnection"), "true");
  assert.match(dbName, /^whyte_quotation_phase2_test_[0-9]{8}_[a-f0-9]{12}$/);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated Next server exited early (${child.exitCode}): ${output()}`);
    try {
      const response = await fetch(`${baseUrl}/register`);
      if (response.status === 200) return;
    } catch { /* server is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`isolated Next server did not become ready: ${output()}`);
}

async function assertCase(name, fn, results) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const dbName = `whyte_quotation_phase2_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
const mongoUri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
const secret = randomBytes(48).toString("base64url");
const testEmail = `dealer-${randomUUID()}@phase2.test`;
const dealerPassword = `Dealer-${randomBytes(18).toString("base64url")}!`;
const dealerRegistration = {
  firstName: "Phase",
  lastName: "Dealer",
  email: testEmail,
  password: dealerPassword,
  gstNumber: "27aabcu9603r1zm",
  contactNumber: "+91 98765 43210",
  address: "  42 Whyte Road, Pune, Maharashtra 411001  ",
};
const staff = ["super_admin", "admin", "sales"].map((role) => ({
  role,
  email: `${role}-${randomUUID()}@phase2.test`,
  password: `Staff-${randomBytes(18).toString("base64url")}!`,
}));
let tempRoot;
let child;
let mongo;
let serverOutput = "";
const results = [];

try {
  // Validate the exact target and confirm local Mongo availability before starting Next or writing data.
  checkSafeTarget(mongoUri, dbName);
  mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
  await mongo.connect();
  await mongo.db(dbName).command({ ping: 1 });
  console.log(`Safety checks PASS: loopback MongoDB reachable; isolated database ${dbName}.`);

  tempRoot = await mkdtemp(join(tmpdir(), "whyte-phase2-isolated-"));
  await mkdir(join(tempRoot, ".next-phase2-test"));
  await cp(join(repo, "src"), join(tempRoot, "src"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(tempRoot, "node_modules"), "junction");
  await symlink(join(repo, "public"), join(tempRoot, "public"), "junction");
  await copyFile(join(repo, "tsconfig.json"), join(tempRoot, "tsconfig.json"));
  await copyFile(join(repo, "postcss.config.mjs"), join(tempRoot, "postcss.config.mjs"));
  await writeFile(join(tempRoot, "package.json"), JSON.stringify({ private: true, scripts: { dev: "next dev --webpack" } }));
  await writeFile(join(tempRoot, "next.config.mjs"), `
    const isolated = process.env.PHASE2_ISOLATED_TEST_RUN === "1";
    const distDir = isolated ? process.env.PHASE2_TEST_DIST_DIR : ".next";
    if (isolated && distDir !== ".next-phase2-test") {
      throw new Error("Isolated Phase 2 test config safety check failed");
    }
    export default { distDir: distDir || ".next", images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] } };
  `);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = join(repo, "node_modules", "next", "dist", "bin", "next");
  const safeEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: "development",
    MONGODB_URI: mongoUri,
    NEXTAUTH_SECRET: secret,
    NEXTAUTH_URL: baseUrl,
    PHASE2_ISOLATED_TEST_RUN: "1",
    PHASE2_TEST_DIST_DIR: ".next-phase2-test",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  child = spawn(process.execPath, [nextCli, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: tempRoot,
    env: safeEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer(baseUrl, child, () => serverOutput.slice(-3000));
  const database = mongo.db(dbName);
  const accounts = database.collection("adminusers");

  const register = (body) => fetch(`${baseUrl}/api/admin/register`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let dealerAccount;
  let successfulRegistrationBody;
  await assertCase("public login and registration routes are available", async () => {
    for (const path of ["/login", "/register", "/admin/login"]) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 200, `${path} was unavailable`);
    }
  }, results);
  await assertCase("valid Dealer registration", async () => {
    const response = await register(dealerRegistration);
    assert.equal(response.status, 201);
    successfulRegistrationBody = await response.text();
    const body = JSON.parse(successfulRegistrationBody);
    assert.equal(body.data.role, "dealer");
    assert.equal(body.data.email, testEmail);
    assert.equal(typeof body.data.id, "number");
    dealerAccount = await accounts.findOne({ email: testEmail });
    assert.ok(dealerAccount);
    assert.equal(dealerAccount.role, "dealer");
    assert.equal(dealerAccount.isActive, true);
    assert.equal(dealerAccount.firstName, "Phase");
    assert.equal(dealerAccount.lastName, "Dealer");
    assert.equal(dealerAccount.name, "Phase Dealer");
    assert.equal(dealerAccount.gstNumber, "27AABCU9603R1ZM");
    assert.equal(dealerAccount.contactNumber, "+91 98765 43210");
    assert.equal(dealerAccount.address, "42 Whyte Road, Pune, Maharashtra 411001");
    assert.notEqual(dealerAccount.passwordHash, dealerPassword);
    assert.equal(await bcrypt.compare(dealerPassword, dealerAccount.passwordHash), true);
  }, results);

  await assertCase("duplicate email rejection", async () => {
    const response = await register({ ...dealerRegistration, email: testEmail.toUpperCase() });
    assert.equal(response.status, 409);
  }, results);

  await assertCase("invalid input and extra-field rejection", async () => {
    const before = await accounts.countDocuments();
    for (const payload of [
      { ...dealerRegistration, firstName: "", email: "bad", password: "tiny" },
      { ...dealerRegistration, email: `inject-${randomUUID()}@phase2.test`, role: "super_admin" },
      { ...dealerRegistration, email: `inject-${randomUUID()}@phase2.test`, contactNumber: "123", isActive: false, permissions: ["all"], discount: 90 },
    ]) assert.equal((await register(payload)).status, 400);
    assert.equal(await accounts.countDocuments(), before);
  }, results);

  await assertCase("registration response excludes password hash", async () => {
    assert.ok(dealerAccount);
    assert.ok(successfulRegistrationBody);
    assert.equal(successfulRegistrationBody.includes(dealerAccount.passwordHash), false);
    assert.equal(successfulRegistrationBody.includes(dealerPassword), false);
    const decoded = JSON.parse(successfulRegistrationBody);
    assert.equal("passwordHash" in decoded.data, false);
    assert.equal("password" in decoded.data, false);
  }, results);

  const cookieStore = new Map();
  async function signIn(email, password) {
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.status, 200);
    for (const cookie of csrfResponse.headers.getSetCookie()) cookieStore.set(cookie.split(";")[0].split("=")[0], cookie.split(";")[0].slice(cookie.split(";")[0].indexOf("=") + 1));
    const csrf = (await csrfResponse.json()).csrfToken;
    const form = new URLSearchParams({ csrfToken: csrf, email, password, callbackUrl: `${baseUrl}/`, json: "true" });
    const callback = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: [...cookieStore].map(([key, value]) => `${key}=${value}`).join("; ") },
      body: form.toString(), redirect: "manual",
    });
    for (const cookie of callback.headers.getSetCookie()) cookieStore.set(cookie.split(";")[0].split("=")[0], cookie.split(";")[0].slice(cookie.split(";")[0].indexOf("=") + 1));
    assert.ok(callback.status === 200 || (callback.status >= 300 && callback.status < 400), `credentials callback returned ${callback.status}`);
    return [...cookieStore].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  let dealerCookie;
  await assertCase("Dealer login and session role propagation", async () => {
    dealerCookie = await signIn(testEmail, dealerPassword);
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: dealerCookie } });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.user.role, "dealer");
    assert.equal(String(session.user.id), String(dealerAccount._id));
  }, results);

  await assertCase("Dealer redirected to /dealer/access", async () => {
    assert.ok(dealerCookie);
    const response = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie: dealerCookie }, redirect: "manual" });
    assert.ok(response.status >= 300 && response.status < 400, `expected redirect, got ${response.status}`);
    assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/dealer/access");
  }, results);

  await assertCase("Dealer business API denied with 403", async () => {
    const response = await fetch(`${baseUrl}/api/products`, { headers: { cookie: dealerCookie } });
    assert.equal(response.status, 403);
  }, results);

  await assertCase("logged-out API returns 401", async () => {
    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 401);
  }, results);

  await assertCase("Dealer landing page allowed", async () => {
    const response = await fetch(`${baseUrl}/dealer/access`, { headers: { cookie: dealerCookie } });
    assert.equal(response.status, 200);
  }, results);

  await assertCase("staff-role access remains available", async () => {
    for (let index = 0; index < staff.length; index += 1) {
      const account = staff[index];
      const passwordHash = await bcrypt.hash(account.password, 12);
      await accounts.insertOne({ _id: dealerAccount._id + index + 1, email: account.email, passwordHash, name: `Test ${account.role}`, role: account.role, isActive: true, createdAt: new Date() });
      const cookie = await signIn(account.email, account.password);
      const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })).json();
      assert.equal(session.user.role, account.role);
      assert.equal((await fetch(`${baseUrl}/api/products`, { headers: { cookie } })).status, 200, `${account.role} API denied`);
      const page = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie }, redirect: "manual" });
      assert.equal(page.status, 200, `${account.role} admin page denied`);
    }
  }, results);

  console.log(`Database used: ${dbName} (mongodb://127.0.0.1:27017; credentials omitted).`);
} catch (error) {
  console.error(`BLOCKED before completion: ${error instanceof Error ? error.message : String(error)}`);
  if (serverOutput) console.error(`Isolated server output: ${serverOutput.slice(-3000)}`);
  process.exitCode = 2;
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, "exit"), new Promise((resolveStop) => setTimeout(resolveStop, 5000))]);
  }
  if (mongo) await mongo.close();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
