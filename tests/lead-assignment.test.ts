/**
 * Comprehensive Acceptance Test Suite for Requirement #8: Automatic Lead Assignment & Notifications
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/lead-assignment.test.ts
 */
import assert from "node:assert/strict";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import {
  AdminUser,
  Company,
  Lead,
  LeadSource,
  LeadAssignmentRule,
  Notification,
  FollowUpTask,
  CrmActivity,
} from "../src/models";
import {
  determineLeadAssignee,
  getLeadAssignmentRule,
  updateLeadAssignmentRule,
  notifyLeadAssigned,
} from "../src/lib/leadAssignmentService";
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  syncFollowUpNotifications,
} from "../src/lib/notificationService";

const COMPANY_A = 901;
const COMPANY_B = 902;

const SALES_A1 = 9101;
const SALES_A2 = 9102;
const SALES_A3 = 9103;
const SALES_DEACTIVATED = 9104;
const SALES_B1 = 9201;
const ADMIN_A = 9100;

let testCount = 0;
function pass(msg: string) {
  testCount++;
  console.log(`  ✓ ${msg}`);
}

async function setupTestData() {
  await connectMongoDB();

  // Clear test collections for these test company IDs
  await Promise.all([
    Company.collection.deleteMany({ _id: { $in: [COMPANY_A, COMPANY_B] as never } }),
    AdminUser.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    Lead.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    LeadSource.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    LeadAssignmentRule.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    Notification.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    FollowUpTask.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    CrmActivity.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
  ]);

  // Seed Companies
  await Company.collection.insertMany([
    { _id: COMPANY_A as never, name: "Company A", slug: "company-a", status: "active", isDeleted: false },
    { _id: COMPANY_B as never, name: "Company B", slug: "company-b", status: "active", isDeleted: false },
  ]);

  // Seed Users
  await AdminUser.collection.insertMany([
    {
      _id: ADMIN_A as never,
      companyId: COMPANY_A,
      email: "leadassign-admin@a.test",
      name: "Admin Alice",
      role: "admin",
      isActive: true,
      passwordHash: "hash",
    },
    {
      _id: SALES_A1 as never,
      companyId: COMPANY_A,
      email: "leadassign-sales1@a.test",
      name: "Sales Rep 1",
      role: "sales_executive",
      isActive: true,
      passwordHash: "hash",
    },
    {
      _id: SALES_A2 as never,
      companyId: COMPANY_A,
      email: "leadassign-sales2@a.test",
      name: "Sales Rep 2",
      role: "sales_executive",
      isActive: true,
      passwordHash: "hash",
    },
    {
      _id: SALES_A3 as never,
      companyId: COMPANY_A,
      email: "leadassign-sales3@a.test",
      name: "Sales Rep 3",
      role: "sales_executive",
      isActive: true,
      passwordHash: "hash",
    },
    {
      _id: SALES_DEACTIVATED as never,
      companyId: COMPANY_A,
      email: "leadassign-inactive@a.test",
      name: "Inactive Sales",
      role: "sales_executive",
      isActive: false,
      passwordHash: "hash",
    },
    {
      _id: SALES_B1 as never,
      companyId: COMPANY_B,
      email: "leadassign-sales1@b.test",
      name: "Sales Rep B1",
      role: "sales_executive",
      isActive: true,
      passwordHash: "hash",
    },
  ]);

  // Seed Lead Sources
  await LeadSource.collection.insertMany([
    {
      _id: "src_website_a" as never,
      companyId: COMPANY_A,
      name: "Website",
      isActive: true,
      isDefault: true,
      sortOrder: 1,
    },
    {
      _id: "src_referral_a" as never,
      companyId: COMPANY_A,
      name: "Referral",
      isActive: true,
      isDefault: false,
      sortOrder: 2,
    },
  ]);
}

