/**
 * Company-context regression guards (no HTTP server): the footer/quotation-page company lookups must never fall back
 * to "the first company in the collection", and the tenant plugin must keep quotations with a missing, null or
 * unknown companyId invisible to every company. The HTTP side (footer per user, Super Admin platform / act-as,
 * quotation page branding, theme/company writes) is in tests/tenant-company-context.test.mjs.
 *
 * Throwaway database on the local loopback MongoDB; never the real one.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/tenant-company-context.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import mongoose from "mongoose";
import { getFooterCompany } from "../src/lib/footerCompany";
import { Company, Quotation } from "../src/models";
import { runUnscoped, runWithTenantContext } from "../src/lib/tenant/context";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const root = join(__dirname, "..");
const ctxA = { companyId: 1, userId: 11, role: "admin", actingAsCompany: false };
const ctxB = { companyId: 2, userId: 22, role: "admin", actingAsCompany: false };
const now = new Date();
type Doc = Record<string, unknown>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

async function main() {
  // ── static guards ──
  const offenders = sourceFiles(join(root, "src"))
    .filter((file) => /Company\.findOne\(\s*\)/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
  assert.deepEqual(offenders, [], `an unfiltered Company.findOne() picks an arbitrary company: ${offenders.join(", ")}`);
  pass("no unfiltered Company.findOne() anywhere in src/");

  assert.equal(existsSync(join(root, "src", "lib", "siteTheme.ts")), false, "the unused unscoped getSiteTheme helper is deleted");
  const importsSiteTheme = sourceFiles(join(root, "src")).filter((file) => /lib\/siteTheme/.test(readFileSync(file, "utf8")));
  assert.deepEqual(importsSiteTheme, [], "nothing imports the deleted siteTheme helper");
  pass("the unused unscoped getSiteTheme helper is gone and nothing imports it");

  const footerSource = readFileSync(join(root, "src", "lib", "footerCompany.ts"), "utf8");
  assert.ok(/getAuthenticatedActor\(\)/.test(footerSource) && /Company\.findById\(companyId\)/.test(footerSource), "footer resolves the company from the trusted actor");
  const pageSource = readFileSync(join(root, "src", "app", "(app)", "quotation", "[id]", "page.tsx"), "utf8");
  assert.ok(/Company\.findById\(companyId\)/.test(pageSource), "quotation page looks the company up by the trusted companyId");
  pass("footer and quotation page look the company up by the trusted server-side companyId");

  const dbName = `whyte_tenant_company_ctx_${randomBytes(5).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  let failed = false;
  try {
    const insert = async (name: string, docs: Doc[]) => {
      await mongoose.connection.collection(name).insertMany(docs);
    };
    // Insertion order matters: a pending-review and a soft-deleted company come FIRST, which is exactly what an
    // unfiltered findOne() would have returned.
    await insert("companies", [
      { _id: 5, name: "Pending Leak Co", slug: "pending-leak", status: "pending", registrationStatus: "pending_review", phone: "5", email: "leak@pending.example", address: "x", isDeleted: false, createdAt: now, updatedAt: now },
      { _id: 6, name: "Deleted Leak Co", slug: "deleted-leak", status: "active", phone: "6", email: "leak@deleted.example", address: "x", isDeleted: true, createdAt: now, updatedAt: now },
      { _id: 1, name: "Alpha Automation", slug: "alpha", status: "active", phone: "+91 90000 10000", email: "alpha@alpha.example", address: "1 Alpha Street", gstNumber: "27AAAAA0000A1Z5", tagline: "Alpha tagline", isDeleted: false, createdAt: now, updatedAt: now },
      { _id: 2, name: "Beta Builders", slug: "beta", status: "active", phone: "+91 80000 20000", email: "beta@beta.example", address: "2 Beta Street", gstNumber: "29BBBBB0000B1Z5", tagline: "Beta tagline", isDeleted: false, createdAt: now, updatedAt: now },
    ]);

    // 3. No request / no company context: the neutral fallback, never an arbitrary company.
    const none = await getFooterCompany();
    assert.deepEqual({ ...none, socialLinks: undefined }, { name: "Whyte Automations", tagline: null, phone: null, email: null, socialLinks: undefined });
    assert.deepEqual(none.socialLinks.map((link) => link.id), ["linkedin", "instagram", "youtube", "facebook"], "the platform context carries the platform's own social links");
    const insideCompanyContext = await runWithTenantContext(ctxB, () => getFooterCompany());
    assert.equal(insideCompanyContext.name, "Whyte Automations", "an ambient tenant context alone (no session) must not select a company");
    const platform = await runUnscoped("platform-admin", () => getFooterCompany());
    assert.equal(platform.name, "Whyte Automations");
    pass("getFooterCompany() with no authenticated session returns the neutral fallback, with or without an ambient tenant context");

    // Company is the tenant table: an unfiltered findOne() DOES return the first live company (why the fix is needed),
    // and a soft-deleted company is never returned.
    const arbitrary = await runWithTenantContext(ctxB, async () => await Company.findOne().lean());
    assert.equal(arbitrary?.name, "Pending Leak Co", "documents the old failure mode: first live company, here a pending-review one");
    assert.equal(await Company.findById(6).lean(), null, "a soft-deleted company is not found by id");
    assert.equal((await Company.findById(2).lean())?.name, "Beta Builders");
    pass("by-id lookups return exactly the requested live company; soft-deleted companies are never returned");

    // 9 / 10. Quotation access stays tenant-scoped; missing / null / unknown companyId fails closed.
    await insert("quotations", [
      { _id: "q_of_a", companyId: 1, quotationNumber: "A-1", clientName: "A client", status: "draft", isDeleted: false, createdAt: now, updatedAt: now },
      { _id: "q_missing", quotationNumber: "N-1", clientName: "orphan", status: "draft", isDeleted: false, createdAt: now, updatedAt: now },
      { _id: "q_null", companyId: null, quotationNumber: "N-2", clientName: "orphan", status: "draft", isDeleted: false, createdAt: now, updatedAt: now },
      { _id: "q_unknown", companyId: 999, quotationNumber: "N-3", clientName: "bad", status: "draft", isDeleted: false, createdAt: now, updatedAt: now },
    ]);
    const find = (ctx: typeof ctxA | null, id: string) =>
      ctx ? runWithTenantContext(ctx, async () => await Quotation.findById(id).lean()) : runUnscoped("platform-admin", async () => await Quotation.findById(id).lean());
    assert.ok(await find(ctxA, "q_of_a"));
    assert.equal(await find(ctxB, "q_of_a"), null, "Company B cannot load Company A's quotation");
    for (const id of ["q_missing", "q_null", "q_unknown"]) {
      assert.equal(await find(ctxA, id), null, `${id} invisible to company A`);
      assert.equal(await find(ctxB, id), null, `${id} invisible to company B`);
      assert.ok(await find(null, id), `${id} still exists (visible only to the authorized platform-admin path)`);
    }
    await runWithTenantContext({ ...ctxA, companyId: null }, async () => {
      assert.equal(await Quotation.findById("q_of_a").lean(), null, "Super Admin without an act-as company sees no quotation");
    });
    pass("cross-company, missing, null and unknown-companyId quotations are not loadable under any company context (fail closed)");

    console.log(`\n${count} tests passed.`);
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
  process.exit(failed ? 1 : 0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
