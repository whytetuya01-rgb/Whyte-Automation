/**
 * Tenant backfill planner: explicit orphan exceptions. Runs against a
 * throwaway database on the local loopback MongoDB (never the real one), and
 * checks that the planner is read-only and deterministic.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/tenant-backfill-orphans.test.ts
 *   (set TS_NODE_TRANSPILE_ONLY=1 to skip type-checking)
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { planTenantBackfill } from "../src/lib/migrations/tenantBackfillPlan";
import { KNOWN_ORPHAN_EXCEPTIONS } from "../src/lib/migrations/knownOrphans";
import { readOnlyDb } from "../src/lib/migrations/readOnlyDb";
import { DEFAULT_COMPANY_SLUG } from "../src/lib/tenant/constants";

const results: string[] = [];
const pass = (name: string) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};
let exitCode = 0;

async function snapshot(db: ReturnType<MongoClient["db"]>): Promise<string> {
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  const parts: unknown[] = [];
  for (const n of names) parts.push([n, await db.collection(n).find({}).sort({ _id: 1 }).toArray(), (await db.collection(n).indexes()).map((i) => i.name).sort()]);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function main() {
  const dbName = `whyte_backfill_orphans_test_${randomBytes(6).toString("hex")}`;
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const raw = client.db(dbName);
  try {
    await raw.collection("companies").insertOne({ _id: 1 as never, name: "Whyte Automations", slug: DEFAULT_COMPANY_SLUG, status: "active" });
    await raw.collection("counters").insertMany([{ _id: "product" as never, seq: 400 }, { _id: "productVariant" as never, seq: 10 }, { _id: "adminUser" as never, seq: 10 }]);
    await raw.collection("categories").insertOne({ _id: 1 as never, name: "Cat", level: 1 });
    await raw.collection("products").insertMany([
      { _id: 331 as never, name: "Orphan product", categoryId: 9 }, // documented exception: Category 9 is gone
      { _id: 10 as never, name: "Fine product", categoryId: 1 },
    ]);
    await raw.collection("productvarianthistories").insertMany([
      { _id: 1 as never, productId: 329 }, // documented exception
      { _id: 3 as never, productId: 330 }, // documented exception
    ]);
    await raw.collection("quotationauditevents").insertOne({ _id: "qa_muxohfaj_epbspc960" as never, quotationId: "q_muxohf8v_bm58z4x" }); // documented exception

    const db = readOnlyDb(raw);

    // 1. the default list is exactly the documented exceptions
    assert.deepEqual(
      KNOWN_ORPHAN_EXCEPTIONS.map((e) => `${e.collection}:${e.id}:${e.field}:${e.missingValue}`),
      [
        "products:331:categoryId:9",
        "productvarianthistories:1:productId:329",
        "productvarianthistories:2:productId:329",
        "productvarianthistories:3:productId:330",
        "productvarianthistories:4:productId:330",
        "productvarianthistories:5:productId:330",
        "productvarianthistories:6:productId:330",
        "quotationauditevents:qa_muxohfaj_epbspc960:quotationId:q_muxohf8v_bm58z4x",
        "quotationauditevents:qa_mv0egai7_5p11hki60:quotationId:q_mv0egac0_kf969om",
      ],
    );
    assert.ok(KNOWN_ORPHAN_EXCEPTIONS.every((e) => e.reason.length > 20));
    pass("the exception list is explicit: each entry names collection, record id, field and missing parent with a reason");

    // 2. documented orphans are preserved, not errors
    const report = await planTenantBackfill(db, {});
    const missing = report.diagnostics.filter((d) => d.code === "MISSING_REFERENCE");
    assert.deepEqual(missing, [], "no documented orphan is an error");
    const kept = report.diagnostics.filter((d) => d.code === "KNOWN_ORPHAN_PRESERVED");
    assert.deepEqual(
      kept.map((d) => `${d.collection}:${d.id}`),
      ["products:331", "productvarianthistories:1", "productvarianthistories:3", "quotationauditevents:qa_muxohfaj_epbspc960"],
    );
    assert.ok(kept.every((d) => d.severity === "info"));
    assert.equal(report.orphanExceptions.declared, KNOWN_ORPHAN_EXCEPTIONS.length);
    assert.equal(report.orphanExceptions.preserved.length, 4);
    // exceptions not present in this fixture are reported as unused, never silently ignored
    const unused = report.diagnostics.filter((d) => d.code === "KNOWN_ORPHAN_EXCEPTION_UNUSED");
    assert.equal(unused.length, KNOWN_ORPHAN_EXCEPTIONS.length - 4);
    assert.ok(unused.every((d) => d.severity === "warning"));
    assert.equal(report.diagnostics.filter((d) => d.severity === "error").length, 0, JSON.stringify(report.diagnostics.filter((d) => d.severity === "error")));
    assert.equal(report.ok, true);
    // preserved orphans are still assigned to the default company like other legacy records (updated, not errored)
    const products = report.collections.find((c) => c.collection === "products")!;
    assert.deepEqual([products.total, products.update, products.error], [2, 2, 0]);
    pass("documented orphans are preserved (info), still planned for the default company, and stale exceptions are warned about");

    // 3. a NEW orphan is still an error and the plan is not safe
    await raw.collection("products").insertOne({ _id: 500 as never, name: "New orphan", categoryId: 77 });
    const withNew = await planTenantBackfill(db, {});
    const err = withNew.diagnostics.filter((d) => d.code === "MISSING_REFERENCE");
    assert.deepEqual(err.map((d) => `${d.collection}:${d.id}`), ["products:500"]);
    assert.equal(err[0].severity, "error");
    assert.equal(withNew.ok, false);
    pass("a new, unexplained orphan is an error and ok is false");

    // 4. the same record pointing at a DIFFERENT missing parent is not covered by the exception
    await raw.collection("products").deleteOne({ _id: 500 as never });
    await raw.collection("products").updateOne({ _id: 331 as never }, { $set: { categoryId: 12 } });
    const changed = await planTenantBackfill(db, {});
    assert.deepEqual(changed.diagnostics.filter((d) => d.code === "MISSING_REFERENCE").map((d) => `${d.collection}:${d.id}`), ["products:331"]);
    assert.equal(changed.ok, false);
    await raw.collection("products").updateOne({ _id: 331 as never }, { $set: { categoryId: 9 } });
    pass("an exception is exact: the same record with a different missing parent is still an error");

    // 5. an empty exception list makes every documented orphan blocking again
    const strict = await planTenantBackfill(db, { knownOrphans: [] });
    assert.equal(strict.diagnostics.filter((d) => d.code === "MISSING_REFERENCE").length, 4);
    assert.equal(strict.ok, false);
    pass("with no exceptions declared, every orphan blocks (the list is the only way to allow one)");

    // 6. read-only + deterministic
    const before = await snapshot(raw);
    const a = await planTenantBackfill(db, {});
    const b = await planTenantBackfill(db, {});
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(await snapshot(raw), before, "documents and indexes are byte-identical after planning");
    pass("planning is deterministic and leaves every document and index unchanged");
  } finally {
    await client.db(dbName).dropDatabase();
    await client.close();
  }
  console.log(`\nTenant backfill orphan exceptions PASSED (${results.length} checks).`);
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
}).finally(() => process.exit(exitCode));
