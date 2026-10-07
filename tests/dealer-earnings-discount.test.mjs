import assert from "node:assert/strict";
import { createRunner, startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Dealer confirmed earnings + customer-discount cap, end to end against an
 * isolated server and throwaway local database.
 *
 *   earning = eligibleSubtotal x (allocated% - customer%)
 *   confirmed only for Approved / Delivered, counted once per quotation
 */

const { assertCase, summary } = createRunner();
let server;

try {
  server = await startIsolatedServer("earnings", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20 },
    { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 10 },
    { _id: 3, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
    { _id: 6, email: "dealer_zero@example.com", role: "dealer", name: "Dealer Zero", discountAllocationPercent: 0 },
  ]);
  const { db, login, api, baseUrl } = server;
  console.log(`Isolated server ready at ${baseUrl} (db ${server.dbName}).`);

  const dealerA = await login("dealer_a@example.com", "user");
  const dealerB = await login("dealer_b@example.com", "user");
  const dealerZero = await login("dealer_zero@example.com", "user");
  const admin = await login("admin_user@example.com", "admin");
  const superAdmin = await login("super_admin@example.com", "admin");

  let seq = 1000;
  /** One room with one line item, so the eligible subtotal is exactly `amount`. */
  async function seedSubtotal(quotationId, amount) {
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({
      _id: seq++,
      quotationRoomId: roomId,
      productId: 1,
      quantity: 1,
      unitPrice: Decimal128.fromString(amount.toFixed(2)),
      sortOrder: 0,
    });
  }

  async function newQuote(cookie, body = {}, subtotal = 100000) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName: "Earnings Client", ...body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    await seedSubtotal(res.data.id, subtotal);
    return res.data.id;
  }

  const earnings = async (cookie, dealerId) =>
    (await api(cookie, "GET", `/api/dealer/earnings${dealerId ? `?dealerId=${dealerId}` : ""}`)).json;
  const row = (report, id) => report.quotations.find((q) => q.id === id);

  async function approve(id) {
    assert.equal((await api(admin, "POST", `/api/quotations/${id}/mark-sent`)).status, 200);
    const res = await api(admin, "POST", `/api/quotations/${id}/transition`, { action: "approve" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
  }

  let q1;

  await assertCase("1. Draft with 20% allocation / 10% discount is NOT a confirmed earning", async () => {
    q1 = await newQuote(dealerA);
    const patch = await api(dealerA, "PATCH", `/api/quotations/${q1}`, { discountType: "percentage", discountValue: 10, customerDiscountPercent: 10 });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
    const report = await earnings(dealerA);
    assert.equal(report.summary.confirmedEarnings, 0);
    assert.equal(row(report, q1).confirmedCommissionAmount, 0);
    assert.equal(row(report, q1).estimatedCommissionAmount, 10000, "estimated = 100000 x (20% - 10%)");
    assert.equal(row(report, q1).isConfirmed, false);
    // Sent is still not confirmed
    await api(dealerA, "POST", `/api/quotations/${q1}/mark-sent`);
    assert.equal((await earnings(dealerA)).summary.confirmedEarnings, 0);
  });

  await assertCase("2. Approved -> confirmed earning = eligible subtotal x 10%", async () => {
    const res = await api(admin, "POST", `/api/quotations/${q1}/transition`, { action: "approve" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const report = await earnings(dealerA);
    assert.equal(report.summary.confirmedEarnings, 10000);
    assert.equal(row(report, q1).confirmedCommissionAmount, 10000);
    assert.equal(report.summary.approvedCount, 1);
    const stored = await db.collection("quotations").findOne({ _id: q1 });
    assert.equal(Number(stored.estimatedEarningAmount.toString()), 10000, "earning is frozen at approval");
    assert.equal(stored.estimatedEarningPercent, 10);
  });

  await assertCase("2b. Dealer home page shows the confirmed earning (server-rendered)", async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { Cookie: dealerA } });
    assert.equal(res.status, 200);
    const html = await res.text();
    const match = html.match(/Confirmed Earnings[\s\S]{0,3000}?₹\s?([\d,]+(?:\.\d+)?)/);
    assert.ok(match, `Confirmed Earnings card must render (status ${res.status}, has label: ${html.includes("Confirmed Earnings")}, len ${html.length})`);
    assert.equal(match[1], "10,000");
  });

  await assertCase("3. Approved -> Delivered does not double the earning", async () => {
    const res = await api(admin, "POST", `/api/quotations/${q1}/transition`, { action: "deliver" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const report = await earnings(dealerA);
    assert.equal(report.summary.confirmedEarnings, 10000);
    assert.equal(report.summary.deliveredCount, 1);
    assert.equal(report.summary.approvedCount, 0);
    const html = await (await fetch(`${baseUrl}/`, { headers: { Cookie: dealerA } })).text();
    assert.equal(html.match(/Confirmed Earnings[\s\S]{0,3000}?₹\s?([\d,]+(?:\.\d+)?)/)[1], "10,000");
  });

  await assertCase("4. Customer discount equal to allocation -> earning 0", async () => {
    const id = await newQuote(dealerA);
    const patch = await api(dealerA, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 20, customerDiscountPercent: 20 });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
    await approve(id);
    const report = await earnings(dealerA);
    assert.equal(row(report, id).confirmedCommissionAmount, 0);
    assert.equal(report.summary.confirmedEarnings, 10000, "total unchanged by a zero-earning quotation");
  });

  await assertCase("5. Customer discount above allocation is rejected by the API (never clamped)", async () => {
    const id = await newQuote(dealerA);
    const patch = await api(dealerA, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 25, customerDiscountPercent: 25 });
    assert.equal(patch.status, 400, JSON.stringify(patch.json));
    assert.match(JSON.stringify(patch.json), /Customer discount cannot exceed your allocated discount of 20%\./);
    const stored = await db.collection("quotations").findOne({ _id: id });
    assert.equal(stored.customerDiscountPercent, 0, "nothing was saved or clamped");

    const viaPercentOnly = await api(dealerA, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 20.5 });
    assert.equal(viaPercentOnly.status, 400);

    const create = await api(dealerA, "POST", "/api/quotations", { clientName: "Too Much", customerDiscountPercent: 25 });
    assert.equal(create.status, 400, JSON.stringify(create.json));

    const fixed = await api(dealerA, "PATCH", `/api/quotations/${id}`, { discountType: "fixed", discountValue: 90000 });
    assert.equal(fixed.status, 400, "a fixed amount must not bypass the percentage cap");

    const adminOnDealer = await api(admin, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 25, customerDiscountPercent: 25 });
    assert.equal(adminOnDealer.status, 400);
    assert.match(JSON.stringify(adminOnDealer.json), /the dealer's allocated discount of 20%/);
  });

  await assertCase("5b. A dealer with 0% allocation cannot give any customer discount", async () => {
    const id = await newQuote(dealerZero);
    const patch = await api(dealerZero, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 5, customerDiscountPercent: 5 });
    assert.equal(patch.status, 400, JSON.stringify(patch.json));
    assert.match(JSON.stringify(patch.json), /allocated discount of 0%/);
    const zero = await api(dealerZero, "PATCH", `/api/quotations/${id}`, { discountType: "none", discountValue: 0, customerDiscountPercent: 0 });
    assert.equal(zero.status, 200);
  });

  await assertCase("5c. Quotations with no dealer keep their uncapped project discount", async () => {
    const id = await newQuote(superAdmin);
    const patch = await api(superAdmin, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 35, customerDiscountPercent: 35 });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
  });

  await assertCase("5d. Approve/reject/deliver cannot be forced through PATCH", async () => {
    const id = await newQuote(admin);
    for (const status of ["approved", "rejected", "delivered"]) {
      const res = await api(admin, "PATCH", `/api/quotations/${id}`, { status });
      assert.equal(res.status, 400, `${status}: ${JSON.stringify(res.json)}`);
    }
  });

  let assignedId;
  await assertCase("7. Super Admin creates + assigns Dealer A: A sees it, earns from it, createdBy stays Super Admin", async () => {
    assignedId = await newQuote(superAdmin, { dealerId: 1 });
    const patch = await api(superAdmin, "PATCH", `/api/quotations/${assignedId}`, { discountType: "percentage", discountValue: 5, customerDiscountPercent: 5 });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
    await approve(assignedId);
    const stored = await db.collection("quotations").findOne({ _id: assignedId });
    assert.equal(stored.createdBy, "4");
    assert.equal(stored.dealerId, 1);
    const report = await earnings(dealerA);
    assert.ok(row(report, assignedId), "Dealer A sees the assigned quotation");
    assert.equal(row(report, assignedId).confirmedCommissionAmount, 15000, "100000 x (20% - 5%)");
    assert.equal(report.summary.confirmedEarnings, 25000);
    const list = await api(dealerA, "GET", "/api/quotations");
    assert.ok(list.data.some((q) => q.id === assignedId));
  });

  await assertCase("8. Dealer A cannot see Dealer B's quotation or earnings", async () => {
    const bId = await newQuote(dealerB);
    const aList = await api(dealerA, "GET", "/api/quotations");
    assert.ok(!aList.data.some((q) => q.id === bId));
    assert.equal((await api(dealerA, "GET", `/api/quotations/${bId}`)).status, 403);
    const bReport = await earnings(dealerB);
    assert.ok(row(bReport, bId));
    assert.ok(!row(bReport, assignedId), "Dealer B does not see Dealer A's earnings");
    assert.equal(bReport.summary.confirmedEarnings, 0);
    // A dealer cannot request another dealer's dashboard via ?dealerId
    const spoof = await api(dealerA, "GET", `/api/dealer/earnings?dealerId=2`);
    assert.equal(spoof.json.dealer.id, 1);
  });

  await assertCase("9. Allocation change keeps the old quotation's snapshot; new quotations use the new value", async () => {
    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { discountAllocationPercent: 5 } });
    const before = row(await earnings(dealerA), q1);
    assert.equal(before.allocatedDiscountPercent, 20, "old quotation keeps its 20% snapshot");
    assert.equal(before.confirmedCommissionAmount, 10000, "and its earning is not recalculated");
    const fresh = await newQuote(dealerA);
    assert.equal((await db.collection("quotations").findOne({ _id: fresh })).allocatedDiscountPercent, 5);
    const overOld = await api(dealerA, "PATCH", `/api/quotations/${fresh}`, { discountType: "percentage", discountValue: 10, customerDiscountPercent: 10 });
    assert.equal(overOld.status, 400, "new quotation is capped by the NEW allocation");
    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { discountAllocationPercent: 20 } });
  });

  await assertCase("10. Clone of an approved quotation starts as a Draft with no confirmed earning", async () => {
    const before = (await earnings(dealerA)).summary.confirmedEarnings;
    const clone = await api(dealerA, "POST", `/api/quotations/${q1}/duplicate`);
    assert.equal(clone.status, 201, JSON.stringify(clone.json));
    const stored = await db.collection("quotations").findOne({ _id: clone.data.id });
    assert.equal(stored.status, "draft");
    assert.equal(stored.customerDiscountPercent, 0);
    assert.equal(Number(stored.estimatedEarningAmount?.toString() ?? 0), 0);
    assert.notEqual(stored.quotationNumber, (await db.collection("quotations").findOne({ _id: q1 })).quotationNumber);
    const report = await earnings(dealerA);
    assert.equal(report.summary.confirmedEarnings, before, "clone adds no confirmed earning");
    assert.equal(row(report, clone.data.id).confirmedCommissionAmount, 0);
    assert.equal(row(report, q1).confirmedCommissionAmount, 10000, "original is unchanged");
  });

  await assertCase("11. Decimal128 values serialize as plain numbers (no BSON leakage)", async () => {
    const report = await api(dealerA, "GET", "/api/dealer/earnings");
    const detail = await api(dealerA, "GET", `/api/quotations/${q1}`);
    const list = await api(dealerA, "GET", "/api/quotations");
    for (const [name, payload] of [["earnings", report.text], ["detail", detail.text], ["list", list.text]]) {
      assert.ok(!/\$numberDecimal|"bytes"|"buffer"/.test(payload), `${name} payload leaks BSON`);
    }
    assert.equal(typeof report.json.summary.confirmedEarnings, "number");
    assert.equal(typeof row(report.json, q1).confirmedCommissionAmount, "number");
    const listed = list.data.find((q) => q.id === q1);
    assert.equal(typeof listed.estimatedEarningAmount, "number");
    assert.equal(listed.estimatedEarningAmount, 10000);
  });

  await assertCase("12. Rejected quotation does not count toward confirmed or estimated earnings", async () => {
    const before = await earnings(dealerA);
    const id = await newQuote(dealerA);
    await api(dealerA, "POST", `/api/quotations/${id}/mark-sent`);
    const rejected = await api(admin, "POST", `/api/quotations/${id}/transition`, { action: "reject" });
    assert.equal(rejected.status, 200);
    const after = await earnings(dealerA);
    assert.equal(after.summary.confirmedEarnings, before.summary.confirmedEarnings);
    assert.equal(after.summary.estimatedCommission, before.summary.estimatedCommission);
    assert.equal(after.summary.rejectedCount, before.summary.rejectedCount + 1);
    assert.equal(row(after, id).confirmedCommissionAmount, 0);
  });

  await assertCase("Admin approving without any dealer earns nothing and does not break", async () => {
    const id = await newQuote(admin);
    await approve(id);
    const stored = await db.collection("quotations").findOne({ _id: id });
    assert.equal(Number(stored.estimatedEarningAmount.toString()), 0);
  });

  await assertCase("Reassigning to a dealer whose allocation is below the current discount is rejected", async () => {
    const id = await newQuote(dealerA);
    await api(dealerA, "PATCH", `/api/quotations/${id}`, { discountType: "percentage", discountValue: 15, customerDiscountPercent: 15 });
    const res = await api(superAdmin, "POST", `/api/quotations/${id}/assign`, { dealerId: 2 });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal((await db.collection("quotations").findOne({ _id: id })).dealerId, 1);
  });

  const failures = summary();
  if (failures > 0) process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
