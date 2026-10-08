import assert from "node:assert/strict";
import { createRunner, startIsolatedServer } from "./helpers/isolatedServer.mjs";

/**
 * Phase 3 Step 3.3 regression: for every item/room mutation, the endpoint's
 * OWN response must be identical to what a subsequent real
 * `GET /api/quotations/[id]` shows for that same entity. Both the mutation
 * response and the GET response are already normalized server-side by the
 * exact same `normalizeQuotationItem`/`normalizeQuotationRoom`/
 * `normalizeQuotation` functions — `ProposalBuilder.tsx` additionally runs
 * the client copy of those same (defensive, idempotent) functions over the
 * mutation response before merging it into local state, exactly as it
 * already did for a GET response, so comparing the two raw API responses
 * directly is what matters: it proves the data `ProposalBuilder.tsx` merges
 * locally is the same data a refetch would have produced, without needing to
 * re-import the client bundle into this plain Node test.
 */
const { assertCase, summary } = createRunner();
let server;
const { Decimal128 } = await import("./helpers/isolatedServer.mjs");

try {
  server = await startIsolatedServer("phase3mutation", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
  ]);
  const { db, login, api } = server;

  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("products").insertMany([
    { _id: 1, name: "Switch A", code: "SW-A", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: new Date(), updatedAt: new Date() },
    { _id: 2, name: "Switch B", code: "SW-B", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: new Date(), updatedAt: new Date() },
  ]);
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "SW-A-V1", config: {}, price: Decimal128.fromString("118.00"), priceWithoutTax: Decimal128.fromString("100.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 2, variantCode: "SW-B-V1", config: {}, price: Decimal128.fromString("236.00"), priceWithoutTax: Decimal128.fromString("200.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, name: "Bedroom", isActive: true, sortOrder: 2 },
  ]);

  const dealer = await login("dealer_a@example.com", "user");

  let quotationId;
  let room1Id;
  let room2Id;
  let item1Id;

  await assertCase("Setup: create quotation with 2 rooms and 2 items", async () => {
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Phase 3 Parity Client" });
    assert.equal(q.status, 201, q.text);
    quotationId = q.data.id;

    const r1 = await api(dealer, "POST", `/api/quotations/${quotationId}/rooms`, { roomTypeId: 1, customName: "Room 1" });
    assert.equal(r1.status, 201, r1.text);
    room1Id = r1.data.id;

    const r2 = await api(dealer, "POST", `/api/quotations/${quotationId}/rooms`, { roomTypeId: 2, customName: "Room 2" });
    assert.equal(r2.status, 201, r2.text);
    room2Id = r2.data.id;

    const i1 = await api(dealer, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room1Id, productId: 1, quantity: 1 });
    assert.equal(i1.status, 201, i1.text);
    item1Id = i1.data.id;

    const i2 = await api(dealer, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room1Id, productId: 2, quantity: 2 });
    assert.equal(i2.status, 201, i2.text);
  });

  await assertCase("Mutation parity: add item response matches a fresh GET", async () => {
    const addRes = await api(dealer, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room2Id, productId: 1, quantity: 1 });
    assert.equal(addRes.status, 201, addRes.text);
    const created = addRes.data;

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    const freshRoom2 = fresh.data.rooms.find((r) => Number(r.id) === Number(room2Id));
    const freshItem = freshRoom2.items.find((it) => Number(it.id) === Number(created.id));
    assert.ok(freshItem, "added item must appear in a fresh GET, in its target room");
    // It must also be the LAST item in that room — this is the ordering claim
    // `upsertItemLocally`'s "always append" relies on.
    assert.equal(Number(freshRoom2.items[freshRoom2.items.length - 1].id), Number(created.id));

    for (const field of ["id", "quotationRoomId", "productId", "unitPrice", "quantity"]) {
      assert.equal(String(created[field]), String(freshItem[field]), `field ${field} must match`);
    }
    assert.equal(created.product?.name, freshItem.product?.name);
  });

  await assertCase("Mutation parity: quantity update response matches a fresh GET", async () => {
    const patchRes = await api(dealer, "PATCH", `/api/quotations/${quotationId}/items/${item1Id}`, { quantity: 5 });
    assert.equal(patchRes.status, 200, patchRes.text);
    assert.equal(patchRes.data.quantity, 5);

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    const freshItem = fresh.data.rooms.flatMap((r) => r.items).find((it) => Number(it.id) === Number(item1Id));
    assert.equal(patchRes.data.quantity, freshItem.quantity);
    assert.equal(String(patchRes.data.unitPrice), String(freshItem.unitPrice));
    // Position unchanged: still in room 1, not moved.
    const freshRoom1 = fresh.data.rooms.find((r) => Number(r.id) === Number(room1Id));
    assert.ok(freshRoom1.items.some((it) => Number(it.id) === Number(item1Id)));
  });

  await assertCase("Mutation parity: variant replace response matches a fresh GET", async () => {
    const patchRes = await api(dealer, "PATCH", `/api/quotations/${quotationId}/items/${item1Id}`, {
      productId: 2,
      productVariantId: 2,
    });
    assert.equal(patchRes.status, 200, patchRes.text);

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    const freshItem = fresh.data.rooms.flatMap((r) => r.items).find((it) => Number(it.id) === Number(item1Id));
    assert.equal(patchRes.data.productId, freshItem.productId);
    assert.equal(String(patchRes.data.unitPrice), String(freshItem.unitPrice));
    assert.equal(patchRes.data.product?.name, freshItem.product?.name);
    assert.equal(patchRes.data.productVariant?.id, freshItem.productVariant?.id);
  });

  await assertCase("Mutation parity: room update (notes) response matches a fresh GET", async () => {
    const patchRes = await api(dealer, "PATCH", `/api/quotations/${quotationId}/rooms/${room1Id}`, { notes: "Install near door" });
    assert.equal(patchRes.status, 200, patchRes.text);

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    const freshRoom = fresh.data.rooms.find((r) => Number(r.id) === Number(room1Id));
    assert.equal(patchRes.data.notes, freshRoom.notes);
    assert.equal((patchRes.data.items || []).length, freshRoom.items.length);
  });

  await assertCase("Mutation parity: discount update response matches a fresh GET", async () => {
    const patchRes = await api(dealer, "PATCH", `/api/quotations/${quotationId}`, {
      discountType: "percentage",
      discountValue: 10,
      customerDiscountPercent: 10,
    });
    assert.equal(patchRes.status, 200, patchRes.text);

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    for (const field of ["subtotal", "discountAmount", "netSubtotal", "grandTotal", "estimatedEarningAmount", "customerDiscountPercent"]) {
      assert.equal(Number(patchRes.data[field]), Number(fresh.data[field]), `field ${field} must match`);
    }
  });

  await assertCase("Mutation parity: item delete removes from the right room, matching a fresh GET", async () => {
    const delRes = await api(dealer, "DELETE", `/api/quotations/${quotationId}/items/${item1Id}`);
    assert.equal(delRes.status, 200, delRes.text);

    const fresh = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    const stillThere = fresh.data.rooms.flatMap((r) => r.items).some((it) => Number(it.id) === Number(item1Id));
    assert.equal(stillThere, false, "deleted item must be gone from a fresh GET too");
  });

  if (summary() > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
