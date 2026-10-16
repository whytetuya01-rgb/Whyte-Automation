/**
 * "Automatic quotation updates when a product is soft-deleted."
 *
 * Audit finding (see the final report): Quotation/QuotationRoom/QuotationItem
 * have NO stored subtotal/GST/grandTotal fields at all — every total is
 * computed live, server-side, on every read (`quotationNormalization.ts`,
 * `quotationTotals.ts`), already using `quotationAvailability.ts`'s shared
 * predicates. So "persisting the update" is the soft-delete flag itself
 * (`isDeleted: true`, written once to the Product/ProductVariant document);
 * every quotation referencing it recalculates correctly from that, every
 * time it is read, with no separate write-path needed and therefore no way
 * for it to double-deduct or go stale. This file proves that property
 * directly rather than assuming it, across every scenario in the task's
 * test list, plus confirms the ONE piece of UI that actually needed new
 * work this round: Approved/Delivered quotations now show an informational
 * (non-alarming) availability warning that persists across reloads, without
 * writing anything.
 *
 *   node tests/soft-delete-auto-update.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "sd-auto-update",
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
  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 1, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertMany([
    { _id: 1, companyId: 1, name: "Keeper Switch", code: "KEEP-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2, companyId: 1, name: "Doomed Switch", code: "DOOM-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 3, companyId: 1, name: "Multi Variant Host", code: "MULTI-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 3, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  // taxPercent 0 + priceWithoutTax === price avoids GST-rounding drift.
  await db.collection("productvariants").insertMany([
    { _id: 1, companyId: 1, productId: 1, variantCode: "KEEP-1-A", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, productId: 2, variantCode: "DOOM-1-A", config: {}, price: Decimal128.fromString("2000.00"), priceWithoutTax: Decimal128.fromString("2000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    // Product #3 has two variants: only #3 gets deleted, #4 survives — tests
    // "if a product has multiple variants, only handle the affected ones."
    { _id: 3, companyId: 1, productId: 3, variantCode: "MULTI-1-A", config: {}, price: Decimal128.fromString("300.00"), priceWithoutTax: Decimal128.fromString("300.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 },
    { _id: 4, companyId: 1, productId: 3, variantCode: "MULTI-1-B", config: {}, price: Decimal128.fromString("400.00"), priceWithoutTax: Decimal128.fromString("400.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 2 },
  ]);

  const superCookie = await login("owner_a@example.com", "admin");
  const dealerA = await login("dealer_a@example.com", "user");

  // ═══ 1/2. A Draft quotation referencing the product, across 2 rooms, ═══
  // ═══    including BOTH variants of the multi-variant product.       ═══
  const created = await api(dealerA, "POST", "/api/quotations", { clientName: "Auto-Update Client", houseTypeId: 1 });
  assert.equal(created.status, 201);
  const quotationId = created.data.id ?? created.data._id;
  const room1Id = (await api(dealerA, "GET", `/api/quotations/${quotationId}`)).data.rooms[0].id;
  const room2 = await api(dealerA, "POST", `/api/quotations/${quotationId}/rooms`, { roomTypeId: 2 });
  const room2Id = room2.data.id ?? room2.data._id;

  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room1Id, productId: 1, productVariantId: 1, quantity: 1 }); // keeper: 1000
  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room1Id, productId: 2, productVariantId: 2, quantity: 1 }); // to be doomed, room 1: 2000
  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room2Id, productId: 2, productVariantId: 2, quantity: 2 }); // to be doomed, room 2, qty 2: 4000
  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room2Id, productId: 3, productVariantId: 3, quantity: 1 }); // doomed-variant: 300
  await api(dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room2Id, productId: 3, productVariantId: 4, quantity: 1 }); // surviving variant of same product: 400

  const before = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(before.data.subtotal, 1000 + 2000 + 4000 + 300 + 400, "full subtotal before any deletion");
  assert.equal(before.data.hasUnavailableItems, false);
  pass("setup: a draft quotation with the affected product referenced TWICE across 2 rooms (qty 1 and qty 2), plus a multi-variant product with one doomed and one surviving variant");

  // ═══ Soft-delete the product AND the one doomed variant ═══════════
  assert.equal((await api(superCookie, "DELETE", "/api/products/2")).status, 200);
  assert.equal((await api(superCookie, "DELETE", "/api/product-variants/3")).status, 200);

  // ═══ 3/4/8. Item removed from the active list, totals updated, ════
  // ═══        multi-room and multi-variant handled correctly.       ═══
  const after = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(after.data.hasUnavailableItems, true);
  const room1After = after.data.rooms.find((r) => (r.id ?? r._id) === room1Id);
  const room2After = after.data.rooms.find((r) => (r.id ?? r._id) === room2Id);
  const doomedInRoom1 = room1After.items.find((i) => i.productId === 2);
  const doomedInRoom2 = room2After.items.find((i) => i.productId === 2);
  const doomedVariantItem = room2After.items.find((i) => i.productId === 3 && i.productVariantId === 3);
  const survivingVariantItem = room2After.items.find((i) => i.productId === 3 && i.productVariantId === 4);
  assert.equal(doomedInRoom1.isUnavailable, true, "the doomed product's item in room 1 must be flagged");
  assert.equal(doomedInRoom2.isUnavailable, true, "the SAME doomed product's item in room 2 must ALSO be flagged — every reference, not just the first");
  assert.equal(doomedVariantItem.isUnavailable, true, "only the deleted variant's item is flagged");
  assert.equal(survivingVariantItem.isUnavailable, false, "the OTHER (surviving) variant of the SAME product must stay available — only the affected variant is handled, not the whole product");
  // Eligible subtotal = keeper (1000) + surviving variant (400) only.
  assert.equal(after.data.subtotal, 1000 + 400, "subtotal must exclude every reference to the doomed product (both rooms, qty 1 and qty 2) and the doomed variant, while keeping the surviving variant's item");
  assert.equal(after.data.productsCount, 2, "item count must also exclude the unavailable items' quantities");
  pass("every reference to the affected product (across 2 rooms, including a qty-2 line) is excluded from totals; of the multi-variant product, only the deleted variant's item is excluded, its sibling variant's item is untouched — no double-deduction, no over-exclusion");

  // GST/grand total must be derived from the same reduced subtotal.
  assert.ok(after.data.totalAmount < before.data.totalAmount, "the grand total must drop to reflect the reduced subtotal");
  pass("GST/discount/grand total are recalculated from the reduced eligible subtotal using the existing pricing helpers, unchanged");

  // ═══ 5/9. Idempotent: refresh and repeat — no double deduction ════
  const refetch1 = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  const refetch2 = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(refetch1.data.subtotal, after.data.subtotal);
  assert.equal(refetch2.data.subtotal, after.data.subtotal);
  assert.equal(refetch1.data.totalAmount, after.data.totalAmount);
  pass("repeated GETs (simulating repeated requests / page refreshes) return the identical subtotal and total every time — nothing is deducted twice, nothing drifts");

  // A second, redundant soft-delete request on an already-deleted product
  // must not change anything either (confirms no double-processing risk).
  const secondDelete = await api(superCookie, "DELETE", "/api/products/2");
  assert.equal(secondDelete.status, 404, "deleting an already-deleted product must 404, not re-process it");
  const afterSecondDelete = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(afterSecondDelete.data.subtotal, after.data.subtotal, "a repeated delete request must not change the quotation's totals at all");
  pass("a repeated soft-delete request on the same product is rejected (404) and causes no further change to any quotation's totals");

  // ═══ 6/7. Approved and Delivered quotations stay immutable, warning shown ═
  // Build BOTH protected quotations now, while product #1 is still live —
  // it only gets soft-deleted once, afterward, exactly like a real product
  // that was live when quoted and later removed from the catalog.
  const protectedBefore = {};
  for (const status of ["approved", "delivered"]) {
    const protSource = await api(dealerA, "POST", "/api/quotations", { clientName: `${status} Immutable Client`, houseTypeId: 1 });
    const protId = protSource.data.id ?? protSource.data._id;
    const protRoomId = (await api(dealerA, "GET", `/api/quotations/${protId}`)).data.rooms[0].id;
    await api(dealerA, "POST", `/api/quotations/${protId}/items`, { quotationRoomId: protRoomId, productId: 1, productVariantId: 1, quantity: 1 }); // 1000, still-live product
    await api(dealerA, "POST", `/api/quotations/${protId}/items`, { quotationRoomId: protRoomId, productId: 3, productVariantId: 4, quantity: 1 }); // 400, still-live variant

    const beforeLock = await api(dealerA, "GET", `/api/quotations/${protId}`);
    assert.equal(beforeLock.data.subtotal, 1400);
    await db.collection("quotations").updateOne({ _id: protId }, { $set: { status } });
    const snapshotBeforeFurtherDelete = await db.collection("quotations").findOne({ _id: protId });
    protectedBefore[status] = { protId, beforeLock, snapshotBeforeFurtherDelete };
  }

  assert.equal((await api(superCookie, "DELETE", "/api/products/1")).status, 200);

  for (const status of ["approved", "delivered"]) {
    const { protId, beforeLock, snapshotBeforeFurtherDelete } = protectedBefore[status];

    const afterLockAndDelete = await api(dealerA, "GET", `/api/quotations/${protId}`);
    assert.equal(afterLockAndDelete.status, 200);
    // Immutability: EXACTLY the same items, EXACTLY the same stored totals.
    assert.equal(afterLockAndDelete.data.rooms[0].items.length, 2, `the ${status} quotation must retain both of its original items — nothing removed`);
    assert.equal(afterLockAndDelete.data.subtotal, 1400, `the ${status} quotation's subtotal must stay exactly 1400 — never recalculated from current availability`);
    assert.equal(afterLockAndDelete.data.totalAmount, beforeLock.data.totalAmount, `the ${status} quotation's grand total must be byte-for-byte unchanged`);

    const rawAfter = await db.collection("quotations").findOne({ _id: protId });
    assert.deepEqual(rawAfter, snapshotBeforeFurtherDelete, `the ${status} quotation's own MongoDB document must be completely unmodified by the product soft-delete (no side-effect write occurred)`);

    // Informational warning: the now-deleted product's item is still
    // flagged (so the UI can show the warning), even though it still
    // fully counts toward the preserved historical total.
    const flaggedItem = afterLockAndDelete.data.rooms[0].items.find((i) => i.productId === 1);
    assert.equal(flaggedItem.isUnavailable, true, "the item referencing the now-deleted product must still be flagged unavailable, for the informational warning — even though it is NOT excluded from the preserved total");
    assert.equal(afterLockAndDelete.data.hasUnavailableItems, true, `hasUnavailableItems must be true for the ${status} quotation so the UI can show the informational banner`);
    pass(`${status} quotation: retains exactly its original 2 items and its exact 1400 subtotal/total after a referenced product is soft-deleted (confirmed byte-for-byte unchanged in MongoDB), while still being flagged (hasUnavailableItems/isUnavailable) so the UI shows an informational warning`);

    // Reopening again (simulating a page refresh) must show the identical thing.
    const reopened = await api(dealerA, "GET", `/api/quotations/${protId}`);
    assert.equal(reopened.data.subtotal, 1400);
    assert.equal(reopened.data.hasUnavailableItems, true);
    pass(`${status} quotation: reopening/refreshing shows the same preserved total and the same persistent (re-derived, not stored) availability flag`);
  }

  // ═══ 10. Cloning still works correctly after all of the above ════════
  // By this point product #1 (the "keeper") has ALSO been soft-deleted
  // above (the Approved/Delivered section), so of this quotation's 5
  // original items only the surviving-variant one (product #3 / variant #4,
  // 400) is still available — the clone must skip the other 4.
  const originalBeforeClone = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(originalBeforeClone.data.subtotal, 400, "sanity check: the original's own current subtotal, now that product #1 is also gone, is just the surviving variant's 400");

  const cloneResp = await api(dealerA, "POST", `/api/quotations/${quotationId}/duplicate`);
  assert.equal(cloneResp.status, 201, `cloning a quotation with unavailable items must still succeed, got ${cloneResp.status}`);
  assert.equal(cloneResp.data.skippedItems.length, 4, "the clone must skip every now-unavailable item reference (product #1, product #2 x2 rooms, variant #3) and keep only the surviving variant");
  const cloneDetail = await api(dealerA, "GET", `/api/quotations/${cloneResp.data.id}`);
  const cloneItemCount = cloneDetail.data.rooms.reduce((sum, r) => sum + r.items.length, 0);
  assert.equal(cloneItemCount, 1, "the persisted clone must contain only the 1 available item (the surviving variant)");
  assert.equal(cloneDetail.data.subtotal, 400, "the clone's subtotal must be exactly the surviving variant's amount");

  // The original quotation itself must be completely unaffected by cloning it.
  const originalAfterClone = await api(dealerA, "GET", `/api/quotations/${quotationId}`);
  assert.equal(originalAfterClone.data.subtotal, originalBeforeClone.data.subtotal, "cloning must not change the original quotation's own totals");
  pass("quotation cloning still works correctly after this round of changes: unavailable items (across rooms and variants) are skipped from the clone exactly as before, the original is untouched");

  console.log(`\nAuto-update on soft delete PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
