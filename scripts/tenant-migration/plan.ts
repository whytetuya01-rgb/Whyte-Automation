/**
 * READ-ONLY tenant backfill dry-run. Produces plan.json, the contract that migrate.mjs enforces.
 *
 *   WHYTE_MIGRATION_URI=<mongodb uri> WHYTE_MIGRATION_DB=<database> \
 *     npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/tenant-migration/plan.ts <out plan.json>
 *
 * The planner only ever receives a readOnlyDb() wrapper that throws on any write, and the client is opened with
 * secondaryPreferred reads. The URI comes from WHYTE_MIGRATION_URI only (never from .env), so this can never target
 * the application database by accident.
 */
import fs from "node:fs";
import { MongoClient } from "mongodb";
import { planTenantBackfill } from "@/lib/migrations/tenantBackfillPlan";
import { planCounterBootstrap } from "@/lib/counterBootstrap";
import { readOnlyDb } from "@/lib/migrations/readOnlyDb";

(async () => {
  const out = process.argv[2];
  const uri = process.env.WHYTE_MIGRATION_URI;
  const dbName = process.env.WHYTE_MIGRATION_DB;
  if (!out || !uri || !dbName) throw new Error("usage: WHYTE_MIGRATION_URI=… WHYTE_MIGRATION_DB=… plan.ts <out.json>");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, readPreference: "secondaryPreferred", appName: "whyte-tenant-plan-readonly" });
  await client.connect();
  try {
    const db = readOnlyDb(client.db(dbName));
    const report = await planTenantBackfill(db, {});
    const counters = await planCounterBootstrap(db, { defaultCompanySlug: report.companySlug, unassignedCompanyId: report.defaultCompany.id });
    fs.writeFileSync(out, JSON.stringify({ database: dbName, report, counters }, null, 1));
    console.log(`plan written: ${out}\n  database=${dbName} ok=${report.ok} totals=${JSON.stringify(report.totals)} diagnostics=${JSON.stringify(report.diagnosticCounts)}`);
  } finally {
    await client.close();
  }
})().catch((e) => {
  console.error("plan failed:", String((e as Error).message).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>"));
  process.exit(1);
});
