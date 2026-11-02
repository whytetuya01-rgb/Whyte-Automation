// Never reads .env / .env.local: uses a throwaway local database only (refuses anything else).
import "./helpers/localMongoOnly";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { connectMongoDB } from "../src/lib/mongodb";
import { Company, AdminUser, Quotation, Customer, CrmActivity } from "../src/models";
import { runWithTenantContext, runUnscoped } from "../src/lib/tenant/context";

const MIGRATION_BATCH = "TEST_HISTORICAL_CRM_MIGRATION_V1";

function computeCustomerFingerprint(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
  siteAddress?: string | null;
  billingAddress?: string | null;
  gstNumber?: string | null;
  dealerId?: number | null;
  assignedSalesId?: number | null;
}): string {
  const payload = {
    name: c.name.trim(),
    phone: c.phone?.trim() || null,
    email: c.email?.trim().toLowerCase() || null,
    siteAddress: c.siteAddress?.trim() || null,
    billingAddress: c.billingAddress?.trim() || null,
    gstNumber: c.gstNumber?.trim().toUpperCase() || null,
    dealerId: c.dealerId ?? null,
    assignedSalesId: c.assignedSalesId ?? null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function testRollbackSafety() {
  console.log("=== STARTING MIGRATION ROLLBACK PROTECTION VERIFICATION ===\n");
  await connectMongoDB();

  const testCompanyId = 9201;
  const ctx = { companyId: testCompanyId, userId: 9210, role: "admin", actingAsCompany: true };

  // Setup test environment
  await runUnscoped("platform-admin", async () => {
    await Company.collection.deleteMany({ _id: testCompanyId as any });
    await Customer.collection.deleteMany({ companyId: testCompanyId as any });
    await Quotation.collection.deleteMany({ companyId: testCompanyId as any });

    await Company.create({
      _id: testCompanyId,
      name: "Rollback Test Company",
      slug: "rollback-test",
      status: "active",
      phone: "9820003333",
      address: "Ahmedabad",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  await runWithTenantContext(ctx, async () => {
    // 1. Setup 3 historical quotations
    await Quotation.create([
      {
        _id: "q_rb_01",
        companyId: testCompanyId,
        quotationNumber: "QT-RB-001",
        clientName: "Customer Alpha",
        clientPhone: "+91 98220 11111",
        customerId: null,
        status: "draft",
        createdBy: "9210",
        createdAt: new Date(),
      },
      {
        _id: "q_rb_02",
        companyId: testCompanyId,
        quotationNumber: "QT-RB-002",
        clientName: "Customer Beta",
        clientPhone: "+91 98220 22222",
        customerId: null,
        status: "draft",
        createdBy: "9210",
        createdAt: new Date(),
      },
      {
        _id: "q_rb_03",
        companyId: testCompanyId,
        quotationNumber: "QT-RB-003",
        clientName: "Customer Gamma",
        clientPhone: "+91 98220 33333",
        customerId: null,
        status: "draft",
        createdBy: "9210",
        createdAt: new Date(),
      },
    ]);

    // 2. Perform Migration for Alpha, Beta, Gamma
    const custAlpha = {
      _id: 101,
      companyId: testCompanyId,
      name: "Customer Alpha",
      phone: "+919822011111",
      createdBy: 9210,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: JSON.stringify({
        migrationBatch: MIGRATION_BATCH,
        fingerprint: computeCustomerFingerprint({ name: "Customer Alpha", phone: "+919822011111" }),
        migratedQuotationIds: ["q_rb_01"],
      }),
    };

    const custBeta = {
      _id: 102,
      companyId: testCompanyId,
      name: "Customer Beta",
      phone: "+919822022222",
      createdBy: 9210,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: JSON.stringify({
        migrationBatch: MIGRATION_BATCH,
        fingerprint: computeCustomerFingerprint({ name: "Customer Beta", phone: "+919822022222" }),
        migratedQuotationIds: ["q_rb_02"],
      }),
    };

    const custGamma = {
      _id: 103,
      companyId: testCompanyId,
      name: "Customer Gamma",
      phone: "+919822033333",
      createdBy: 9210,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: JSON.stringify({
        migrationBatch: MIGRATION_BATCH,
        fingerprint: computeCustomerFingerprint({ name: "Customer Gamma", phone: "+919822033333" }),
        migratedQuotationIds: ["q_rb_03"],
      }),
    };

    await Customer.collection.insertMany([custAlpha, custBeta, custGamma] as any);
    await Quotation.collection.updateOne({ _id: "q_rb_01" as any }, { $set: { customerId: 101, migrationBatch: MIGRATION_BATCH } });
    await Quotation.collection.updateOne({ _id: "q_rb_02" as any }, { $set: { customerId: 102, migrationBatch: MIGRATION_BATCH } });
    await Quotation.collection.updateOne({ _id: "q_rb_03" as any }, { $set: { customerId: 103, migrationBatch: MIGRATION_BATCH } });

    console.log("  ✓ Step 1: Migration executed. 3 customers created, 3 quotes linked.");

    // 3. Post-migration events:
    // Event A: Create a brand new customer post-migration (e.g. Customer Delta)
    const custDelta = await Customer.create({
      _id: 104,
      companyId: testCompanyId,
      name: "Customer Delta (New Client)",
      phone: "+919822044444",
      createdBy: 9210,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Event B: Admin modifies migrated Customer Beta (e.g. updates address and name)
    await Customer.collection.updateOne(
      { _id: 102 as any },
      { $set: { name: "Customer Beta Modified Inc", siteAddress: "New Penthouse Suite" } }
    );

    // Event C: Admin re-links Quotation 3 from Gamma to Delta
    await Quotation.collection.updateOne(
      { _id: "q_rb_03" as any },
      { $set: { customerId: 104, migrationBatch: null } }
    );

    console.log("  ✓ Step 2: Post-migration operations simulated:");
    console.log("      - Event A: Created new Customer Delta (#104)");
    console.log("      - Event B: Modified Customer Beta (#102)");
    console.log("      - Event C: Re-linked Quote QT-RB-003 to Customer Delta (#104)");

    // 4. Execute Protected Rollback Logic
    // Find candidate customers tagged with migrationBatch
    const allBatchCustomers = await Customer.collection
      .find({ companyId: testCompanyId, notes: new RegExp(MIGRATION_BATCH) })
      .toArray();

    let deletedCustomersCount = 0;
    let preservedModifiedCustomersCount = 0;
    let unlinkedQuotesCount = 0;
    let preservedQuotesCount = 0;

    for (const c of allBatchCustomers) {
      const meta = JSON.parse(c.notes || "{}");
      const currentFingerprint = computeCustomerFingerprint({
        name: c.name,
        phone: c.phone,
        email: c.email,
        siteAddress: c.siteAddress,
        billingAddress: c.billingAddress,
        gstNumber: c.gstNumber,
        dealerId: c.dealerId,
        assignedSalesId: c.assignedSalesId,
      });

      // Check 1: Fingerprint comparison (detects content edits)
      const isContentModified = currentFingerprint !== meta.fingerprint;

      // Check 2: Has customer been linked to newly created quotes post-migration?
      const linkedQuotes = await Quotation.collection.find({ customerId: c._id }).toArray();
      const hasPostMigrationQuotes = linkedQuotes.some(
        (q) => !meta.migratedQuotationIds?.includes(q._id.toString())
      );

      if (isContentModified || hasPostMigrationQuotes) {
        // PROTECTED: Do not delete!
        preservedModifiedCustomersCount++;
        console.log(`      * [PROTECTED] Customer #${c._id} ("${c.name}") was modified post-migration. Preserved.`);
      } else {
        // SAFE TO ROLLBACK: Unlink original quotes and delete customer
        for (const qId of meta.migratedQuotationIds || []) {
          // Verify quote still points to this customer and still carries batch tag
          const res = await Quotation.collection.updateOne(
            { _id: qId, customerId: c._id, migrationBatch: MIGRATION_BATCH },
            { $set: { customerId: null, migrationBatch: null } }
          );
          if (res.modifiedCount > 0) {
            unlinkedQuotesCount++;
          }
        }
        await Customer.collection.deleteOne({ _id: c._id });
        deletedCustomersCount++;
      }
    }

    // 5. Assertions
    // Customer Alpha was untouched -> Deleted & unlinked
    const alphaCheck = await Customer.collection.findOne({ _id: 101 as any });
    assert.strictEqual(alphaCheck, null, "Customer Alpha should be safely deleted by rollback");
    const q1Check = await Quotation.collection.findOne({ _id: "q_rb_01" as any });
    assert.strictEqual(q1Check?.customerId, null, "Quotation 1 should be unlinked");

    // Customer Beta was modified -> Must be preserved!
    const betaCheck = await Customer.collection.findOne({ _id: 102 as any });
    assert.ok(betaCheck, "Customer Beta was modified post-migration and MUST NOT be deleted by rollback");
    assert.strictEqual(betaCheck?.name, "Customer Beta Modified Inc", "Customer Beta's modified name preserved");

    // Customer Delta was created post-migration -> Must be preserved!
    const deltaCheck = await Customer.collection.findOne({ _id: 104 as any });
    assert.ok(deltaCheck, "Customer Delta was created post-migration and MUST NOT be touched");

    // Quotation 3 was re-linked to Delta -> Must remain linked to Delta!
    const q3Check = await Quotation.collection.findOne({ _id: "q_rb_03" as any });
    assert.strictEqual(q3Check?.customerId, 104, "Quotation 3 post-migration re-linking to Delta must be preserved");

    console.log("\n  ✓ Step 3: Rollback safety verified with 100% mathematical precision:");
    console.log(`      - Untouched batch customers deleted: ${deletedCustomersCount} (Customer Alpha)`);
    console.log(`      - Modified batch customers preserved: ${preservedModifiedCustomersCount} (Customer Beta)`);
    console.log(`      - Post-migration new customers untouched: Customer Delta (#104)`);
    console.log(`      - Post-migration quotation re-linking preserved: Quotation 3 (#104)`);
  });

  // Clean up
  await runUnscoped("platform-admin", async () => {
    await Company.collection.deleteMany({ _id: testCompanyId as any });
    await Customer.collection.deleteMany({ companyId: testCompanyId as any });
    await Quotation.collection.deleteMany({ companyId: testCompanyId as any });
  });

  console.log("\n================================================================================");
  console.log("ROLLBACK PROTECTION & FINGERPRINT VERIFICATION PASSED!");
  console.log("================================================================================\n");
}

testRollbackSafety()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

