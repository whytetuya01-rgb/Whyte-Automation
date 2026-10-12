/**
 * Phase 4.1 — closes the two gaps found after Phase 4:
 *   1. GET /api/quotations (the list) computed its own `subtotal`/`totalAmount`
 *      independently of `normalizeQuotation`/`aggregateQuotationRoomTotals`,
 *      so it still summed an unavailable item's amount for a non-protected
 *      quotation — disagreeing with the detail view for the exact same
 *      quotation. Fixed by reusing the same shared predicates
 *      (`@/lib/quotationAvailability`) in `withDerivedTotals`.
 *   2. The PDF/proposal preview table had no per-item indicator (only the
 *      room-level one) — covered by a compact `UnavailabilityWarning` pill;
 *      not independently testable here without browser rendering, see the
 *      report for what was and wasn't verified for that part.
 *
 *   node tests/soft-delete-phase4-1.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "softdelete-phase4-1",
    [
      { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 2, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20 },
      { _id: 3, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 20 },
    ],
    { production: true }
  );
  const { db, login, api } = server;
  const now = new Date();

  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertOne({ _id: 1, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 1, name: "2BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertMany([
    { _id: 1, name: "Keeper Switch", code: "KEEP-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2, name: "Doomed Switch", code: "DOOM-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  // taxPercent 0 + priceWithoutTax === price avoids any GST-rounding drift —
  // see the identical comment in soft-delete-phase4.test.mjs.
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "KEEP-1-A", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 2, variantCode: "DOOM-1-A", config: {}, price: Decimal128.fromString("2000.00"), priceWithoutTax: Decimal128.fromString("2000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
  ]);

  const superCookie = await login("super_admin@example.com", "admin");
  const dealerA = await login("dealer_a@example.com", "user");

  // ═══ 1. Build a draft quotation with one keeper item, one doomed item ═

  const created = await api(dealerA, "POST", "/api/quotations", { clientName: "List Totals Client", houseTypeId: 1 });
  assert.equal(created.status, 201);
  const quotationId = created.data.id ?? created.data._id;
  const roomId = (await api(dealerA, "GET", `/api/quotations/${quotationId}`)).data.rooms[0].id;

  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: roomId, productId: 1, productVariantId: 1, quantity: 1 });
  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: roomId, productId: 2, productVariantId: 2, quantity: 1 });

  const listBefore = await api(dealerA, "GET", "/api/quotations");
  const rowsBefore = listBefore.data?.items ?? (Array.isArray(listBefore.data) ? listBefore.data : []);
  const rowBefore = rowsBefore.find((q) => (q.id ?? q._id) === quotationId);
  assert.ok(rowBefore, "the quotation must appear in the list");
  assert.equal(rowBefore.subtotal, 3000, "before any deletion, the list subtotal is the full 1000+2000");
  assert.equal(rowBefore.hasUnavailableItems, false);
  pass("setup: list subtotal (3000) matches the full keeper+doomed total before any deletion");

  // ═══ 2. Soft-delete the doomed product, re-check the list ═══════════

  assert.equal((await api(superCookie, "DELETE", "/api/products/2")).status, 200);

  const listAfter = await api(dealerA, "GET", "/api/quotations");
  const rowsAfter = listAfter.data?.items ?? (Array.isArray(listAfter.data) ? listAfter.data : []);
  const rowAfter = rowsAfter.find((q) => (q.id ?? q._id) === quotationId);
  assert.ok(rowAfter, "the quotation must still appear in the list after the product delete");
  assert.equal(rowAfter.subtotal, 1000, "the list subtotal must exclude the now-unavailable product's amount — only the keeper item's 1000 remains");
  assert.equal(rowAfter.hasUnavailableItems, true);
  pass("list subtotal correctly excludes a soft-deleted product's item amount, and flags hasUnavailableItems");

  // ═══ 3. List and detail totals agree for the same quotation ═════════

  const detail = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(detail.data.subtotal, rowAfter.subtotal, "the list row and the detail view must report the IDENTICAL subtotal for the same quotation");
  assert.equal(detail.data.totalAmount, rowAfter.totalAmount, "…and the identical grand total");
  pass("the quotation list and the quotation detail view report byte-identical totals for the same quotation");

  // ═══ 4. Approved/Delivered: list preserves the historical total ═════

  const approved = await api(dealerA, "POST", "/api/quotations", { clientName: "Approved List Client", houseTypeId: 1 });
  const approvedId = approved.data.id ?? approved.data._id;
  const approvedRoomId = (await api(dealerA, "GET", `/api/quotations/${approvedId}`)).data.rooms[0].id;
  await api(dealerA, "POST", `/api/quotations/${approvedId}/items`, { quotationRoomId: approvedRoomId, productId: 1, productVariantId: 1, quantity: 2 });

  const listBeforeLock = await api(dealerA, "GET", "/api/quotations");
  const rowsBeforeLock = listBeforeLock.data?.items ?? (Array.isArray(listBeforeLock.data) ? listBeforeLock.data : []);
  const approvedRowBeforeLock = rowsBeforeLock.find((q) => (q.id ?? q._id) === approvedId);
  assert.equal(approvedRowBeforeLock.subtotal, 2000);

  await db.collection("quotations").updateOne({ _id: approvedId }, { $set: { status: "approved" } });
  assert.equal((await api(superCookie, "DELETE", "/api/products/1")).status, 200); // deletes the product this approved quotation uses too

  const listAfterLockAndDelete = await api(dealerA, "GET", "/api/quotations");
  const rowsAfterLockAndDelete = listAfterLockAndDelete.data?.items ?? (Array.isArray(listAfterLockAndDelete.data) ? listAfterLockAndDelete.data : []);
  const approvedRowAfter = rowsAfterLockAndDelete.find((q) => (q.id ?? q._id) === approvedId);
  assert.ok(approvedRowAfter, "the approved quotation must still appear in the list");
  assert.equal(approvedRowAfter.subtotal, 2000, "an Approved quotation's LIST subtotal must stay exactly as it was, even after the referenced product is soft-deleted");
  pass("Approved quotation: the list row's subtotal is preserved exactly, matching the detail view's historical-preservation rule");

  // ═══ 5. Search, pagination, and dealer visibility still work ════════

  const searchResult = await api(dealerA, "GET", `/api/quotations?search=${encodeURIComponent("List Totals Client")}`);
  assert.equal(searchResult.status, 200);
  const searchRows = searchResult.data?.items ?? (Array.isArray(searchResult.data) ? searchResult.data : []);
  assert.ok(searchRows.some((q) => (q.id ?? q._id) === quotationId), "search must still find the quotation with unavailable items");

  const paginated = await api(dealerA, "GET", "/api/quotations?page=1&pageSize=1");
  assert.equal(paginated.status, 200);
  assert.ok(paginated.data?.items || Array.isArray(paginated.data), "pagination must still return a valid page");
  if (paginated.data?.pagination) {
    assert.ok(paginated.data.pagination.total >= 2, "pagination total count must still include both quotations");
  }
  pass("search and pagination continue to work correctly alongside the new eligibility-aware list totals");

  const dealerBLogin = await login("dealer_b@example.com", "user");
  const dealerBList = await api(dealerBLogin, "GET", "/api/quotations");
  const dealerBRows = dealerBList.data?.items ?? (Array.isArray(dealerBList.data) ? dealerBList.data : []);
  assert.ok(!dealerBRows.some((q) => (q.id ?? q._id) === quotationId), "dealer visibility must still be enforced — Dealer B must not see Dealer A's quotation");
  pass("dealer visibility on the list endpoint is unaffected by the new totals logic");

  console.log(`\nSoft-delete Phase 4.1 PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
