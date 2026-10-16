/**
 * Quotation numbering on an ISOLATED copy. Loopback MongoDB only (the script
 * refuses any other host); it can never reach Atlas or the real database.
 *
 * It rebuilds the production situation from a read-only extract (numbers,
 * counters, quotation indexes, company), supplied as JSON via NUMBERING_EXTRACT
 * (a file produced by a find()/indexes()-only export; see the report), then
 * replays the planned migration steps on the copy and proves that the next
 * number cannot collide. Without NUMBERING_EXTRACT it uses a synthetic extract
 * with the same shape (legacy numbers QT-2026-005..054 with gaps, one tagged
 * QT-2026-001, legacy counter 54, per-company counter 1, global unique index).
 *
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-numbering-rehearsal.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { MongoClient } from "mongodb";

const results: string[] = [];
const pass = (name: string) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};
let exitCode = 0;

type Extract = {
  quotations: Array<{ _id: string; quotationNumber: string; companyId?: number | null; createdAt?: string }>;
  counters: Array<{ _id: string; seq: number }>;
  quotationIndexes: Array<Record<string, unknown> & { name: string; key: Record<string, number> }>;
  companies: Array<Record<string, unknown> & { _id: number }>;
};

function syntheticExtract(): Extract {
  const legacy = [5, 6, 7, 8, 9, 11, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52, 53, 54];
  const pad = (n: number) => String(n).padStart(3, "0");
  return {
    quotations: [
      { _id: "q_tagged", quotationNumber: "QT-2026-001", companyId: 1 },
      ...legacy.map((n) => ({ _id: `q_legacy_${n}`, quotationNumber: `QT-2026-${pad(n)}` })),
    ],
    counters: [{ _id: "quotationNumber_2026", seq: 54 }, { _id: "quotationNumber_1_2026", seq: 1 }],
    quotationIndexes: [
      { name: "quotationNumber_1", key: { quotationNumber: 1 }, unique: true },
      { name: "companyId_1_quotationNumber_1", key: { companyId: 1, quotationNumber: 1 }, unique: true },
    ],
    companies: [{ _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "pending" }],
  };
}

async function main() {
  const extract: Extract = process.env.NUMBERING_EXTRACT ? JSON.parse(fs.readFileSync(process.env.NUMBERING_EXTRACT, "utf8")) : syntheticExtract();
  const source = process.env.NUMBERING_EXTRACT ? "read-only extract of production" : "synthetic extract";
  console.log(`  (data source: ${source}; ${extract.quotations.length} quotations)`);
  const originalNumbers = extract.quotations.map((q) => q.quotationNumber).sort();

  const client = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const created: string[] = [];

  /** Builds a fresh isolated database holding the "restored" production state. */
  async function restore(label: string) {
    const dbName = `whyte_numbering_rehearsal_${label}_${randomBytes(5).toString("hex")}`;
    created.push(dbName);
    const db = client.db(dbName);
    await db.collection("quotations").insertMany(extract.quotations.map((q) => ({ ...q, createdAt: q.createdAt ? new Date(q.createdAt) : new Date(), isDeleted: false })) as never[]);
    await db.collection("counters").insertMany(extract.counters as never[]);
    await db.collection("companies").insertMany(extract.companies as never[]);
    for (const idx of extract.quotationIndexes) {
      if (idx.name === "_id_") continue;
      const { key, name, v: _v, ns: _ns, ...options } = idx as Record<string, unknown>;
      await db.collection("quotations").createIndex(key as Record<string, 1 | -1>, { ...(options as object), name: name as string });
    }
    return { dbName, db, uri: `mongodb://127.0.0.1:27017/${dbName}?directConnection=true` };
  }

  /** Loads the repo's own numbering code bound to `uri` (a fresh module graph per scenario). */
  async function loadApp(uri: string) {
    assert.ok(/^mongodb:\/\/127\.0\.0\.1:27017\/whyte_numbering_rehearsal_/.test(uri), "refusing a non-loopback / non-rehearsal database");
    process.env.MONGODB_URI = uri;
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect().catch(() => {});
    const { connectMongoDB } = await import("../src/lib/mongodb");
    const counter = await import("../src/lib/counter");
    const ctx = await import("../src/lib/tenant/context");
    const { Quotation } = await import("../src/models/Quotation");
    await connectMongoDB();
    assert.equal(mongoose.connection.host, "127.0.0.1");
    return { mongoose, counter, ctx, Quotation };
  }

  const issue = async (app: Awaited<ReturnType<typeof loadApp>>, db: ReturnType<MongoClient["db"]>, companyId: number, year: number, n: number) => {
    const numbers: string[] = [];
    await Promise.all(
      Array.from({ length: n }, () =>
        app.ctx.runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false } as never, async () => {
          const seq = await app.counter.getNextQuotationSequence(year);
          const quotationNumber = `QT-${year}-${String(seq).padStart(3, "0")}`;
          await db.collection("quotations").insertOne({ _id: `q_new_${companyId}_${year}_${seq}` as never, quotationNumber, companyId, createdAt: new Date(), isDeleted: false } as never);
          numbers.push(quotationNumber);
        })
      )
    );
    return numbers.sort();
  };

  try {
    // ═══ Scenario A: today's state (no backfill yet). The tenant-scoped floor cannot see untagged legacy numbers. ═══
    {
      const { db, uri } = await restore("pre");
      const app = await loadApp(uri);
      const first = await issue(app, db, 1, 2026, 1);
      assert.equal(first[0], "QT-2026-002", "counter 1 + floor 1 (only the tagged row is visible) => next is 002, a gap number");
      let collided = false;
      try {
        await issue(app, db, 1, 2026, 6);
      } catch (e) {
        collided = /E11000/.test(String((e as Error).message));
      }
      assert.equal(collided, true, "before the backfill, numbering walks into legacy QT-2026-005 and the global unique index rejects it");
      pass("BEFORE backfill: numbering for Company 1 reaches legacy QT-2026-005 and is rejected by the unique index (this is the collision the migration must prevent)");
      await app.mongoose.disconnect();
    }

    // ═══ Scenario B: backfill + counter bootstrap, but the OLD global unique index is kept ═══
    {
      const { db, uri } = await restore("keepidx");
      const app = await loadApp(uri);
      await db.collection("quotations").updateMany({ companyId: { $exists: false } }, { $set: { companyId: 1 } });
      const { planCounterBootstrap, applyCounterBootstrap } = await import("../src/lib/counterBootstrap");
      const plan = await planCounterBootstrap(db, { defaultCompanySlug: "whyte-automations" });
      assert.deepEqual(plan.conflicts.filter((c) => c.severity === "error"), []);
      await applyCounterBootstrap(db, plan);
      assert.equal((await db.collection("counters").findOne({ _id: "quotationNumber_1_2026" as never }))?.seq, 54, "counter lifted to the data maximum");
      const next = await issue(app, db, 1, 2026, 3);
      assert.deepEqual(next, ["QT-2026-055", "QT-2026-056", "QT-2026-057"]);
      // a second company legitimately wants QT-2026-001, but the old global unique index forbids it
      await db.collection("companies").insertOne({ _id: 2, name: "Second", slug: "second", status: "active" } as never);
      let rejected = false;
      try {
        await issue(app, db, 2, 2026, 2);
      } catch (e) {
        rejected = /E11000/.test(String((e as Error).message));
      }
      assert.equal(rejected, true, "with the global unique index kept, company 2's QT-2026-001 collides with company 1's");
      pass("backfill + counters alone fix Company 1 (next is 055), but keeping the old global unique index would still block a second company's numbers");
      await app.mongoose.disconnect();
    }

    // ═══ Scenario C: the full planned sequence: backfill, counters, replace the unique index ═══
    {
      const { db, uri } = await restore("full");
      const app = await loadApp(uri);
      const before = await db.collection("quotations").find({}, { projection: { quotationNumber: 1 } }).sort({ _id: 1 }).toArray();

      // 1. backfill: every legacy quotation to the default company
      await db.collection("quotations").updateMany({ companyId: { $exists: false } }, { $set: { companyId: 1 } });
      // 2. counter bootstrap (repo code)
      const { planCounterBootstrap, applyCounterBootstrap } = await import("../src/lib/counterBootstrap");
      const plan = await planCounterBootstrap(db, { defaultCompanySlug: "whyte-automations" });
      assert.deepEqual(plan.conflicts.filter((c) => c.severity === "error"), []);
      await applyCounterBootstrap(db, plan);
      const replay = await planCounterBootstrap(db, { defaultCompanySlug: "whyte-automations" });
      assert.deepEqual(replay.entries.filter((e) => e.action === "create" || e.action === "advance"), [], "bootstrap is idempotent");
      // 3. indexes: the model's own definition (drops the old global unique index, keeps the per-company unique one)
      const idxBefore = (await db.collection("quotations").indexes()).filter((i) => i.unique).map((i) => i.name).sort();
      await app.Quotation.syncIndexes();
      const idxAfter = (await db.collection("quotations").indexes()).filter((i) => i.unique).map((i) => i.name).sort();
      console.log(`  (unique indexes before: ${JSON.stringify(idxBefore)} -> after: ${JSON.stringify(idxAfter)})`);
      assert.ok(idxBefore.includes("quotationNumber_1"), "the old global unique index existed");
      assert.deepEqual(idxAfter, ["companyId_1_quotationNumber_1"], "only the per-company unique index remains unique");
      const plain = (await db.collection("quotations").indexes()).find((i) => i.name === "quotationNumber_1");
      assert.ok(plain && !plain.unique, "plain quotationNumber lookup index kept, non-unique");
      pass("index step: old global UNIQUE quotationNumber_1 becomes a plain index; (companyId, quotationNumber) stays UNIQUE");

      // all original numbers preserved byte-for-byte
      const after = await db.collection("quotations").find({}, { projection: { quotationNumber: 1 } }).sort({ _id: 1 }).toArray();
      assert.deepEqual(after.map((q) => [q._id, q.quotationNumber]), before.map((q) => [q._id, q.quotationNumber]));
      assert.deepEqual((await db.collection("quotations").find({}).toArray()).map((q) => q.quotationNumber).sort(), originalNumbers);
      pass(`all ${before.length} existing quotation numbers are unchanged`);

      // concurrency: 60 simultaneous creations, one company
      const issued = await issue(app, db, 1, 2026, 60);
      assert.equal(new Set(issued).size, 60, "no duplicates");
      const maxLegacy = Math.max(...originalNumbers.map((n) => Number(n.slice(-3))));
      const nums = issued.map((n) => Number(n.slice(-3))).sort((a, b) => a - b);
      assert.equal(nums[0], maxLegacy + 1, "starts right above the highest existing number");
      assert.deepEqual(nums, Array.from({ length: 60 }, (_, i) => maxLegacy + 1 + i), "contiguous, no reuse of gaps and no skipped values");
      for (const n of issued) assert.ok(!originalNumbers.includes(n), `${n} collides with an existing number`);
      pass(`60 concurrent creations => ${issued[0]}..${issued.at(-1)}, all distinct, none colliding with the existing numbers`);

      // a counter that falls behind the data can never hand out a taken number
      await db.collection("counters").updateOne({ _id: "quotationNumber_1_2026" as never }, { $set: { seq: 3 } });
      const afterRollback = await issue(app, db, 1, 2026, 1);
      assert.equal(afterRollback[0], `QT-2026-${String(maxLegacy + 61).padStart(3, "0")}`, "floor (max issued) beats a stale counter");
      pass("even if the counter is reset behind the data, the next number is above every issued number");

      // second company, same year: its own sequence from 1, no collision with company 1's identical numbers
      await db.collection("companies").insertOne({ _id: 2, name: "Second", slug: "second", status: "active" } as never);
      const c2 = await issue(app, db, 2, 2026, 5);
      assert.deepEqual(c2, ["QT-2026-001", "QT-2026-002", "QT-2026-003", "QT-2026-004", "QT-2026-005"]);
      let dup = false;
      try {
        await db.collection("quotations").insertOne({ _id: "dupe" as never, quotationNumber: "QT-2026-003", companyId: 2 } as never);
      } catch (e) {
        dup = /E11000/.test(String((e as Error).message));
      }
      assert.equal(dup, true, "the same number twice inside ONE company is still rejected");
      pass("a second company numbers independently from 001 without colliding; a duplicate within one company is still rejected");

      // year rollover and a soft-deleted number is never reused
      assert.deepEqual(await issue(app, db, 1, 2027, 2), ["QT-2027-001", "QT-2027-002"]);
      await db.collection("quotations").updateOne({ quotationNumber: `QT-2026-${String(maxLegacy + 5).padStart(3, "0")}`, companyId: 1 }, { $set: { isDeleted: true } });
      const afterDelete = await issue(app, db, 1, 2026, 1);
      assert.ok(Number(afterDelete[0].slice(-3)) > maxLegacy + 61, "a soft-deleted number is not reused");
      pass("a new year restarts at 001, and soft-deleted numbers are never reused");
      await app.mongoose.disconnect();
    }

    console.log(`\nQuotation numbering rehearsal PASSED (${results.length} checks).`);
  } finally {
    for (const name of created) await client.db(name).dropDatabase().catch(() => {});
    await client.close();
  }
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
}).finally(() => process.exit(exitCode));
