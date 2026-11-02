/**
 * The controlled index deployment command (scripts/indexes.ts) end to end, on throwaway databases on this machine:
 * it never goes near a remote database without approval, a read-only audit changes nothing, apply only ever ADDS missing
 * indexes (for the models asked for), never drops or alters an existing one, and refuses a unique index that duplicates
 * would make fail. Also the control for the policy: with automatic indexes ON connecting creates collections, with OFF none.
 *
 *   node tests/index-deployment-cli.test.mjs
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

const tsNode = (script, args = [], uri = "", extraEnv = {}) => {
  // Type-checking is done by `tsc` for the whole project; skipping it here makes each run seconds instead of minutes.
  const env = { ...process.env, ...extraEnv, TS_NODE_TRANSPILE_ONLY: "true" };
  delete env.MONGOOSE_AUTO_INDEX;
  if (extraEnv.MONGOOSE_AUTO_INDEX !== undefined) env.MONGOOSE_AUTO_INDEX = extraEnv.MONGOOSE_AUTO_INDEX;
  if (uri) env.MONGODB_URI = uri;
  else delete env.MONGODB_URI;
  const result = spawnSync("npx", ["ts-node", "-P", "tsconfig.testrun.json", "-r", "tsconfig-paths/register", script, ...args], { cwd: repo, env, encoding: "utf8", shell: true, timeout: 240_000 });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};
const indexes = (uri, ...args) => tsNode("scripts/indexes.ts", args, uri);

const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 3000 });
const created = [];
const freshDb = () => {
  const name = `whyte_indexcli_${randomBytes(5).toString("hex")}`;
  created.push(name);
  return { name, uri: `mongodb://127.0.0.1:27017/${name}`, db: client.db(name) };
};
const collectionNames = async (db) => (await db.listCollections().toArray()).map((c) => c.name).sort();
let exitCode = 0;

try {
  await client.connect();

  // ── nothing to connect to: the listing, and the refusals ──
  const listing = tsNode("scripts/indexes.ts", ["list"]);
  assert.equal(listing.code, 0, listing.out.slice(-400));
  assert.match(listing.out, /\d+ models, \d+ declared indexes\./);
  assert.match(listing.out, /FollowUpTask \(followuptasks\): \d+ declared/);
  assert.match(listing.out, /one_open_task_per_lead\s+\{ companyId: 1, leadId: 1 \}\s+UNIQUE\s+PARTIAL/);

  const remote = "mongodb+srv://someone:secret@cluster0.example.invalid/live_database";
  for (const [label, args, env] of [
    ["an audit of a remote database", ["audit"], {}],
    ["--allow-remote without approval", ["audit", "--allow-remote"], {}],
    ["an apply with the audit approval only", ["apply", "--models=FollowUpTask", "--apply", "--allow-remote"], { INDEX_AUDIT_APPROVED: "yes" }],
    ["an apply with the deploy approval but no --allow-remote", ["apply", "--models=FollowUpTask", "--apply"], { INDEX_DEPLOY_APPROVED: "yes" }],
  ]) {
    const result = tsNode("scripts/indexes.ts", args, remote, env);
    assert.equal(result.code, 2, `${label}: ${result.out.slice(0, 200)}`);
    assert.match(result.out, /Refusing to run against cluster0\.example\.invalid/, label);
    assert.ok(!result.out.includes("secret"), `${label}: the password is never printed`);
  }
  assert.equal(tsNode("scripts/indexes.ts", ["audit"], "").code, 2, "no MONGODB_URI");
  const scratch = freshDb();
  assert.equal(indexes(scratch.uri, "apply").code, 2, "apply needs to be told what to create");
  assert.equal(indexes(scratch.uri, "apply", "--models=NoSuchModel").code, 2, "an unknown model is refused");
  assert.deepEqual(await collectionNames(scratch.db), [], "refusals changed nothing");
  pass("the listing needs no database; a remote database, a missing approval, an unscoped apply and an unknown model are all refused before anything is touched, with no credentials printed");

  // ── a read-only audit and a plan change nothing ──
  const audit = indexes(scratch.uri, "audit", "--check-unique", "--models=FollowUpTask,Lead");
  assert.equal(audit.code, 0, audit.out.slice(-600));
  assert.match(audit.out, /MISSING\s+one_open_task_per_lead/);
  assert.match(audit.out, /Summary: 2 models, \d+ declared indexes: 0 present, \d+ missing/);
  const plan = indexes(scratch.uri, "apply", "--models=FollowUpTask");
  assert.equal(plan.code, 0);
  assert.match(plan.out, /This was the plan only/);
  assert.deepEqual(await collectionNames(scratch.db), [], "neither the audit nor the plan created a collection or an index");
  pass("audit (even with the duplicate check) and a plan without --apply create nothing");

  // ── apply creates only what was asked for, and is safe to repeat ──
  const applied = indexes(scratch.uri, "apply", "--apply", "--models=FollowUpTask");
  assert.equal(applied.code, 0, applied.out.slice(-600));
  assert.match(applied.out, /FollowUpTask: created \d+ \(.*one_open_task_per_lead/);
  const taskIndexes = await scratch.db.collection("followuptasks").indexes();
  const oneOpen = taskIndexes.find((index) => index.name === "one_open_task_per_lead");
  assert.ok(oneOpen && oneOpen.unique === true && JSON.stringify(oneOpen.partialFilterExpression) === JSON.stringify({ status: "open" }), "created exactly as declared");
  assert.deepEqual(await collectionNames(scratch.db), ["followuptasks"], "only the model asked for got a collection");
  const again = indexes(scratch.uri, "apply", "--apply", "--models=FollowUpTask");
  assert.equal(again.code, 0);
  assert.ok(!/created \d+/.test(again.out), "nothing left to create the second time");
  const verify = indexes(scratch.uri, "audit", "--models=FollowUpTask");
  assert.match(verify.out, /Summary: 1 models, \d+ declared indexes: \d+ present, 0 missing \(0 unique\), 0 conflicting/);
  pass("apply creates the missing indexes of the models asked for, exactly as declared, and nothing for any other model; repeating it does nothing");

  // ── never drops or alters what exists ──
  await scratch.db.collection("followuptasks").createIndex({ legacyField: 1 }, { name: "legacy_leftover" });
  const withExtra = indexes(scratch.uri, "apply", "--apply", "--models=FollowUpTask");
  assert.equal(withExtra.code, 0);
  assert.ok((await scratch.db.collection("followuptasks").indexes()).some((index) => index.name === "legacy_leftover"), "an index nobody declares is kept");
  assert.match(indexes(scratch.uri, "audit", "--models=FollowUpTask").out, /extra\s+legacy_leftover/);

  const conflicted = freshDb();
  await conflicted.db.collection("followuptasks").createIndex({ companyId: 1, leadId: 1 }, { name: "one_open_task_per_lead" }); // not unique, not partial
  const conflictRun = indexes(conflicted.uri, "apply", "--apply", "--models=FollowUpTask");
  assert.equal(conflictRun.code, 1, conflictRun.out.slice(-500));
  assert.match(conflictRun.out, /CONFLICT\s+one_open_task_per_lead/);
  assert.match(conflictRun.out, /NOT created one_open_task_per_lead: .*left untouched/);
  const stillTheSame = (await conflicted.db.collection("followuptasks").indexes()).find((index) => index.name === "one_open_task_per_lead");
  assert.ok(stillTheSame && !stillTheSame.unique && !stillTheSame.partialFilterExpression, "the conflicting index was not dropped, rebuilt or changed");
  pass("an index that exists is never dropped or changed: extras are kept, and a same-name index with another definition is reported as a conflict and left exactly as it is (exit code 1)");

  // ── a unique index that duplicates would break is refused ──
  const duplicated = freshDb();
  const task = (id) => ({ _id: id, companyId: 1, leadId: "L1", ownerId: 5, dueAt: new Date(), status: "open", version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: 5, createdAt: new Date(), updatedAt: new Date() });
  await duplicated.db.collection("followuptasks").insertMany([task("t1"), task("t2")]);
  const dupAudit = indexes(duplicated.uri, "audit", "--check-unique", "--models=FollowUpTask");
  assert.match(dupAudit.out, /MISSING\s+one_open_task_per_lead.*1 duplicate group\(s\)/);
  assert.match(dupAudit.out, /WARNING: 1 missing unique index\(es\) would fail to build/);
  assert.ok(!/L1/.test(dupAudit.out), "the report counts duplicates; it never prints the values");
  const dupApply = indexes(duplicated.uri, "apply", "--apply", "--models=FollowUpTask");
  assert.equal(dupApply.code, 1, dupApply.out.slice(-500));
  assert.match(dupApply.out, /NOT created one_open_task_per_lead: 1 group\(s\) of documents share this key/);
  const afterDup = (await duplicated.db.collection("followuptasks").indexes()).map((index) => index.name);
  assert.ok(!afterDup.includes("one_open_task_per_lead"), "the unique index was not attempted");
  assert.ok(afterDup.length > 1, "the other, harmless indexes were still created");
  assert.equal(await duplicated.db.collection("followuptasks").countDocuments({}), 2, "no data was touched");
  pass("a missing unique index whose key already has duplicates is reported (counts only) and not created; the other indexes still are, and no data is touched");

  // ── the control: what the policy actually changes ──
  const off = freshDb();
  const probeOff = tsNode("tests/helpers/connectProbe.ts", [], off.uri, { MONGOOSE_AUTO_INDEX: "0" });
  assert.equal(probeOff.code, 0, probeOff.out.slice(-400));
  assert.equal(JSON.parse(probeOff.out.match(/\{"collections":\d+\}/)[0]).collections, 0, "automatic indexes OFF: connecting creates nothing");
  const on = freshDb();
  const probeOn = tsNode("tests/helpers/connectProbe.ts", [], on.uri, { MONGOOSE_AUTO_INDEX: "1" });
  assert.equal(probeOn.code, 0, probeOn.out.slice(-400));
  assert.ok(JSON.parse(probeOn.out.match(/\{"collections":\d+\}/)[0]).collections >= 20, "automatic indexes ON: the same connect creates a collection for every model (this is what production no longer does)");
  pass("control: with automatic indexes ON connecting creates a collection for every model; with them OFF (production) it creates none");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  for (const name of created) await client.db(name).dropDatabase().catch(() => undefined);
  await client.close().catch(() => undefined);
  process.exit(exitCode);
}
