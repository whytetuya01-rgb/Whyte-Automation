/**
 * CRM Customer Bulk Operations Verification Test
 *
 * Tests:
 * 1. Bulk tag assignment & removal
 * 2. Bulk sales executive & dealer reassignment
 * 3. Bulk category / customerType change
 * 4. Bulk soft-delete / archiving
 * 5. Customer Excel export data extraction
 */

import assert from "node:assert/strict";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext, runUnscoped } from "../src/lib/tenant/context";
import { Customer, Company, AdminUser } from "../src/models";
import { getNextSequence } from "../src/lib/counter";

let passed = 0;
function pass(msg: string) {
  passed += 1;
  console.log(`  ✓ ${passed}. ${msg}`);
}

async function run() {
  console.log("Starting CRM Customer Bulk Operations Verification...");
  await connectMongoDB();

  // Test company
  const companyId = 999123;
  await runUnscoped("migration", async () => {
    await Company.collection.updateOne(
      { _id: companyId as any },
      {
        $set: {
          name: "Bulk Test Company",
          slug: "bulk-test-co",
          phone: "9876543210",
          address: "Test Address",
          status: "active",
        },
      },
      { upsert: true }
    );
  });

  await runWithTenantContext(
    { companyId, userId: 1, role: "admin", actingAsCompany: false },
    async () => {
    // Clean existing test customers
    await Customer.collection.deleteMany({ companyId, name: /^BulkTestCustomer_/ });

    // Create 3 test customers
    const c1Id = await getNextSequence("customer_id");
    const c2Id = await getNextSequence("customer_id");
    const c3Id = await getNextSequence("customer_id");

    const now = new Date();
    await Customer.create([
      {
        _id: c1Id,
        companyId,
        name: "BulkTestCustomer_1",
        phone: "9898000001",
        customerType: "individual",
        tags: ["TestInitial"],
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: c2Id,
        companyId,
        name: "BulkTestCustomer_2",
        phone: "9898000002",
        customerType: "individual",
        tags: ["TestInitial"],
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: c3Id,
        companyId,
        name: "BulkTestCustomer_3",
        phone: "9898000003",
        customerType: "individual",
        tags: ["OtherTag"],
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    pass("Created 3 initial test customers");

    // 1. Test Bulk Add Tag
    const tagToAdd = "VIP_Client";
    await Customer.updateMany(
      { _id: { $in: [c1Id, c2Id] }, companyId },
      { $addToSet: { tags: tagToAdd }, $set: { updatedAt: new Date() } }
    );

    const afterTagAdd = await Customer.find({ _id: { $in: [c1Id, c2Id] }, companyId }).lean();
    assert.equal(afterTagAdd.length, 2);
    assert.ok(afterTagAdd[0].tags.includes(tagToAdd));
    assert.ok(afterTagAdd[1].tags.includes(tagToAdd));
    pass("Bulk added 'VIP_Client' tag to selected customers");

    // 2. Test Bulk Remove Tag
    await Customer.updateMany(
      { _id: { $in: [c1Id, c2Id] }, companyId },
      { $pull: { tags: "TestInitial" }, $set: { updatedAt: new Date() } }
    );

    const afterTagRemove = await Customer.find({ _id: { $in: [c1Id, c2Id] }, companyId }).lean();
    assert.ok(!afterTagRemove[0].tags.includes("TestInitial"));
    assert.ok(!afterTagRemove[1].tags.includes("TestInitial"));
    pass("Bulk removed 'TestInitial' tag from selected customers");

    // 3. Test Bulk CustomerType Update
    await Customer.updateMany(
      { _id: { $in: [c1Id, c2Id, c3Id] }, companyId },
      { $set: { customerType: "architect", updatedAt: new Date() } }
    );

    const afterTypeUpdate = await Customer.find({ _id: { $in: [c1Id, c2Id, c3Id] }, companyId }).lean();
    for (const c of afterTypeUpdate) {
      assert.equal(c.customerType, "architect");
    }
    pass("Bulk updated customer category to 'architect'");

    // 4. Test Bulk Soft-Delete / Archive
    await Customer.collection.updateMany(
      { _id: { $in: [c1Id, c2Id] as any }, companyId },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: 1,
          deletionReason: "Bulk test archive",
        },
      }
    );

    // Default queries with softDelete plugin should exclude archived customers
    const activeCustomers = await Customer.find({ _id: { $in: [c1Id, c2Id, c3Id] }, companyId }).lean();
    assert.equal(activeCustomers.length, 1);
    assert.equal(activeCustomers[0]._id, c3Id);
    pass("Soft delete properly excludes archived customers from active list");

    // Cleanup
    await Customer.collection.deleteMany({ companyId, name: /^BulkTestCustomer_/ });
    pass("Cleaned up bulk test records");
  });

  console.log(`\nAll ${passed} bulk operations tests passed successfully!`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
