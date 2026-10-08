import assert from "node:assert/strict";
import { createRunner, startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Server-side enforcement: a quotation with zero products cannot move
 * Draft -> Sent (mark-sent) or Sent -> Approved (transition), even when
 * called directly against the API (bypassing the builder UI gate entirely).
 * Also covers the edge case the UI gate alone cannot prevent: every item
 * being deleted from a quotation AFTER it was marked "sent".
 */

const { assertCase, summary } = createRunner();
let server;

try {
  server = await startIsolatedServer("product-gate-api", [
    { _id: 1, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 2, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
  ]);
  const { db, login, api } = server;

  const admin = await login("admin_user@example.com", "admin");
  const superAdmin = await login("super_admin@example.com", "admin");

  let seq = 1;
  async function addRoom(quotationId) {
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    return roomId;
  }
  async function addItem(roomId, amount = 1000) {
    const itemId = seq++;
    await db.collection("quotationitems").insertOne({
      _id: itemId,
      quotationRoomId: roomId,
      productId: 1,
      productVariantId: null,
      variantLabel: null,
      variantConfig: null,
      sbNumber: null,
      quantity: 1,
      unitPrice: Decimal128.fromString(amount.toFixed(2)),
      priceWithoutTax: Decimal128.fromString((amount / 1.18).toFixed(2)),
      taxPercent: Decimal128.fromString("18"),
      taxAmount: Decimal128.fromString((amount - amount / 1.18).toFixed(2)),
      notes: null,
      sortOrder: 0,
    });
    return itemId;
  }
  async function newDraftQuote(cookie) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName: "Product Gate API Client" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.data.id;
  }

  // ── 1. mark-sent blocked with 0 items ───────────────────────────────────
  let draftWithEmptyRoomId;
  await assertCase("mark-sent on a draft with a room but 0 items is rejected", async () => {
    const quotationId = await newDraftQuote(admin);
    draftWithEmptyRoomId = quotationId;
    await addRoom(quotationId); // a room with no items — still 0 products

    const res = await api(admin, "POST", `/api/quotations/${quotationId}/mark-sent`, undefined);
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}: ${res.text}`);
    assert.match(res.json?.error?.message ?? "", /product/i, JSON.stringify(res.json));
  });

  await assertCase("quotation status is still draft after the blocked mark-sent", async () => {
    const after = await api(admin, "GET", `/api/quotations/${draftWithEmptyRoomId}`);
    assert.equal(after.data.status, "draft");
  });

  // ── 2. mark-sent succeeds once an item exists ───────────────────────────
  let sentQuotationId;
  await assertCase("mark-sent succeeds once the quotation has a product", async () => {
    const quotationId = await newDraftQuote(admin);
    const roomId = await addRoom(quotationId);
    await addItem(roomId);

    const res = await api(admin, "POST", `/api/quotations/${quotationId}/mark-sent`, undefined);
    assert.ok(res.status < 300, `status ${res.status}: ${res.text}`);
    assert.equal(res.data.status, "sent");
    sentQuotationId = quotationId;
  });

  // ── 3. approve blocked when a "sent" quotation's items were all removed
  //        after it was sent (the UI-only gate from the builder cannot catch
  //        this — only server-side enforcement on approve can) ────────────
  await assertCase("super admin cannot approve a 'sent' quotation whose items were later deleted", async () => {
    const rooms = await db.collection("quotationrooms").find({ quotationId: sentQuotationId }).toArray();
    await db.collection("quotationitems").deleteMany({ quotationRoomId: { $in: rooms.map((r) => r._id) } });

    const stillSent = await api(admin, "GET", `/api/quotations/${sentQuotationId}`);
    assert.equal(stillSent.data.status, "sent", "quotation should still be 'sent' after its items were deleted");
    assert.ok(
      (stillSent.data.rooms || []).every((r) => (r.items || []).length === 0),
      "sanity check: quotation now has 0 products"
    );

    const approveRes = await api(superAdmin, "POST", `/api/quotations/${sentQuotationId}/transition`, { action: "approve" });
    assert.ok(approveRes.status >= 400 && approveRes.status < 500, `expected 4xx, got ${approveRes.status}: ${approveRes.text}`);
    assert.match(approveRes.json?.error?.message ?? "", /product/i, JSON.stringify(approveRes.json));
  });

  await assertCase("status is still sent, not approved, after the blocked approve", async () => {
    const after = await api(admin, "GET", `/api/quotations/${sentQuotationId}`);
    assert.equal(after.data.status, "sent");
  });

  // ── 4. approve succeeds once a product is added back ───────────────────
  await assertCase("super admin can approve once the quotation has a product again", async () => {
    const roomId = await addRoom(sentQuotationId);
    await addItem(roomId, 2000);

    const approveRes = await api(superAdmin, "POST", `/api/quotations/${sentQuotationId}/transition`, { action: "approve" });
    assert.ok(approveRes.status < 300, `status ${approveRes.status}: ${approveRes.text}`);
    assert.equal(approveRes.data.status, "approved");
  });

  // ── 5. reject is NOT blocked by the product gate (rejecting an incomplete
  //        submission is a legitimate, harmless action) ──────────────────
  await assertCase("reject is still allowed on a 'sent' quotation with 0 products", async () => {
    const quotationId = await newDraftQuote(admin);
    const roomId = await addRoom(quotationId);
    await addItem(roomId);
    await api(admin, "POST", `/api/quotations/${quotationId}/mark-sent`, undefined);
    await db.collection("quotationitems").deleteMany({ quotationRoomId: roomId });

    const rejectRes = await api(superAdmin, "POST", `/api/quotations/${quotationId}/transition`, { action: "reject" });
    assert.ok(rejectRes.status < 300, `status ${rejectRes.status}: ${rejectRes.text}`);
    assert.equal(rejectRes.data.status, "rejected");
  });

  // ── 6. the quotations list exposes productsCount so the UI can disable
  //        the Approve button client-side too ────────────────────────────
  await assertCase("GET /api/quotations rows carry a numeric productsCount", async () => {
    const list = await api(superAdmin, "GET", "/api/quotations");
    const rows = Array.isArray(list.data) ? list.data : list.data?.quotations ?? [];
    assert.ok(rows.length > 0, "expected at least one quotation row");
    assert.equal(typeof rows[0].productsCount, "number", JSON.stringify(rows[0]));
  });

  const failures = summary();
  if (failures > 0) process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
