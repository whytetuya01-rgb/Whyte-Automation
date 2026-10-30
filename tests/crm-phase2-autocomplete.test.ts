import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb";
import { Company, AdminUser, Quotation, Customer, CrmActivity } from "../src/models";
import { runWithTenantContext, runUnscoped } from "../src/lib/tenant/context";
import { resolveOrCreateCustomer, recordCrmActivity } from "../src/lib/crmService";

async function runAutocompletePhase2Tests() {
  console.log("=== STARTING CRM PHASE 2 AUTOCOMPLETE & AUTO-LINKING VERIFICATION ===\n");
  await connectMongoDB();

  // Test tenants
  const testCompany1Id = 9101;
  const testCompany2Id = 9102;
  const now = new Date();

  const ctxCompany1 = { companyId: testCompany1Id, userId: 9110, role: "admin", actingAsCompany: true };
  const ctxCompany2 = { companyId: testCompany2Id, userId: 9120, role: "admin", actingAsCompany: true };

  // Clean up any test fixtures from previous runs
  await runUnscoped("platform-admin", async () => {
    await Company.collection.deleteMany({ _id: { $in: [testCompany1Id, testCompany2Id] } as any });
    await AdminUser.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await Customer.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await Quotation.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await CrmActivity.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });

    await Company.create([
      { _id: testCompany1Id, name: "Company Alpha Automations", slug: "alpha-test", status: "active", phone: "9820001111", address: "Mumbai", createdAt: now, updatedAt: now },
      { _id: testCompany2Id, name: "Company Beta Smart Spaces", slug: "beta-test", status: "active", phone: "9820002222", address: "Delhi", createdAt: now, updatedAt: now },
    ]);
  });

  // Step 1: Direct quotation save with client details auto-creates central customer
  let customer1Id: number = 0;
  await runWithTenantContext(ctxCompany1, async () => {
    // Simulate what POST /api/quotations does when user enters details manually
    const clientName = "Vikram Aditya";
    const clientPhone = "+91 98220 12345";
    const clientEmail = "vikram.aditya@example.com";
    const clientAddress = "Skyline Towers, Flat 802, Mumbai";
    const clientGst = "27AAPFU0939F1ZV";

    // Auto-resolve or create customer
    customer1Id = await resolveOrCreateCustomer({
      companyId: testCompany1Id,
      name: clientName,
      phone: clientPhone,
      email: clientEmail,
      siteAddress: clientAddress,
      gstNumber: clientGst,
      userId: 9110,
    });

    assert.ok(customer1Id > 0, "Expected valid numeric customerId");

    const quoteId = "q_test_phase2_01";
    await Quotation.create({
      _id: quoteId,
      companyId: testCompany1Id,
      quotationNumber: "QT-2026-901",
      clientName,
      clientPhone,
      clientEmail,
      clientAddress,
      clientGstNumber: clientGst,
      customerId: customer1Id,
      status: "draft",
      createdBy: "9110",
      createdAt: new Date(),
    });

    await recordCrmActivity({
      companyId: testCompany1Id,
      customerId: customer1Id,
      quotationId: quoteId,
      type: "note",
      title: "Quotation Created",
      description: `Quotation QT-2026-901 initialized for ${clientName}`,
      performedBy: 9110,
    });

    console.log(`  ✓ 1. Quotation QT-2026-901 saved and auto-linked to new Central Customer #${customer1Id}`);
  });

  // Step 2: Customer Deduplication on next quotation save
  await runWithTenantContext(ctxCompany1, async () => {
    // Another quotation created with the same phone number
    const quote2Id = "q_test_phase2_02";
    const resolvedId = await resolveOrCreateCustomer({
      companyId: testCompany1Id,
      name: "Mr. V. Aditya", // Slight variation in name
      phone: "+91 98220 12345", // EXACT phone match
      email: "different.email@example.com",
      userId: 9110,
    });

    assert.strictEqual(resolvedId, customer1Id, "Customer deduplication should match existing customer ID");

    await Quotation.create({
      _id: quote2Id,
      companyId: testCompany1Id,
      quotationNumber: "QT-2026-902",
      clientName: "Mr. V. Aditya",
      clientPhone: "+91 98220 12345",
      customerId: resolvedId,
      status: "draft",
      createdBy: "9110",
      createdAt: new Date(),
    });

    console.log(`  ✓ 2. Deduplication verified: Second quotation QT-2026-902 reuses Customer #${resolvedId} without creating duplicate`);
  });

  // Step 3: Central Customer Search query simulates autocomplete search
  await runWithTenantContext(ctxCompany1, async () => {
    // Search by name substring
    const byName = await Customer.find({
      companyId: testCompany1Id,
      name: new RegExp("Aditya", "i"),
    }).lean();
    assert.strictEqual(byName.length, 1, "Search by name 'Aditya' should return 1 customer");

    // Search by phone substring
    const byPhone = await Customer.find({
      companyId: testCompany1Id,
      phone: new RegExp("98220", "i"),
    }).lean();
    assert.strictEqual(byPhone.length, 1, "Search by phone '98220' should return 1 customer");

    // Search by address substring
    const byAddress = await Customer.find({
      companyId: testCompany1Id,
      siteAddress: new RegExp("Skyline", "i"),
    }).lean();
    assert.strictEqual(byAddress.length, 1, "Search by address 'Skyline' should return 1 customer");

    console.log(`  ✓ 3. Autocomplete search verified across customer name, phone number, and site address`);
  });

  // Step 4: Unlinking customer from quotation
  await runWithTenantContext(ctxCompany1, async () => {
    const updated = await Quotation.findByIdAndUpdate(
      "q_test_phase2_02",
      { $set: { customerId: null } },
      { new: true }
    );
    assert.strictEqual(updated?.customerId, null, "Quotation should be successfully unlinked");
    assert.strictEqual(updated?.clientName, "Mr. V. Aditya", "Unlinking customer preserves existing quotation form details");

    console.log(`  ✓ 4. Unlinking verified: Customer ID cleared to null while preserving quotation data`);
  });

  // Step 5: Linking / Changing customer on quotation logs activity
  await runWithTenantContext(ctxCompany1, async () => {
    const quote2 = await Quotation.findByIdAndUpdate(
      "q_test_phase2_02",
      { $set: { customerId: customer1Id } },
      { new: true }
    );
    assert.strictEqual(quote2?.customerId, customer1Id, "Quotation should be re-linked to customer");

    await recordCrmActivity({
      companyId: testCompany1Id,
      customerId: customer1Id,
      quotationId: "q_test_phase2_02",
      type: "note",
      title: "Quotation Linked",
      description: `Quotation QT-2026-902 linked to customer`,
      performedBy: 9110,
    });

    const activities = await CrmActivity.find({ customerId: customer1Id }).sort({ performedAt: -1 }).lean();
    assert.ok(activities.length >= 2, "Expected at least 2 CRM activities for customer");
    assert.ok(activities.some((a) => a.title === "Quotation Linked"), "Expected 'Quotation Linked' activity in timeline");

    console.log(`  ✓ 5. Re-linking verified: Activity logged to customer timeline with quotation reference`);
  });

  // Step 6: Multi-tenant isolation for Autocomplete
  await runWithTenantContext(ctxCompany2, async () => {
    // Company 2 searches for "Aditya" or "+91 98220 12345"
    const foreignCust = await Customer.find({
      companyId: testCompany2Id,
      $or: [
        { name: new RegExp("Aditya", "i") },
        { phone: new RegExp("98220", "i") },
      ],
    }).lean();

    assert.strictEqual(foreignCust.length, 0, "Company 2 must NEVER find Company 1's customers in autocomplete search");

    // Company 2 creates customer with same phone number
    const comp2CustId = await resolveOrCreateCustomer({
      companyId: testCompany2Id,
      name: "Vikram Aditya Beta",
      phone: "+91 98220 12345",
      userId: 9120,
    });

    assert.notStrictEqual(comp2CustId, customer1Id, "Company 2 must get its own separate customer ID, isolated from Company 1");

    console.log(`  ✓ 6. Multi-tenant isolation verified: Customers are strictly scoped per company`);
  });

  // Clean up test data
  await runUnscoped("platform-admin", async () => {
    await Company.collection.deleteMany({ _id: { $in: [testCompany1Id, testCompany2Id] } as any });
    await AdminUser.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await Customer.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await Quotation.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
    await CrmActivity.collection.deleteMany({ companyId: { $in: [testCompany1Id, testCompany2Id] } as any });
  });

  console.log("\n======================================================");
  console.log("ALL 6 PHASE 2 AUTOCOMPLETE & LINKING TESTS PASSED!");
  console.log("======================================================\n");
}

runAutocompletePhase2Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failure:", err);
    process.exit(1);
  });
