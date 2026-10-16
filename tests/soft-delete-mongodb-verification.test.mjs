/**
 * Direct MongoDB verification of the soft-delete flow (written fresh for
 * this audit — not a reconstruction of any previously-removed suite).
 * Exercises the exact 7-step checklist: capture a record, delete it through
 * the real API, confirm it survives in MongoDB with isDeleted/deletedAt set,
 * confirm it disappears from lists/dropdowns, confirm a historical reference
 * still resolves, and confirm an unauthorized delete is rejected.
 *
 *   node tests/soft-delete-mongodb-verification.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "sd-mongo-verify",
    [
      { _id: 1, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 1 },
      { _id: 2, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api } = server;
  const now = new Date();

  await db.collection("companies").insertOne({ _id: 1, name: "Company A", slug: "company-a", status: "active", phone: "1111111111", address: "A St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });

  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertOne({ _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 1, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertOne({
    _id: 1, companyId: 1, name: "Verify Switch", code: "VERIFY-1", type: "switch_board", categoryId: 1, unit: "pcs",
    isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now,
  });
  await db.collection("productvariants").insertOne({
    _id: 1, companyId: 1, productId: 1, variantCode: "VERIFY-1-A", config: {}, price: Decimal128.fromString("500.00"),
    priceWithoutTax: Decimal128.fromString("500.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1,
  });

  const superCookie = await login("owner_a@example.com", "admin");
  const dealerA = await login("dealer_a@example.com", "user");

  // ═══ Step 1: capture the record before deletion ════════════════════
  const before = await db.collection("products").findOne({ _id: 1 });
  assert.ok(before, "the record must exist before deletion");
  assert.equal(before.isDeleted, undefined, "a fresh record has no isDeleted field at all (legacy-style)");
  pass("Step 1 — captured Product #1 before deletion: no isDeleted field, as a normal pre-existing record");

  // A quotation referencing it, built BEFORE deletion, to check historical resolution afterward.
  const quotation = await api(dealerA, "POST", "/api/quotations", { clientName: "MongoDB Verify Client", houseTypeId: 1 });
  assert.equal(quotation.status, 201);
  const quotationId = quotation.data.id ?? quotation.data._id;
  const roomId = (await api(dealerA, "GET", `/api/quotations/${quotationId}`)).data.rooms[0].id;
  const item = await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, {
    quotationRoomId: roomId, productId: 1, productVariantId: 1, quantity: 1,
  });
  assert.equal(item.status, 201, `item creation must succeed, got ${item.status} ${item.text?.slice(0, 200)}`);

  // ═══ Step 7 (checked early, before mutating anything): unauthorized rejection ═══
  const unauthDelete = await api("", "DELETE", "/api/products/1");
  assert.equal(unauthDelete.status, 401, "an unauthenticated delete request must be rejected");
  const dealerDelete = await api(dealerA, "DELETE", "/api/products/1");
  assert.equal(dealerDelete.status, 403, "a dealer (no catalog-write permission) must not be able to delete a product");
  const stillThereAfterRejected = await db.collection("products").findOne({ _id: 1 });
  assert.equal(stillThereAfterRejected.isDeleted, undefined, "a rejected delete must leave the record completely untouched");
  pass("Step 7 — unauthenticated and under-privileged delete requests are both rejected (401/403), record left untouched");

  // ═══ Step 2: execute the application's normal delete endpoint ══════
  const deleteResponse = await api(superCookie, "DELETE", "/api/products/1");
  assert.equal(deleteResponse.status, 200, `the authorized delete must succeed, got ${deleteResponse.status}`);
  pass("Step 2 — executed DELETE /api/products/1 as company_owner: 200 OK");

  // ═══ Step 3 + 4: confirm the record still exists, isDeleted/deletedAt set ═══
  const after = await db.collection("products").findOne({ _id: 1 });
  assert.ok(after, "Step 3 — the record must still physically exist in MongoDB after the delete endpoint runs");
  assert.equal(after.name, "Verify Switch", "the record's own data is untouched — only the soft-delete fields change");
  assert.equal(after.isDeleted, true, "Step 4 — isDeleted must be true");
  assert.ok(after.deletedAt instanceof Date, "Step 4 — deletedAt must be populated");
  assert.equal(after.deletedBy, 1, "deletedBy must be the server-trusted session user id (company_owner, _id 1), never client input");
  pass("Step 3/4 — confirmed directly in MongoDB: the document still exists, isDeleted=true, deletedAt populated, deletedBy=1 (the actor)");

  // Repeated delete requests must not corrupt state (idempotency / no double-processing).
  const secondDelete = await api(superCookie, "DELETE", "/api/products/1");
  assert.equal(secondDelete.status, 404, "a second delete of an already-deleted record must 404, not silently succeed or error oddly");
  const afterSecond = await db.collection("products").findOne({ _id: 1 });
  assert.equal(afterSecond.deletedAt.getTime(), after.deletedAt.getTime(), "a repeated delete request must not change deletedAt or otherwise mutate the record");
  pass("repeated delete requests do not cause inconsistent state — the second attempt 404s and nothing about the record changes");

  // ═══ Step 5: confirm ordinary lists/dropdowns exclude it ═══════════
  const listAfter = await api(dealerA, "GET", "/api/products");
  const listItems = Array.isArray(listAfter.data) ? listAfter.data : listAfter.data?.items ?? [];
  assert.ok(!listItems.some((p) => (p.id ?? p._id) === 1), "Step 5 — the soft-deleted product must not appear in the normal catalog list");
  pass("Step 5 — confirmed: the ordinary product list/dropdown (GET /api/products) excludes the soft-deleted record");

  // Also confirm it can no longer be newly assigned to a quotation item.
  const newItemAttempt = await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, {
    quotationRoomId: roomId, productId: 1, productVariantId: 1, quantity: 1,
  });
  assert.ok(newItemAttempt.status >= 400, "a soft-deleted product must not be assignable to a NEW quotation item");
  pass("a soft-deleted product cannot be newly assigned to a quotation item (server-side rejected, not just hidden in the UI)");

  // ═══ Step 6: confirm the historical reference still resolves ══════
  const quotationDetail = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(quotationDetail.status, 200);
  const historicalItem = quotationDetail.data.rooms[0].items.find((i) => i.productId === 1);
  assert.ok(historicalItem, "the item referencing the now-deleted product must still be present in the quotation");
  assert.equal(historicalItem.product?.name, "Verify Switch", "Step 6 — the historical product name must still resolve despite the soft delete");
  assert.equal(historicalItem.isUnavailable, true, "the item is correctly flagged unavailable (excluded from totals), while still fully rendering its historical detail");
  pass("Step 6 — confirmed: the historical quotation still resolves and renders the deleted product's name, flagged unavailable rather than blanked out");

  console.log(`\nMongoDB soft-delete verification PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
