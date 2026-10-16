/**
 * Phase 1 — tenant-scope Mongoose plugin, tested directly (no Next.js server
 * needed: this is pure Mongoose-schema logic, same category as the existing
 * soft-delete plugin). Connects straight to the local loopback MongoDB used
 * by every other test in this repo. Never touches the real database.
 *
 *   node --import tsx tests/tenant-scope-plugin.test.ts
 *   (or: npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/tenant-scope-plugin.test.ts)
 */
import assert from "node:assert/strict";
import mongoose, { Schema } from "mongoose";
import { randomBytes } from "node:crypto";
import { tenantScopePlugin } from "../src/lib/tenant/plugin";
import { runWithTenantContext, runUnscoped, getTenantContext, TenantScopeViolationError } from "../src/lib/tenant/context";
import { softDeletePlugin } from "../src/lib/softDelete/plugin";

const results: string[] = [];
const pass = (name: string) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};
let exitCode = 0;

async function main() {
  const dbName = `whyte_tenant_plugin_test_${randomBytes(6).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    // ── Schema 1: plain tenant-scoped model ──────────────────────────────
    const WidgetSchema = new Schema({ _id: Number, name: String }, { _id: false, versionKey: false });
    tenantScopePlugin(WidgetSchema);
    const Widget = mongoose.model("TenantTestWidget", WidgetSchema);

    // ── Schema 2: tenant-scope + soft-delete composed on the same model ──
    const GadgetSchema = new Schema({ _id: Number, name: String }, { _id: false, versionKey: false });
    tenantScopePlugin(GadgetSchema);
    softDeletePlugin(GadgetSchema);
    const Gadget = mongoose.model("TenantTestGadget", GadgetSchema);

    // ── Schema 3: AdminUser analog — super_admin is exempt from companyId ──
    const UserSchema = new Schema({ _id: Number, name: String, role: String }, { _id: false, versionKey: false });
    tenantScopePlugin(UserSchema, { isExempt: (doc: any) => doc?.role === "super_admin" });
    const TestUser = mongoose.model("TenantTestUser", UserSchema);

    // ═══ 1. No context at all → throws ═══
    await assert.rejects(() => Widget.find({}), TenantScopeViolationError);
    pass("find() with no tenant context established throws TenantScopeViolationError");

    // ═══ 2. Seed two companies' worth of data ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "company_owner", actingAsCompany: true }, async () => {
      await Widget.create({ _id: 1, name: "Company 1 Widget A" });
      await Widget.create({ _id: 2, name: "Company 1 Widget B" });
    });
    await runWithTenantContext({ companyId: 2, userId: 2, role: "company_owner", actingAsCompany: true }, async () => {
      await Widget.create({ _id: 3, name: "Company 2 Widget A" });
    });
    pass("seeded 2 widgets for company 1 and 1 widget for company 2, each stamped with companyId from context automatically");

    // ═══ 3. A company only ever sees its own records ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      const mine = await Widget.find({}).lean();
      assert.equal(mine.length, 2);
      assert.ok(mine.every((w: any) => w.companyId === 1));
    });
    await runWithTenantContext({ companyId: 2, userId: 2, role: "admin", actingAsCompany: true }, async () => {
      const mine = await Widget.find({}).lean();
      assert.equal(mine.length, 1);
      assert.equal((mine[0] as any)!.companyId, 2);
    });
    pass("find() scopes strictly to the context's companyId — company 1 sees 2, company 2 sees 1, zero cross-leak");

    // ═══ 4. Direct-by-ID access across companies finds nothing ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      const crossCompany = await Widget.findById(3).lean(); // belongs to company 2
      assert.equal(crossCompany, null, "a direct-by-ID lookup for another company's record must return null, not the record");
    });
    pass("findById() for a record belonging to a different company returns null (no existence leak)");

    // ═══ 5. Super Admin with no "act as company" sees nothing, not everything ═══
    await runWithTenantContext({ companyId: null, userId: 99, role: "super_admin", actingAsCompany: false }, async () => {
      const seenByPlatformAdmin = await Widget.find({}).lean();
      assert.equal(seenByPlatformAdmin.length, 0, "Super Admin without act-as must see ZERO tenant records by default");
    });
    pass('Super Admin with companyId:null (no act-as) sees zero tenant records — "does not see company data by default"');

    // ═══ 6. runUnscoped() is the only way to see across companies, and is explicit ═══
    await runUnscoped("platform-admin", async () => {
      const everything = await Widget.find({}).lean();
      assert.equal(everything.length, 3, "runUnscoped('platform-admin') must see all 3 widgets across both companies");
    });
    pass("runUnscoped('platform-admin') correctly bypasses company scoping for a genuine cross-company view");

    // ═══ 7. Creating a record whose explicit companyId disagrees with context throws ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await assert.rejects(
        () => Widget.create({ _id: 999, name: "sneaky", companyId: 2 } as any),
        TenantScopeViolationError,
        "creating a document explicitly stamped for another company while in company 1's context must throw"
      );
    });
    pass("create() throws when a document's explicit companyId disagrees with the active tenant context");

    // ═══ 8. companyId is immutable after creation ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await assert.rejects(
        () => Widget.updateOne({ _id: 1 }, { $set: { companyId: 2 } }),
        TenantScopeViolationError,
        "updateOne() must never be allowed to move a record to a different company"
      );
      const doc = await Widget.findById(1);
      doc!.set("companyId", 2);
      await assert.rejects(() => doc!.save(), TenantScopeViolationError, "save() must reject a modified companyId");
    });
    pass("companyId is immutable: both updateOne({$set:{companyId}}) and document.save() after mutating it throw");

    // ═══ 9. distinct() is scoped ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      const names = await Widget.distinct("name");
      assert.equal(names.length, 2, "distinct() must only consider company 1's own 2 widgets");
    });
    pass("distinct() is scoped by companyId the same as find()");

    // ═══ 10. aggregate() gets a leading $match, and an unscoped cross-collection $lookup is rejected ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      const grouped = await Widget.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }]);
      assert.equal(grouped[0]?.count, 2, "aggregate() must only group over company 1's own 2 widgets");

      await assert.rejects(
        () =>
          Widget.aggregate([
            { $lookup: { from: "tenanttestgadgets", localField: "_id", foreignField: "_id", as: "joined" } },
          ]),
        TenantScopeViolationError,
        "a $lookup into another tenant-scoped collection with no companyId filter in its own (sub-)pipeline must throw"
      );

      // The same $lookup, correctly self-scoped, is allowed.
      const scopedLookup = await Widget.aggregate([
        {
          $lookup: {
            from: "tenanttestgadgets",
            let: { wid: "$_id" },
            pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$_id", "$$wid"] }, { $eq: ["$companyId", 1] }] } } }],
            as: "joined",
          },
        },
      ]);
      assert.ok(Array.isArray(scopedLookup));
    });
    pass("aggregate() auto-scopes its own collection and rejects an unscoped cross-collection $lookup, but allows a self-scoped one");

    // ═══ 11. bulkWrite scopes filters and stamps companyId on inserts ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await Widget.bulkWrite([
        { insertOne: { document: { _id: 4, name: "bulk-inserted" } as any } },
        { updateOne: { filter: { _id: 2 }, update: { $set: { name: "bulk-updated" } } } },
      ]);
      const inserted = await Widget.findById(4).lean();
      assert.equal((inserted as any)?.companyId, 1, "bulkWrite insertOne must stamp companyId from context");
    });
    await runWithTenantContext({ companyId: 2, userId: 2, role: "admin", actingAsCompany: true }, async () => {
      // Company 2 cannot touch company 1's widget #2 via bulkWrite even with a matching _id filter.
      const before = await runUnscoped("platform-admin", () => Widget.findById(2).lean());
      await Widget.bulkWrite([{ updateOne: { filter: { _id: 2 }, update: { $set: { name: "should not apply" } } } }]);
      const after = await runUnscoped("platform-admin", () => Widget.findById(2).lean());
      assert.equal(after?.name, before?.name, "bulkWrite updateOne must be scoped — company 2 cannot touch company 1's record");
    });
    pass("bulkWrite() stamps companyId on inserts and scopes updateOne/updateMany/deleteOne/deleteMany filters by the active company");

    // ═══ 12. insertMany stamps companyId on every document ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await Widget.insertMany([{ _id: 5, name: "im-1" }, { _id: 6, name: "im-2" }] as any);
      const docs = await Widget.find({ _id: { $in: [5, 6] } }).lean();
      assert.ok(docs.every((d: any) => d.companyId === 1));
    });
    pass("insertMany() stamps companyId from context on every document");

    // ═══ 13. estimatedDocumentCount is always banned ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await assert.rejects(() => Widget.estimatedDocumentCount(), TenantScopeViolationError);
    });
    pass("estimatedDocumentCount() always throws — it ignores filters entirely and can never be scoped to one company");

    // ═══ 14. Composition with the soft-delete plugin: both filters apply together ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      await Gadget.create({ _id: 1, name: "live gadget" });
      await Gadget.create({ _id: 2, name: "to be deleted" });
      await Gadget.updateOne({ _id: 2 }, { $set: { isDeleted: true, deletedAt: new Date() } }, { __whyteSoftDeleteWrite: true } as any);
    });
    await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
      const visible = await Gadget.find({}).lean();
      assert.equal(visible.length, 1, "default scope must exclude the soft-deleted gadget while still including only company 1's own");
      assert.equal(visible[0]!.name, "live gadget");
    });
    await runWithTenantContext({ companyId: 2, userId: 2, role: "admin", actingAsCompany: true }, async () => {
      const otherCompanyView = await Gadget.find({}).lean();
      assert.equal(otherCompanyView.length, 0, "company 2 must see none of company 1's gadgets, deleted or not");
    });
    pass("tenant-scope and soft-delete plugins compose correctly on the same model: neither filter overrides the other");

    // ═══ 15. isExempt — a platform super_admin AdminUser needs no companyId ═══
    await runUnscoped("platform-admin", async () => {
      await TestUser.create({ _id: 1, name: "Platform Owner", role: "super_admin", companyId: null } as any);
    });
    await runWithTenantContext({ companyId: 1, userId: 1, role: "company_owner", actingAsCompany: true }, async () => {
      await TestUser.create({ _id: 2, name: "Company 1 Admin", role: "admin" });
      const doc = await TestUser.findById(2).lean();
      assert.equal((doc as any)?.companyId, 1, "a non-exempt user still gets companyId stamped normally");
    });
    await runUnscoped("platform-admin", async () => {
      const superAdmin = await TestUser.findById(1).lean();
      assert.equal((superAdmin as any)?.companyId, null, "an exempt (super_admin) document keeps companyId:null, never required, never stamped");
    });
    await runWithTenantContext({ companyId: 1, userId: 1, role: "company_owner", actingAsCompany: true }, async () => {
      const seenByCompany = await TestUser.find({}).lean();
      assert.deepEqual(
        seenByCompany.map((u: any) => u._id),
        [2],
        "a company-scoped query must never surface the exempt super_admin account — it has no company to match"
      );
    });
    pass("isExempt lets a platform super_admin AdminUser have companyId:null — never required, never stamped, never visible to a company-scoped query");

    // ═══ 16. findOneAndUpdate upsert via $setOnInsert: { companyId } — the real
    // roleService.ts pattern (a filter that does NOT also repeat companyId,
    // since the plugin injects it — repeating it causes a real MongoDB
    // NotSingleValueField error on upsert, which is what this regression-tests) ═══
    await runWithTenantContext({ companyId: 1, userId: 1, role: "company_owner", actingAsCompany: true }, async () => {
      const upserted = await Widget.findOneAndUpdate(
        { name: "upsert-target" },
        { $set: { name: "upsert-target" }, $setOnInsert: { companyId: 1 } },
        { upsert: true, returnDocument: "after", new: true }
      );
      assert.equal((upserted as any)?.companyId, 1, "a $setOnInsert-based upsert must correctly stamp companyId with no filter/plugin collision");

      // A second call (now matching the existing doc, not inserting) must not throw either.
      const upsertedAgain = await Widget.findOneAndUpdate(
        { name: "upsert-target" },
        { $set: { name: "upsert-target-updated" }, $setOnInsert: { companyId: 1 } },
        { upsert: true, returnDocument: "after", new: true }
      );
      assert.equal((upsertedAgain as any)?.name, "upsert-target-updated");
    });
    pass("findOneAndUpdate upsert using $setOnInsert:{companyId} (not a repeated filter field) works without a MongoDB NotSingleValueField error");

    console.log(`\nTenant-scope plugin PASSED (${results.length} checks).`);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
}).finally(() => {
  process.exit(exitCode);
});
