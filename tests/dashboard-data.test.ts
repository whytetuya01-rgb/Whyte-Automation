/**
 * The company dashboard's numbers, computed by the real code on a throwaway local MongoDB:
 *   - every quotation of the period is counted once (the trend and the dealer table used to count the recent ones twice,
 *     and left rejected ones out of the volume);
 *   - won revenue keeps an approved quotation's full value even if a product in it was deleted later;
 *   - a lead source's won revenue is the won lead's accepted quotation, or its budget when it has none;
 *   - no invented sales cycle when nothing has been won; conversion never passes 100%;
 *   - another company's data never appears;
 *   - a custom role only receives the parts its permissions cover (removed on the server).
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/dashboard-data.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { getAdminDashboardData, redactDashboardData } from "../src/lib/adminDashboardData";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const A = 9941;
const B = 9942;
const C = 9943; // a company with leads but nothing won
const ADMIN = 99411;
const SALES = 99412;
const DEALER = 99413;
const ADMIN_B = 99421;
const ADMIN_C = 99431;
const RUN = Date.now().toString(36);
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dec = (n: number) => mongoose.Types.Decimal128.fromString(String(n));

const inCompany = <T>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: ADMIN, role: "admin", actingAsCompany: false }, async () => await fn());

async function main() {
  await connectMongoDB();
  const db = mongoose.connection.db!;
  const companies = [A, B, C];
  const cleanup = async () => {
    await db.collection("companies").deleteMany({ _id: { $in: companies } as never });
    await db.collection("adminusers").deleteMany({ _id: { $in: [ADMIN, SALES, DEALER, ADMIN_B, ADMIN_C] } as never });
    for (const name of ["quotations", "quotationrooms", "quotationitems", "products", "leads", "quotationdeliveries", "dealercategoryevents", "categories"]) {
      await db.collection(name).deleteMany({ companyId: { $in: companies } });
    }
  };
  await cleanup();
  const now = new Date();
  await db.collection("companies").insertMany(companies.map((id) => ({ _id: id, name: `Dash ${id}`, slug: `dash-${id}-${RUN}`, status: "active", createdAt: now, updatedAt: now })) as never);
  await db.collection("adminusers").insertMany(
    [
      { _id: ADMIN, companyId: A, role: "admin", name: "Adam Admin" },
      { _id: SALES, companyId: A, role: "sales_executive", name: "Sana Sales" },
      { _id: DEALER, companyId: A, role: "dealer", name: "Dev Dealer", discountAllocationPercent: 0 },
      { _id: ADMIN_B, companyId: B, role: "admin", name: "Bea B" },
      { _id: ADMIN_C, companyId: C, role: "admin", name: "Cy C" },
    ].map((u) => ({ ...u, email: `${u._id}.${RUN}@dash.test`, isActive: true, createdAt: now, updatedAt: now })) as never
  );

  // Products: 1 live, 2 deleted after it was sold.
  const P_LIVE = 994101;
  const P_GONE = 994102;
  const P_B = 994201;
  await db.collection("products").insertMany([
    { _id: P_LIVE, companyId: A, name: "Switch", isActive: true, isDeleted: false, createdAt: now, updatedAt: now },
    { _id: P_GONE, companyId: A, name: "Old switch", isActive: false, isDeleted: true, deletedAt: now, createdAt: now, updatedAt: now },
    { _id: P_B, companyId: B, name: "B switch", isActive: true, isDeleted: false, createdAt: now, updatedAt: now },
  ] as never);

  // Quotations (all within the last 30 days): one item each, no discounts. A quotation's value is its grand total, which
  // adds the 18% charge to the items (2000 -> 2360).
  const total = (items: number) => Math.round(items * 1.18);
  let roomId = 994100;
  let itemId = 994100;
  const quote = async (companyId: number, id: string, status: string, value: number, extra: Record<string, unknown> = {}, productId = P_LIVE) => {
    await db.collection("quotations").insertOne({ _id: id, companyId, quotationNumber: `QT-${id}`, clientName: `Client ${id}`, status, dealerId: null, assignedSalesId: null, createdBy: ADMIN, discountType: null, discountValue: null, customerDiscountPercent: 0, allocatedDiscountPercent: 0, isDeleted: false, createdAt: daysAgo(3), updatedAt: now, ...extra } as never);
    if (value > 0) {
      roomId += 1;
      itemId += 1;
      await db.collection("quotationrooms").insertOne({ _id: roomId, companyId, quotationId: id, roomTypeId: null, name: "Hall", isDeleted: false, createdAt: now, updatedAt: now } as never);
      await db.collection("quotationitems").insertOne({ _id: itemId, companyId, quotationRoomId: roomId, productId, productVariantId: null, quantity: 1, unitPrice: dec(value), isDeleted: false, createdAt: now, updatedAt: now } as never);
    }
  };
  await quote(A, `qa1_${RUN}`, "approved", 2000, { assignedSalesId: SALES });
  await quote(A, `qa2_${RUN}`, "sent", 500);
  await quote(A, `qa3_${RUN}`, "rejected", 300);
  await quote(A, `qa4_${RUN}`, "draft", 0);
  await quote(A, `qa5_${RUN}`, "delivered", 1500, { dealerId: DEALER }, P_GONE);
  await quote(B, `qb1_${RUN}`, "approved", 99999);

  // Leads: source "Website" has a won lead with an accepted quotation (2000) and a won lead without one (budget 700).
  const lead = (companyId: number, id: string, status: string, extra: Record<string, unknown> = {}) => ({ _id: `${id}_${RUN}`, companyId, referenceNumber: `LD-${id}`, customerName: id, status, priority: "medium", sourceName: "Website", estimatedBudget: null, assignedSalesId: null, tags: [], isDeleted: false, createdBy: ADMIN, createdAt: daysAgo(10), updatedAt: now, ...extra });
  await db.collection("leads").insertMany([
    lead(A, "won-quoted", "won", { convertedQuotationId: `qa1_${RUN}`, estimatedBudget: 1, wonAt: daysAgo(4), assignedSalesId: ADMIN }),
    lead(A, "won-budget", "won", { estimatedBudget: 700, wonAt: daysAgo(2), assignedSalesId: ADMIN }),
    lead(A, "lost", "lost", { estimatedBudget: 900, sourceName: "Referral", assignedSalesId: ADMIN }),
    lead(A, "open", "negotiation", { estimatedBudget: 5000, sourceName: "Referral" }),
    lead(B, "b-won", "won", { estimatedBudget: 123456, wonAt: daysAgo(1) }),
    lead(C, "c-open", "contacted", { estimatedBudget: 100 }),
  ] as never);

  try {
    const data = await inCompany(A, () => getAdminDashboardData({ dateRange: "30d" }));
    const q = data.quotations;

    // ═══ counted once ═══
    assert.equal(q.total, 5);
    const trendTotal = q.trend.reduce((sum, bucket) => sum + bucket.total, 0);
    assert.equal(trendTotal, 5, "every quotation of the period appears once in the trend (recent ones were counted twice)");
    assert.equal(q.trend.reduce((sum, bucket) => sum + bucket.byStatus.rejected, 0), 1, "rejected ones count in the volume");
    const dealerRow = data.dealers.items.find((row) => row.dealerId === DEALER);
    assert.ok(dealerRow, "the dealer has a row");
    assert.deepEqual([dealerRow.totalQuotations, dealerRow.approvedQuotations, dealerRow.approvedValue], [1, 1, total(1500)], "the dealer's one quotation, once");
    pass("every quotation of the period is counted once in the trend and the dealer table, rejected ones included");

    // ═══ values ═══
    assert.equal(q.approvedValue, total(2000) + total(1500), "approved 2000 + delivered 1500 (its product was deleted later, the value stays)");
    assert.equal(q.pendingValue, total(500), "the sent one (the draft is empty)");
    assert.equal(q.totalValue, total(2000) + total(1500) + total(500) + total(300), "approved + pending + rejected");
    assert.equal(q.approvalRate, 67, "2 approved/delivered of 3 decided");
    assert.ok(!JSON.stringify(data).includes("99999") && !JSON.stringify(data).includes("123456"), "nothing of the other company");
    pass("won revenue keeps an approved quotation's full value after a product in it is deleted; another company's figures never appear");

    // ═══ CRM ═══
    const crm = data.crm!;
    assert.equal(crm.isDemo, false);
    const website = crm.sources.find((source) => source.source === "Website")!;
    assert.deepEqual([website.count, website.wonCount, website.wonRevenue, website.conversionRate], [2, 2, total(2000) + 700, 100], "the accepted quotation's total, not its budget (1), plus the other's budget (700)");
    assert.equal(crm.summary.leadToWonRate, 67, "2 won of 3 decided");
    assert.equal(crm.summary.pipelineValue, 5000, "the open deal's value");
    assert.equal(crm.summary.avgSalesCycleDays, 7, "won 6 and 8 days after the enquiry");
    for (const person of crm.salespeople) assert.ok(person.conversionRate >= 0 && person.conversionRate <= 100, `${person.name}: ${person.conversionRate}%`);
    const adam = crm.salespeople.find((person) => person.id === ADMIN)!;
    assert.deepEqual([adam.leadsAssigned, adam.conversionRate], [3, 67]);
    pass("a lead source's won revenue is the accepted quotation (or the budget without one); the sales cycle and conversion come from real won and lost leads");

    const quiet = await inCompany(C, () => getAdminDashboardData({ dateRange: "30d" }));
    assert.equal(quiet.crm!.summary.avgSalesCycleDays, 0, "no won deal: no invented sales cycle (the screen shows —)");
    assert.equal(quiet.crm!.summary.totalLeads, 1);
    pass("a company with leads but nothing won shows no sales cycle instead of a made-up 14 days");

    // ═══ what a custom role receives ═══
    const crmOnly = redactDashboardData(data, { crm: true, sales: false, dealers: false });
    assert.deepEqual([crmOnly.quotations.approvedValue, crmOnly.quotations.pendingValue, crmOnly.quotations.totalValue, crmOnly.quotations.recent.length, crmOnly.deliveries.recent.length], [0, 0, 0, 0, 0]);
    assert.ok(crmOnly.quotations.trend.every((bucket) => bucket.approvedValue === 0));
    assert.ok(crmOnly.crm!.salespeople.every((person) => person.wonRevenue === 0) && crmOnly.crm!.sources.every((source) => source.wonRevenue === 0), "no money figures through the CRM side either");
    assert.equal(crmOnly.crm!.summary.totalLeads, data.crm!.summary.totalLeads, "lead counts stay");
    assert.deepEqual([crmOnly.dealers.items.length, crmOnly.dealerTiers, crmOnly.quotations.confirmedDealerEarnings], [0, null, 0]);
    const salesOnly = redactDashboardData(data, { crm: false, sales: true, dealers: true });
    assert.deepEqual([salesOnly.crm!.summary.totalLeads, salesOnly.crm!.sources.length, salesOnly.crm!.salespeople.length, salesOnly.leads], [0, 0, 0, undefined]);
    assert.equal(salesOnly.quotations.approvedValue, total(2000) + total(1500));
    assert.equal(redactDashboardData(data, { crm: true, sales: true, dealers: true }).quotations.approvedValue, total(2000) + total(1500), "full access changes nothing");
    const page = readFileSync(join(process.cwd(), "src/app/admin/(panel)/dashboard/page.tsx"), "utf8");
    assert.match(page, /getAdminDashboardData\(\{ dateRange, includeDemo \}\)\.then\(\(full\) => redactDashboardData\(full, access\)\)/, "the page removes what the person may not see before rendering");
    pass("a custom role receives only what its permissions cover (CRM without money figures, or sales without CRM); the page applies it on the server");

    console.log(`\nALL ${count} DASHBOARD DATA TESTS PASSED!`);
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
