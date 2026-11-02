/**
 * The follow-up backfill command (scripts/backfill-follow-up-tasks.ts): the guard rails that keep it away from the live
 * database, a dry run that is really read-only, and an apply that is safe to repeat. Runs only against throwaway
 * databases on this machine; never reads .env files.
 *
 *   node tests/follow-up-backfill-cli.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

const run = (uri, args = [], extraEnv = {}) => {
  const env = { ...process.env, MONGODB_URI: uri, ...extraEnv };
  if (!uri) delete env.MONGODB_URI;
  const result = spawnSync("npx", ["ts-node", "-P", "tsconfig.testrun.json", "-r", "tsconfig-paths/register", "scripts/backfill-follow-up-tasks.ts", ...args], { cwd: repo, env, encoding: "utf8", shell: true, timeout: 180_000 });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const dbName = `whyte_followup_cli_test_${randomBytes(5).toString("hex")}`;
const localUri = `mongodb://127.0.0.1:27017/${dbName}`;
const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 3000 });
let exitCode = 0;

try {
  // ── it refuses to go anywhere but this machine, before it connects to anything ──
  const noUri = run("");
  assert.equal(noUri.code, 2);
  assert.match(noUri.out, /MONGODB_URI is not set/);
  const remote = "mongodb+srv://someone:secret@cluster0.example.invalid/live_database";
  for (const [label, args, env] of [
    ["a dry run against a remote address", [], {}],
    ["--apply against a remote address", ["--apply"], {}],
    ["--allow-remote without the approval variable", ["--apply", "--allow-remote"], {}],
    ["the approval variable without --allow-remote", ["--apply"], { FOLLOW_UP_BACKFILL_APPROVED: "yes" }],
    ["a wrong approval value", ["--apply", "--allow-remote"], { FOLLOW_UP_BACKFILL_APPROVED: "true" }],
  ]) {
    const result = run(remote, args, env);
    assert.equal(result.code, 2, `${label}: ${result.out.slice(0, 200)}`);
    assert.match(result.out, /Refusing to run against cluster0\.example\.invalid/, label);
    assert.ok(!result.out.includes("secret"), `${label}: the password is never printed`);
  }
  assert.equal(run(localUri, ["--company=abc"]).code, 2, "a bad --company value is refused");
  pass("without a database address, or against any remote address (even for a dry run, and without both the flag and the approval variable), the command refuses and prints no credentials");

  // ── a database with an old follow-up (no task) in company 1 and another in company 2 ──
  await client.connect();
  const db = client.db(dbName);
  const now = new Date();
  const due = new Date(Date.now() + 3 * 86_400_000);
  await db.collection("companies").insertMany([
    { _id: 1, name: "Company One", slug: "one", status: "active", createdAt: now, updatedAt: now },
    { _id: 2, name: "Company Two", slug: "two", status: "active", createdAt: now, updatedAt: now },
  ]);
  await db.collection("adminusers").insertMany([
    { _id: 11, companyId: 1, email: "a@one.test", name: "Admin One", role: "admin", isActive: true },
    { _id: 21, companyId: 2, email: "a@two.test", name: "Admin Two", role: "admin", isActive: true },
  ]);
  const lead = (id, companyId, createdBy, ref) => ({ _id: id, companyId, referenceNumber: ref, customerName: `Client ${id}`, status: "new", priority: "medium", createdBy, createdAt: now, updatedAt: now, nextFollowUpAt: due });
  await db.collection("leads").insertMany([lead("L1", 1, 11, "LD-1"), lead("L2", 2, 21, "LD-2")]);
  const structure = async () => {
    const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
    const leadIndexes = (await db.collection("leads").indexes()).map((i) => i.name).sort();
    return JSON.stringify({ names, leadIndexes });
  };
  const before = await structure();

  // ── a dry run reads, and changes nothing: no tasks, no new collections, no new indexes ──
  const dry = run(localUri);
  assert.equal(dry.code, 0, dry.out.slice(-600));
  assert.match(dry.out, /Mode: dry run \(read-only/);
  assert.match(dry.out, /tasks to create:\s+1/);
  assert.equal(await structure(), before, "a dry run created no collection and no index");
  assert.equal(await db.collection("followuptasks").countDocuments({}), 0);
  pass("a dry run reports what it would do and changes nothing, not even by letting the database create collections or indexes");

  // ── apply, one company at a time ──
  const onlyTwo = run(localUri, ["--apply", "--company=2"]);
  assert.equal(onlyTwo.code, 0, onlyTwo.out.slice(-600));
  const tasks = await db.collection("followuptasks").find({}).toArray();
  assert.deepEqual(tasks.map((t) => [t.leadId, t.companyId, t.ownerId, t.createdVia, t.status]), [["L2", 2, 21, "backfill", "open"]], "only the company asked for");
  assert.match(tasks[0]._id, /^ft_bf_/);
  const indexes = await db.collection("followuptasks").indexes();
  const oneOpen = indexes.find((i) => i.name === "one_open_task_per_lead");
  assert.ok(oneOpen && oneOpen.unique === true && JSON.stringify(oneOpen.partialFilterExpression) === JSON.stringify({ status: "open" }), "the one-open-task index exists before any task is written");
  assert.deepEqual((await db.collection("leads").indexes()).map((i) => i.name).sort(), JSON.parse(before).leadIndexes, "and no other collection got indexes");
  assert.match(onlyTwo.out, /Companies: 2/);

  const everything = run(localUri, ["--apply"]);
  assert.equal(everything.code, 0, everything.out.slice(-600));
  assert.deepEqual((await db.collection("followuptasks").find({}).sort({ leadId: 1 }).toArray()).map((t) => [t.leadId, t.ownerId]), [["L1", 11], ["L2", 21]]);
  const again = run(localUri, ["--apply"]);
  assert.equal(again.code, 0);
  assert.match(again.out, /"created":0/);
  assert.equal(await db.collection("followuptasks").countDocuments({}), 2, "running it again adds nothing");
  assert.ok(!/Client L|@one\.test|@two\.test/.test(`${dry.out}${onlyTwo.out}${everything.out}${again.out}`), "the output holds company names and reference numbers only: no customer names or emails");
  pass("apply creates the tasks (with the one-open-task index in place first), can be limited to one company, is safe to repeat, and prints no customer details");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  try {
    await client.db(dbName).dropDatabase();
  } catch {
    // nothing to clean up
  }
  await client.close().catch(() => undefined);
  process.exit(exitCode);
}