async function runTests() {
  console.log("\n--- Starting Automatic Lead Assignment Acceptance Tests ---");
  await setupTestData();

  // =========================================================================
  // Test 1: Existing leads (no rule set) behave exactly as before
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    const unconfigured = await determineLeadAssignee(COMPANY_A);
    assert.equal(unconfigured.assignedSalesId, null, "Unconfigured company should leave lead unassigned");
    assert.equal(unconfigured.ruleUsed, "none");
    pass("1. Existing leads (no rule set) leave lead unassigned as before");
  });

  // =========================================================================
  // Test 2: Explicit assignee overrides any rule
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    // Configure round robin rule
    await updateLeadAssignmentRule({
      companyId: COMPANY_A,
      mode: "round_robin",
      enabled: true,
      eligibleSalesIds: [SALES_A1, SALES_A2, SALES_A3],
      fallbackSalesId: SALES_A1,
      updatedBy: ADMIN_A,
    });

    const explicit = await determineLeadAssignee(COMPANY_A, {
      explicitSalesId: SALES_A2,
    });
    assert.equal(explicit.assignedSalesId, SALES_A2, "Explicit sales ID must take precedence");
    assert.equal(explicit.ruleUsed, "explicit");
    pass("2. Explicit assignee chosen by user always overrides the rule");
  });

  // =========================================================================
  // Test 3: Deactivated or other-company user is never assigned
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    // Configure rule with SALES_A1 (currently active) and fallback SALES_A3
    await updateLeadAssignmentRule({
      companyId: COMPANY_A,
      mode: "round_robin",
      enabled: true,
      eligibleSalesIds: [SALES_A1],
      fallbackSalesId: SALES_A3,
      updatedBy: ADMIN_A,
    });

    // Deactivate SALES_A1 after configuration to test runtime resilience
    await AdminUser.collection.updateOne({ _id: SALES_A1 as never }, { $set: { isActive: false } });

    const result = await determineLeadAssignee(COMPANY_A);
    assert.equal(
      result.assignedSalesId,
      SALES_A3,
      "Deactivated user must be skipped at runtime; fallback must receive lead"
    );
    assert.equal(result.ruleUsed, "fallback");

    // Restore SALES_A1 to active for subsequent tests
    await AdminUser.collection.updateOne({ _id: SALES_A1 as never }, { $set: { isActive: true } });
    pass("3. Deactivated user is skipped and fallback owner is assigned");
  });

  // =========================================================================
  // Test 4: Lead Source Mapping overrides general mode
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    await updateLeadAssignmentRule({
      companyId: COMPANY_A,
      mode: "round_robin",
      enabled: true,
      eligibleSalesIds: [SALES_A1, SALES_A2, SALES_A3],
      fallbackSalesId: SALES_A1,
      sourceMappings: [{ sourceId: "src_website_a", salesId: SALES_A3 }],
      updatedBy: ADMIN_A,
    });

    const result = await determineLeadAssignee(COMPANY_A, { sourceId: "src_website_a" });
    assert.equal(result.assignedSalesId, SALES_A3, "Website source must route directly to SALES_A3");
    assert.equal(result.ruleUsed, "source_mapping");
    pass("4. Lead source mapping routes directly to configured specialist");
  });

  // =========================================================================
  // Test 5: Round-robin across 3 salespeople over 9 leads gives 3 each (Parallel balanced)
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    await updateLeadAssignmentRule({
      companyId: COMPANY_A,
      mode: "round_robin",
      enabled: true,
      eligibleSalesIds: [SALES_A1, SALES_A2, SALES_A3],
      fallbackSalesId: null,
      sourceMappings: [],
      updatedBy: ADMIN_A,
    });

    // Reset round robin counter to 0
    await LeadAssignmentRule.collection.updateOne(
      { companyId: COMPANY_A },
      { $set: { roundRobinCounter: 0 } }
    );

    // Run 9 assignments concurrently in parallel
    const assignments = await Promise.all(
      Array.from({ length: 9 }).map(() => determineLeadAssignee(COMPANY_A))
    );

    const counts: Record<number, number> = {
      [SALES_A1]: 0,
      [SALES_A2]: 0,
      [SALES_A3]: 0,
    };

    for (const a of assignments) {
      assert.ok(a.assignedSalesId, "Assignee must be determined");
      assert.equal(a.ruleUsed, "round_robin");
      counts[a.assignedSalesId] = (counts[a.assignedSalesId] || 0) + 1;
    }

    assert.equal(counts[SALES_A1], 3, "Sales 1 must receive exactly 3 leads");
    assert.equal(counts[SALES_A2], 3, "Sales 2 must receive exactly 3 leads");
    assert.equal(counts[SALES_A3], 3, "Sales 3 must receive exactly 3 leads");
    pass("5. Round-robin across 3 salespeople over 9 parallel leads gives exactly 3 each");
  });

  // =========================================================================
  // Test 6: least_open_leads picks the person with the fewest open leads
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    await updateLeadAssignmentRule({
      companyId: COMPANY_A,
      mode: "least_open_leads",
      enabled: true,
      eligibleSalesIds: [SALES_A1, SALES_A2, SALES_A3],
      fallbackSalesId: null,
      sourceMappings: [],
      updatedBy: ADMIN_A,
    });

    // Clean leads for Company A
    await Lead.collection.deleteMany({ companyId: COMPANY_A });

    // Seed: Sales A1 has 2 open leads, Sales A2 has 1 open lead, Sales A3 has 0 open leads
    await Lead.collection.insertMany([
      {
        _id: "ld_test_1" as never,
        referenceNumber: "LD-2026-0001",
        companyId: COMPANY_A,
        customerName: "Client 1",
        assignedSalesId: SALES_A1,
        status: "new",
        isDeleted: false,
        createdBy: ADMIN_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: "ld_test_2" as never,
        referenceNumber: "LD-2026-0002",
        companyId: COMPANY_A,
        customerName: "Client 2",
        assignedSalesId: SALES_A1,
        status: "contacted",
        isDeleted: false,
        createdBy: ADMIN_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: "ld_test_3" as never,
        referenceNumber: "LD-2026-0003",
        companyId: COMPANY_A,
        customerName: "Client 3",
        assignedSalesId: SALES_A2,
        status: "new",
        isDeleted: false,
        createdBy: ADMIN_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Sales A1 also has a "won" lead which should NOT count towards open leads
      {
        _id: "ld_test_4" as never,
        referenceNumber: "LD-2026-0004",
        companyId: COMPANY_A,
        customerName: "Client 4",
        assignedSalesId: SALES_A1,
        status: "won",
        isDeleted: false,
        createdBy: ADMIN_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // When assigning next lead, Sales A3 has 0 open leads, so Sales A3 MUST be chosen
    const result1 = await determineLeadAssignee(COMPANY_A);
    assert.equal(result1.assignedSalesId, SALES_A3, "Sales A3 has 0 open leads and must be chosen");
    assert.equal(result1.ruleUsed, "least_open_leads");

    // Add an open lead for Sales A3
    await Lead.collection.insertOne({
      _id: "ld_test_5" as never,
      referenceNumber: "LD-2026-0005",
      companyId: COMPANY_A,
      customerName: "Client 5",
      assignedSalesId: SALES_A3,
      status: "new",
      isDeleted: false,
      createdBy: ADMIN_A,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Now Sales A1=2, Sales A2=1, Sales A3=1. Sales A2 has tie-breaker lowest ID among 1s
    const result2 = await determineLeadAssignee(COMPANY_A);
    assert.equal(result2.assignedSalesId, SALES_A2, "Sales A2 has fewest open leads (tied with A3, lowest ID)");
    pass("6. least_open_leads correctly balances by active workload and ignores won/lost deals");
  });

  // =========================================================================
  // Test 7: Assignee gets exactly one lead_assigned notification, no one else does
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: ADMIN_A, role: "admin", actingAsCompany: false }, async () => {
    await Notification.collection.deleteMany({ companyId: COMPANY_A });

    await notifyLeadAssigned({
      companyId: COMPANY_A,
      leadId: "ld_test_100",
      referenceNumber: "LD-2026-0100",
      customerName: "Dr. Sharma",
      assignedSalesId: SALES_A1,
    });

    const notifsA1 = await Notification.collection.find({ companyId: COMPANY_A, userId: SALES_A1 }).toArray();
    const notifsA2 = await Notification.collection.find({ companyId: COMPANY_A, userId: SALES_A2 }).toArray();
    const notifsA3 = await Notification.collection.find({ companyId: COMPANY_A, userId: SALES_A3 }).toArray();

    assert.equal(notifsA1.length, 1, "Assignee SALES_A1 must receive exactly 1 notification");
    assert.equal(notifsA1[0].type, "lead_assigned");
    assert.ok(notifsA1[0].body.includes("Dr. Sharma"));
    assert.equal(notifsA2.length, 0, "Non-assignee SALES_A2 must receive 0 notifications");
    assert.equal(notifsA3.length, 0, "Non-assignee SALES_A3 must receive 0 notifications");

    // Reassignment to SALES_A2
    await notifyLeadAssigned({
      companyId: COMPANY_A,
      leadId: "ld_test_100",
      referenceNumber: "LD-2026-0100",
      customerName: "Dr. Sharma",
      assignedSalesId: SALES_A2,
      isReassignment: true,
    });

    const notifsA2After = await Notification.collection.find({ companyId: COMPANY_A, userId: SALES_A2 }).toArray();
    assert.equal(notifsA2After.length, 1, "New owner SALES_A2 receives reassignment notification");
    assert.equal(notifsA2After[0].title, "Lead Reassigned");
    pass("7. Lead assigned/reassigned notifies only the target owner");
  });

  // =========================================================================
  // Test 8: Follow-up due and overdue notifies its owner once, even if fetched many times
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: SALES_A1, role: "sales_executive", actingAsCompany: false }, async () => {
    await Notification.collection.deleteMany({ companyId: COMPANY_A });
    await FollowUpTask.collection.deleteMany({ companyId: COMPANY_A });

    const now = new Date();
    const overdueTime = new Date(now.getTime() - 2 * 3600 * 1000); // 2 hours ago
    const dueTodayTime = new Date(now.getTime() + 1 * 3600 * 1000); // 1 hour ahead (same day)

    // Seed 1 overdue and 1 due task
    await FollowUpTask.collection.insertMany([
      {
        _id: "fu_task_overdue" as never,
        companyId: COMPANY_A,
        leadId: "ld_test_1",
        ownerId: SALES_A1,
        dueAt: overdueTime,
        status: "open",
        version: 1,
        scheduleChangedAt: now,
        createdVia: "crm",
        createdBy: ADMIN_A,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "fu_task_due" as never,
        companyId: COMPANY_A,
        leadId: "ld_test_2",
        ownerId: SALES_A1,
        dueAt: dueTodayTime,
        status: "open",
        version: 1,
        scheduleChangedAt: now,
        createdVia: "crm",
        createdBy: ADMIN_A,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Fetch notifications 5 times in a row
    for (let i = 0; i < 5; i++) {
      const res = await getUserNotifications(COMPANY_A, SALES_A1);
      assert.equal(res.items.length, 2, "Should have exactly 2 notifications (1 overdue, 1 due)");
      assert.equal(res.unreadCount, 2);
    }

    const allNotifs = await Notification.collection.find({ companyId: COMPANY_A, userId: SALES_A1 }).toArray();
    assert.equal(allNotifs.length, 2, "Deduplication ensures only 2 documents exist across multiple fetches");
    pass("8. Follow-up notifications generate lazily with deduplication and never duplicate");
  });

  // =========================================================================
  // Test 9: Mark one read and mark all read
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_A, userId: SALES_A1, role: "sales_executive", actingAsCompany: false }, async () => {
    const listBefore = await getUserNotifications(COMPANY_A, SALES_A1);
    assert.equal(listBefore.unreadCount, 2);

    // Mark first read
    const firstId = listBefore.items[0].id;
    const ok = await markNotificationRead(COMPANY_A, SALES_A1, firstId);
    assert.equal(ok, true);

    const listMid = await getUserNotifications(COMPANY_A, SALES_A1);
    assert.equal(listMid.unreadCount, 1);

    // Mark all read
    const marked = await markAllNotificationsRead(COMPANY_A, SALES_A1);
    assert.equal(marked, 1);

    const listAfter = await getUserNotifications(COMPANY_A, SALES_A1);
    assert.equal(listAfter.unreadCount, 0);
    pass("9. Mark single read and mark-all-read update status and unread counters");
  });

  // =========================================================================
  // Test 10: Strict company-wise data isolation
  // =========================================================================
  await runWithTenantContext({ companyId: COMPANY_B, userId: SALES_B1, role: "sales_executive", actingAsCompany: false }, async () => {
    // User from Company B tries to mark Company A notification
    const notifA = await Notification.collection.findOne({ companyId: COMPANY_A });
    assert.ok(notifA);

    const crossed = await markNotificationRead(COMPANY_B, SALES_B1, String(notifA._id));
    assert.equal(crossed, false, "Company B cannot mark Company A notification as read");

    // Company B notification fetch sees zero Company A items
    const notifsB = await getUserNotifications(COMPANY_B, SALES_B1);
    assert.equal(notifsB.items.length, 0, "Company B user cannot see Company A notifications");

    // Company B assignment rules are completely isolated
    const ruleB = await getLeadAssignmentRule(COMPANY_B);
    assert.equal(ruleB.companyId, COMPANY_B);
    assert.equal(ruleB.enabled, false, "Company B rule remains default and unlinked to Company A");
    pass("10. Multi-company tenant isolation strictly enforced for rules and notifications");
  });

  // Clean up test data after execution to leave DB clean for other test suites
  await Promise.all([
    Company.collection.deleteMany({ _id: { $in: [COMPANY_A, COMPANY_B] as never } }),
    AdminUser.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    Lead.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    LeadSource.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    LeadAssignmentRule.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    Notification.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    FollowUpTask.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
    CrmActivity.collection.deleteMany({ companyId: { $in: [COMPANY_A, COMPANY_B] } }),
  ]);

  console.log(`\nALL ${testCount} ACCEPTANCE TESTS PASSED SUCCESSFULLY!`);
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failure:", err);
    process.exit(1);
  });
