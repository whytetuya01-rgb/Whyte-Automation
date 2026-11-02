/**
 * Index policy and required transactions (src/lib/mongoIndexPolicy.ts, src/lib/transaction.ts, scripts/lib/indexAudit.ts):
 * in production the app creates no collections or indexes by itself, a missing required index gives a clear 503, the index
 * comparison is right, and a follow-up write refuses to run without transactions in production.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/index-policy.test.ts
 *
 * Uses a fresh throwaway database on 127.0.0.1 only; never reads .env files.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

async function main() {
  const dbName = `whyte_index_policy_${randomBytes(5).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}`;
  process.env.MONGODB_URI = uri;
  process.env.MONGOOSE_AUTO_INDEX = "0"; // the production policy, on a throwaway database
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(dbName);

  try {
    const { autoIndexEnabled } = await import("../src/lib/mongoIndexPolicy");
    // ── the policy ──
    for (const [env, expected] of [
      [{ NODE_ENV: "production" }, false],
      [{ NODE_ENV: "development" }, true],
      [{ NODE_ENV: "test" }, true],
      [{}, true],
      [{ NODE_ENV: "production", MONGOOSE_AUTO_INDEX: "1" }, true],
      [{ NODE_ENV: "production", MONGOOSE_AUTO_INDEX: "true" }, true],
      [{ NODE_ENV: "development", MONGOOSE_AUTO_INDEX: "0" }, false],
      [{ NODE_ENV: "development", MONGOOSE_AUTO_INDEX: "false" }, false],
      [{ NODE_ENV: "production", MONGOOSE_AUTO_INDEX: "yes" }, false],
    ] as const) {
      assert.equal(autoIndexEnabled(env as NodeJS.ProcessEnv), expected, JSON.stringify(env));
    }
    pass("automatic index creation is off in production, on elsewhere, and only an explicit 1/0 overrides it (anything else follows NODE_ENV)");

    // ── the comparison of declared and existing indexes ──
    const { compareIndexes } = await import("../scripts/lib/indexAudit");
    const declared = (name: string, keys: Record<string, number>, extra: Record<string, unknown> = {}) => ({ model: "M", collection: "ms", name, keys, unique: false, sparse: false, ...extra });
    const existing = (name: string, key: Record<string, number>, extra: Record<string, unknown> = {}) => ({ name, key, ...extra });
    const result = compareIndexes(
      [
        declared("a_1", { a: 1 }),
        declared("b_1", { b: 1 }, { unique: true }),
        declared("c_1", { c: 1 }),
        declared("d_1", { d: 1 }, { unique: true, partialFilterExpression: { status: "open" } }),
        declared("e_1", { e: 1 }),
        declared("f_1", { f: 1 }),
      ] as never,
      [
        existing("_id_", { _id: 1 }),
        existing("a_1", { a: 1 }), // identical
        existing("b_1", { b: 1 }), // same name, but not unique: a conflict
        existing("renamed_c", { c: 1 }), // same definition under another name
        existing("d_1", { d: 1 }, { unique: true, partialFilterExpression: { status: "open" } }),
        existing("e_other", { e: 1 }, { sparse: true }), // same keys, different options, other name: also a conflict
        existing("old_leftover", { z: 1 }), // not declared anywhere
      ] as never
    );
    assert.deepEqual(
      result.findings.map((finding) => [finding.declared.name, finding.status]),
      [["a_1", "present"], ["b_1", "conflict"], ["c_1", "present_under_another_name"], ["d_1", "present"], ["e_1", "conflict"], ["f_1", "missing"]]
    );
    assert.deepEqual(result.extra.map((index) => index.name), ["old_leftover"], "an index nobody declares is reported and kept (never dropped)");
    pass("the comparison tells present, present under another name, missing, conflicting (same name or same keys with other options) and extra apart");

    // ── connecting creates nothing in production ──
    const { connectMongoDB } = await import("../src/lib/mongodb");
    const { createMissingIndexes, loadAllModels } = await import("../scripts/lib/indexAudit");
    const models = await import("../src/models");
    const everyModel = await loadAllModels();
    await connectMongoDB();
    await Promise.all(everyModel.map((model) => model.init().catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name), [], "after connecting with every model loaded, the database still has no collection and no index");
    pass("with the production policy, connecting with every model loaded creates no collection and no index");

    // ── a missing required index is refused clearly, and still nothing is created ──
    const { assertIndexesDeployed, resetIndexChecksForTests } = await import("../src/lib/mongoIndexPolicy");
    const { ApiError } = await import("../src/lib/api-response");
    await assert.rejects(
      assertIndexesDeployed(models.FollowUpTask, ["one_open_task_per_lead"]),
      (error: unknown) => error instanceof ApiError && error.code === "SERVICE_UNAVAILABLE" && error.status === 503 && /index deployment/.test(error.message) && JSON.stringify(error.details).includes("one_open_task_per_lead")
    );
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name), [], "the refused check created nothing");

    // ── the controlled deployment fixes it, for that model only ──
    const deployed = await createMissingIndexes(models.FollowUpTask as never);
    assert.ok(deployed.created.includes("one_open_task_per_lead") && deployed.skipped.length === 0, JSON.stringify(deployed));
    resetIndexChecksForTests();
    await assertIndexesDeployed(models.FollowUpTask, ["one_open_task_per_lead"]);
    assert.deepEqual((await db.listCollections().toArray()).map((c) => c.name), ["followuptasks"], "only the model that was deployed has a collection");
    pass("a missing required index stops the request with a clear 503 and creates nothing; the controlled deployment adds it for that model only");

    // ── transactions in production ──
    const mongooseModule = (await import("mongoose")).default;
    const { withRequiredTransaction, resetTransactionSupportForTests } = await import("../src/lib/transaction");
    const env = process.env as Record<string, string | undefined>;
    const realNodeEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      resetTransactionSupportForTests();
      const session = await withRequiredTransaction(async (s) => s);
      assert.ok(session, "a replica set gives the operation a real transaction session, in production");

      // Pretend the database is a plain mongod (no replica set): `hello` has no setName.
      const connection = mongooseModule.connection as unknown as { db: { admin: () => { command: (c: unknown) => Promise<Record<string, unknown>> } } };
      const realAdmin = connection.db.admin;
      connection.db.admin = () => ({ command: async () => ({ ok: 1 }) });
      resetTransactionSupportForTests();
      let ran = false;
      await assert.rejects(
        withRequiredTransaction(async () => {
          ran = true;
          return "should not run";
        }),
        (error: unknown) => error instanceof ApiError && error.code === "SERVICE_UNAVAILABLE" && error.status === 503 && /replica set/.test(error.message)
      );
      assert.equal(ran, false, "production never falls back to separate writes: the operation does not even start");

      env.NODE_ENV = "development";
      const warnings: string[] = [];
      const realWarn = console.warn;
      console.warn = (...parts: unknown[]) => warnings.push(parts.join(" "));
      try {
        assert.equal(await withRequiredTransaction(async (s) => (s === undefined ? "no session" : "session")), "no session", "development and tests may run without transactions...");
        await withRequiredTransaction(async () => undefined);
      } finally {
        console.warn = realWarn;
      }
      assert.equal(warnings.filter((line) => line.includes("[transactions]")).length, 1, "...but say so, once");

      connection.db.admin = realAdmin;
      resetTransactionSupportForTests();
    } finally {
      env.NODE_ENV = realNodeEnv;
    }
    pass("follow-up writes need real transactions in production (a clear 503 and nothing runs otherwise); development and tests may fall back, explicitly and with a warning");

    console.log(`\nALL ${count} INDEX POLICY TESTS PASSED!`);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
