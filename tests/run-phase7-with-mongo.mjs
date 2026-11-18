import { spawn } from "node:child_process";
import { MongoClient } from "mongodb";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MONGOD_PATH = "C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe";
const PORT = 27017;
const REPLSET = "rs0";
const DB_DIR = join(tmpdir(), `whyte-phase7-mongo-${Date.now()}`);

if (existsSync(DB_DIR)) rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });

console.log(`Starting mongod on 127.0.0.1:${PORT} with replica set ${REPLSET}...`);
const mongod = spawn(
  MONGOD_PATH,
  [
    "--dbpath", DB_DIR,
    "--port", String(PORT),
    "--bind_ip", "127.0.0.1",
    "--replSet", REPLSET,
    "--logpath", join(DB_DIR, "mongod.log"),
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

async function main() {
  await new Promise((r) => setTimeout(r, 3500));
  const client = new MongoClient(`mongodb://127.0.0.1:${PORT}/?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const admin = client.db("admin");

  try {
    await admin.command({
      replSetInitiate: {
        _id: REPLSET,
        members: [{ _id: 0, host: `127.0.0.1:${PORT}` }],
      },
    });
    console.log("Replica set rs.initiate() succeeded.");
  } catch (err) {
    if (!err.message.includes("already initialized")) throw err;
  }

  let isWritable = false;
  for (let i = 0; i < 30; i++) {
    const status = await admin.command({ hello: 1 });
    if (status.isWritablePrimary) {
      isWritable = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!isWritable) throw new Error("Replica set failed to elect a primary");

  await client.close();
  console.log("MongoDB replica set is up and writable. Launching phase7-real-application-e2e.mjs...\n");

  const runner = spawn("node", ["tests/phase7-real-application-e2e.mjs"], {
    stdio: "inherit",
    env: { ...process.env, TEST_MONGODB_URI: `mongodb://127.0.0.1:${PORT}` },
  });

  await new Promise((resolve, reject) => {
    runner.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`phase7-real-application-e2e exited with code ${code}`));
    });
  });
}

main()
  .catch((err) => {
    console.error("Error during Phase 7 E2E run:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    mongod.kill("SIGKILL");
    console.log("MongoDB process shut down.");
    setTimeout(() => {
      try {
        if (existsSync(DB_DIR)) rmSync(DB_DIR, { recursive: true, force: true });
      } catch {}
    }, 1000);
  });
