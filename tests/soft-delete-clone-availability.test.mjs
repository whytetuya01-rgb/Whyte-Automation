/**
 * Quotation cloning must never copy an unavailable product/variant into the
 * new quotation — reuses `@/lib/quotationAvailability`'s shared predicates
 * (the same ones `quotationNormalization.ts`/`quotationTotals.ts` use), no
 * duplicate logic. Covers the 6 scenarios asked for: clean clone, a
 * soft-deleted product, a soft-deleted variant, cloning an Approved source,
 * cloning a Delivered source, and confirming the source is never modified.
 *
 *   node tests/soft-delete-clone-availability.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "sd-clone-avail",
    [
      { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 2, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20 },
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
    { _id: 2, name: "Doomed Product", code: "DOOM-P", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 3, name: "Doomed Variant Host", code: "DOOM-V", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 3, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  // taxPercent 0 + priceWithoutTax === price avoids GST-rounding drift.
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "KEEP-1-A", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 2, variantCode: "DOOM-P-A", config: {}, price: Decimal128.fromString("2000.00"), priceWithoutTax: Decimal128.fromString("2000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    { _id: 3, productId: 3, variantCode: "DOOM-V-A", config: {}, price: Decimal128.fromString("500.00"), priceWithoutTax: Decimal128.fromString("500.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    // A second, surviving variant so product #3 never trips MINIMUM_VARIANT when variant #3 is deleted.
    { _id: 4, productId: 3, variantCode: "DOOM-V-B", config: {}, price: Decimal128.fromString("500.00"), priceWithoutTax: Decimal128.fromString("500.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 2 },
  ]);

  const superCookie = await login("super_admin@example.com", "admin");
  const dealerA = await login("dealer_a@example.com", "user");

  async function buildQuotation(clientName) {
    const created = await api(dealerA, "POST", "/api/quotations", { clientName, houseTypeId: 1 });
    assert.equal(created.status, 201);
    const id = created.data.id ?? created.data._id;
    const roomId = (await api(dealerA, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    await api(dealerA, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 1, productVariantId: 1, quantity: 1 }); // keeper: 1000
    await api(dealerA, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 2, productVariantId: 2, quantity: 1 }); // to be doomed: 2000
    await api(dealerA, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 3, productVariantId: 3, quantity: 1 }); // to be doomed: 500
    return { id, roomId };
  }

  // ═══ 1. Clone with all products available — nothing skipped ═══════
  const cleanSource = await buildQuotation("Clean Clone Source");
  const cleanClone = await api(dealerA, "POST", `/api/quotations/${cleanSource.id}/duplicate`);
  assert.equal(cleanClone.status, 201);
  assert.deepEqual(cleanClone.data.skippedItems, [], "nothing should be skipped when every referenced product/variant is still live");
  const cleanCloneDetail = await api(dealerA, "GET", `/api/quotations/${cleanClone.data.id}`);
  assert.equal(cleanCloneDetail.data.rooms[0].items.length, 3, "all 3 items must be copied when nothing is unavailable");
  assert.equal(cleanCloneDetail.data.subtotal, 1000 + 2000 + 500);
  pass("clone with every product/variant available: all items copied, nothing skipped, subtotal matches exactly");

  // Build every other quotation this test needs WHILE the catalog is still
  // fully live — an item can only ever be added while its product/variant
  // is live (the reference-creation guard correctly rejects otherwise), so
  // "a product that was live when quoted, later soft-deleted" must be
  // built in that order, not the reverse.
  const source = await buildQuotation("Mixed Availability Source");
  const approvedSource = await buildQuotation("approved Source");
  const deliveredSource = await buildQuotation("delivered Source");

  // ═══ 2/3. Soft-delete a product and a variant, then clone ═════════
  assert.equal((await api(superCookie, "DELETE", "/api/products/2")).status, 200); // doomed product
  assert.equal((await api(superCookie, "DELETE", "/api/product-variants/3")).status, 200); // doomed variant

  const sourceDetailBefore = await api(dealerA, "GET", `/api/quotations/${source.id}`);
  assert.equal(sourceDetailBefore.data.rooms[0].items.length, 3, "the SOURCE quotation itself still has all 3 items stored");

  const clone = await api(dealerA, "POST", `/api/quotations/${source.id}/duplicate`);
  assert.equal(clone.status, 201);
  assert.equal(clone.data.skippedItems.length, 2, "exactly 2 items (the doomed product and the doomed variant) must be reported skipped");
  const skippedLabels = clone.data.skippedItems.map((s) => s.label).sort();
  assert.deepEqual(skippedLabels, ["Doomed Product", "Doomed Variant Host"]);
  assert.deepEqual(clone.data.skippedItems.map((s) => s.reason).sort(), ["product", "variant"]);
  pass("clone with a soft-deleted product AND a soft-deleted variant in the same quotation: both correctly identified and reported skipped, by name and reason");

  // ═══ Verify the persisted clone itself: only the keeper item exists ═══
  const cloneDetail = await api(dealerA, "GET", `/api/quotations/${clone.data.id}`);
  assert.equal(cloneDetail.data.rooms[0].items.length, 1, "only the keeper item must actually be persisted in the clone");
  assert.equal(cloneDetail.data.rooms[0].items[0].productId, 1);
  assert.equal(cloneDetail.data.subtotal, 1000, "the clone's subtotal must be ONLY the keeper item's amount — the skipped items' prices/quantities must never count toward it");
  assert.equal(cloneDetail.data.productsCount, 1);
  pass("the persisted clone contains only the available item, and its subtotal/count reflect only that item — skipped items contribute nothing");

  const cloneRaw = await db.collection("quotations").findOne({ _id: clone.data.id });
  const cloneRoomsRaw = await db.collection("quotationrooms").find({ quotationId: clone.data.id }).toArray();
  const cloneItemsRaw = await db.collection("quotationitems").find({ quotationRoomId: { $in: cloneRoomsRaw.map((r) => r._id) } }).toArray();
  assert.equal(cloneRoomsRaw.length, 1, "the room itself is still cloned (layout preserved) even though 2 of its items were skipped");
  assert.equal(cloneItemsRaw.length, 1, "exactly one item document exists for the clone in MongoDB — the skipped ones were never written, not written-then-hidden");
  pass("confirmed directly in MongoDB: the clone has exactly one persisted item document; the two skipped items were never written at all");

  // ═══ 4/5. Clone an Approved, then a Delivered, source with an unavailable item ═══
  for (const [status, protectedSource] of [["approved", approvedSource], ["delivered", deliveredSource]]) {
    await db.collection("quotations").updateOne({ _id: protectedSource.id }, { $set: { status } });

    const protectedDetailBefore = await db.collection("quotations").findOne({ _id: protectedSource.id });

    const protectedClone = await api(dealerA, "POST", `/api/quotations/${protectedSource.id}/duplicate`);
    assert.equal(protectedClone.status, 201, `duplicating a ${status} quotation must still succeed`);
    assert.equal(protectedClone.data.status, "draft", "a clone always starts as a new draft, regardless of the source's status");
    assert.equal(protectedClone.data.skippedItems.length, 2, `cloning the ${status} source must still skip its 2 unavailable items`);

    // The SOURCE must be completely untouched — same status, same items, same count.
    const protectedDetailAfter = await db.collection("quotations").findOne({ _id: protectedSource.id });
    assert.equal(protectedDetailAfter.status, status, `the source quotation's status must remain ${status}`);
    assert.deepEqual(protectedDetailAfter, protectedDetailBefore, "the source quotation document must be byte-for-byte unchanged by cloning it");
    const sourceItemsAfter = await db.collection("quotationrooms")
      .find({ quotationId: protectedSource.id })
      .toArray()
      .then(async (rooms) => db.collection("quotationitems").countDocuments({ quotationRoomId: { $in: rooms.map((r) => r._id) } }));
    assert.equal(sourceItemsAfter, 3, `the ${status} source must still have all 3 of its original items — the availability check applies to the clone only, never to the source`);

    const protectedCloneDetail = await api(dealerA, "GET", `/api/quotations/${protectedClone.data.id}`);
    assert.equal(protectedCloneDetail.data.rooms[0].items.length, 1, `the ${status} source's clone must contain only the 1 available item`);
    assert.equal(protectedCloneDetail.data.subtotal, 1000, `the ${status} source's clone subtotal must reflect only the available item`);

    const sourceApiDetail = await api(dealerA, "GET", `/api/quotations/${protectedSource.id}`);
    assert.equal(sourceApiDetail.data.rooms[0].items.length, 3, `reading the ${status} source via the API must still show all 3 original items, unavailable ones flagged but present, totals preserved historically`);

    pass(`clone a ${status} source containing an unavailable product: the clone skips it correctly (2 skipped, draft status, reduced subtotal), while the source remains completely unchanged (3 items, ${status} status, unmodified document)`);
  }

  console.log(`\nClone availability PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
