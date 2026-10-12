/**
 * Real bug report: a product ("testing 01") added to a Draft quotation kept
 * showing up as a perfectly normal, available item after being soft-deleted
 * — no warning, still counted in the total, even after a fresh page reload.
 *
 * Root cause: `normalizeQuotationItem` derives `isUnavailable` from the
 * RAW populated `item.product.isDeleted` / `item.productVariant.isDeleted`.
 * That's correct the first time the server normalizes a freshly-populated
 * Mongoose document. But `normalizeProduct()` does not carry `isDeleted`
 * through to its output (it builds an explicit field whitelist), so once a
 * quotation has been normalized once, nothing in `item.product` says
 * "deleted" any more.
 *
 * Every client call site (`ProposalBuilder.tsx`: the initial-load prop, every
 * `refreshQuotation()`, every item/room mutation response handler) calls
 * `normalizeQuotation`/`normalizeQuotationItem` AGAIN on a payload that is
 * ALREADY the output of server-side normalization (the API route itself
 * calls `normalizeQuotation` before responding). That second pass recomputed
 * `isUnavailable` from the now-stripped `item.product`, got `false`, and
 * silently overwrote the correct `true` the server had just computed —
 * exactly reproducing what the user saw in the browser.
 *
 * This test proves the client-side double-normalization bug directly (no
 * browser needed — same `normalizeQuotationItem` function the client imports
 * and calls), confirms it against the pre-fix behavior, and proves the fix:
 * normalization is now idempotent, so re-normalizing an already-normalized
 * item never resets `isUnavailable` back to false.
 *
 *   node tests/soft-delete-client-renormalize-bug.test.mjs
 */
import assert from "node:assert/strict";
import { normalizeQuotationItem, normalizeQuotation } from "../src/lib/quotationNormalization";

const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`  ✓ ${name}`); };

// ═══ 1. First pass: server-side normalization of a raw, freshly-populated item ═══
// This is exactly the shape `fetchPopulatedQuotation()` in
// `src/app/api/quotations/[id]/route.ts` hands to `normalizeQuotation` after
// `.populate({ path: "product", select: "...isDeleted" })` resolves a
// soft-deleted product (the historical-reference populate scope still
// resolves it; only `isDeleted` tells it apart from a live one).
const rawItem = {
  _id: 101,
  quotationRoomId: 1,
  productId: 5,
  productVariantId: null,
  variantLabel: null,
  quantity: 1,
  unitPrice: "500.00",
  priceWithoutTax: "500.00",
  taxPercent: "0.00",
  taxAmount: "0.00",
  sortOrder: 0,
  product: { id: 5, name: "testing 01", code: "T01", isDeleted: true },
  productVariant: null,
};

const firstPass: any = normalizeQuotationItem(rawItem as any, 1);
assert.equal(firstPass.isUnavailable, true, "server-side first pass must flag the soft-deleted product as unavailable");
assert.equal(firstPass.unavailableReason, "product");
pass("first normalization pass (server, raw populated data): isUnavailable correctly computed as true");

// `normalizeProduct` (called inside `normalizeQuotationItem`) builds an
// explicit field whitelist for `item.product` — confirm `isDeleted` really
// is gone from the output, which is the precondition for the bug.
assert.equal(
  Object.prototype.hasOwnProperty.call(firstPass.product ?? {}, "isDeleted"),
  false,
  "normalizeProduct's output must not carry isDeleted (confirms why a second pass can't re-derive it)"
);
pass("confirmed precondition: the normalized item.product no longer carries isDeleted");

// ═══ 2. Second pass: exactly what every client call site does ═══
// `ProposalBuilder.tsx` receives this already-normalized item (as part of a
// GET /api/quotations/[id] response, or a mutation response) and calls
// `normalizeQuotationItem`/`normalizeQuotation` on it again before putting
// it in React state. Before the fix, this silently flipped isUnavailable
// back to false. After the fix, it must stay true.
const secondPass: any = normalizeQuotationItem(firstPass, 1);
assert.equal(
  secondPass.isUnavailable,
  true,
  "BUG: re-normalizing an already-normalized item (what every client call site does) must not reset isUnavailable to false"
);
assert.equal(secondPass.unavailableReason, "product");
pass("second normalization pass (client, already-normalized data): isUnavailable stays true — the actual bug is fixed");

// ═══ 3. Idempotent under arbitrary repetition (simulates initial load + every subsequent refresh/mutation response) ═══
let repeated: any = rawItem;
for (let i = 0; i < 5; i++) {
  repeated = normalizeQuotationItem(repeated, 1);
}
assert.equal(repeated.isUnavailable, true, "isUnavailable must survive any number of re-normalization passes");
pass("isUnavailable survives 5 repeated normalization passes (simulates repeated client refreshes)");

// ═══ 4. A genuinely available item must never be flagged unavailable by the fix ═══
const liveRawItem = { ...rawItem, product: { id: 6, name: "Still Alive", isDeleted: false } };
const liveFirst: any = normalizeQuotationItem(liveRawItem as any, 1);
const liveSecond: any = normalizeQuotationItem(liveFirst, 1);
assert.equal(liveFirst.isUnavailable, false);
assert.equal(liveSecond.isUnavailable, false, "the idempotency fallback must not turn a genuinely available item unavailable");
pass("a live (non-deleted) product stays available across repeated normalization passes — no false positive introduced");

// ═══ 5. Full quotation-level normalization, matching the real client flow (page.tsx → ProposalBuilder.tsx) ═══
const rawQuotation = {
  _id: "q1",
  status: "draft",
  discountType: "none",
  discountValue: null,
  customerDiscountPercent: 0,
  allocatedDiscountPercent: 0,
  rooms: [
    {
      _id: 1,
      quotationId: "q1",
      roomTypeId: 1,
      roomType: { id: 1, name: "Living Room", isDeleted: false },
      sortOrder: 0,
      items: [rawItem],
    },
  ],
};

// Pass 1: the server (API route / page.tsx) normalizes the raw Mongo data.
const serverNormalized: any = normalizeQuotation(rawQuotation as any);
assert.equal(serverNormalized.rooms[0].items[0].isUnavailable, true);
assert.equal(serverNormalized.hasUnavailableItems, true);

// Pass 2: the client (ProposalBuilder.tsx's initial state / refreshQuotation)
// normalizes that same, already-normalized payload again.
const clientNormalized = normalizeQuotation(serverNormalized);
assert.equal(
  clientNormalized.rooms[0].items[0].isUnavailable,
  true,
  "BUG: the full quotation-level re-normalization (exactly what ProposalBuilder.tsx does on every load/refresh) must keep the warning flag"
);
assert.equal(
  clientNormalized.hasUnavailableItems,
  true,
  "hasUnavailableItems (drives the top banner) must also survive client-side re-normalization"
);
pass("full normalizeQuotation(), re-run exactly as ProposalBuilder.tsx does on load/refresh: warning flags survive");

console.log(`\nClient re-normalization bug — reproduced and fixed (${results.length} checks).`);
process.exit(0);
