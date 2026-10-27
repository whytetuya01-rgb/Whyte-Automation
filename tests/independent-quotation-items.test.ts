/**
 * Independent quotation item entries (no server, no database):
 *  - an offline draft restores every entry with its OWN numeric id, quantity and installation location, including
 *    timestamp-style ids that used to collapse (the id was rebuilt from the first 8 digits) and ids that are already
 *    duplicated in a stored draft; restoring twice gives the same ids;
 *  - quotation normalisation keeps two entries of one product as two lines and sums both;
 *  - the product-configuration step never merges: its add handlers create entries and never update an existing one.
 * The API / clone behaviour is covered by tests/independent-quotation-items.test.mjs and the UI by
 * tests/independent-quotation-items.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/independent-quotation-items.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignDraftItemNumericIds, offlineDraftToQuotation, quotationToOfflineDraft } from "../src/lib/offline/draftStore";
import type { OfflineQuotationDraft, OfflineQuotationDraftItem } from "../src/lib/offline/db";
import { normalizeQuotation } from "../src/lib/quotationNormalization";
import type { EditorCatalogProduct } from "../src/types";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

interface RestoredItem {
  id: number;
  productId: number;
  productVariantId: number | null;
  quantity: number;
  notes: string | null;
  unitPrice: string;
}
interface RestoredRoom {
  id: number;
  items: RestoredItem[];
}

const item = (id: string, quantity: number, notes: string | undefined, variantId = 1): OfflineQuotationDraftItem => ({
  id,
  draftId: "draft_1",
  roomId: "room_1",
  productId: 1,
  variantId,
  productName: "Smart Switch",
  quantity,
  defaultUnitPrice: "1000.00",
  unitPrice: "1000.00",
  isCustomPrice: false,
  taxPercent: 18,
  lineTotal: (quantity * 1000).toFixed(2),
  notes,
  sortOrder: 0,
});

const draftWith = (items: OfflineQuotationDraftItem[]): OfflineQuotationDraft => ({
  id: "draft_1",
  tenantKey: "1:1",
  companyId: 1,
  companyName: "Company 1",
  userId: 1,
  userName: "Dealer",
  userRole: "dealer",
  clientName: "Client",
  houseTypeId: 1,
  catalogVersion: "v1",
  revision: 1,
  status: "LOCAL_SAVED",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  rooms: [{ id: "room_1", draftId: "draft_1", roomTypeId: 1, name: "Living Room", sortOrder: 0, items }],
  calculation: {
    grossSubtotal: 0,
    discountType: "percentage",
    discountValue: 0,
    discountAmount: 0,
    netSubtotal: 0,
    cgstPercent: 9,
    cgstAmount: 0,
    sgstPercent: 9,
    sgstAmount: 0,
    totalGstAmount: 0,
    grandTotal: 0,
    dealerDiscountAllocationPercent: 0,
    customerDiscountPercent: 0,
    estimatedDealerEarning: 0,
  },
  roomCount: 1,
  deviceCount: items.length,
});

const catalog = [
  {
    id: 1,
    name: "Smart Switch",
    price: 1000,
    variants: [
      { id: 1, price: 1000, name: "Black" },
      { id: 2, price: 1800, name: "White" },
    ],
  },
] as unknown as EditorCatalogProduct[];
const roomTypes = [{ id: 1, name: "Living Room" }];

const restore = (draft: OfflineQuotationDraft): RestoredRoom[] => offlineDraftToQuotation(draft, catalog, roomTypes).rooms as RestoredRoom[];

function main() {
  // ── offline draft restore ──
  const stored = [
    item("item_17612345678901", 2, "Entrance wall"),
    item("item_17612345678902", 1, "Bedside"),
    item("item_5d7c1a52-3f1e-4c88-9a52-7b1e0c9f2a11", 4, "Hall"),
    item("item_17612345678901", 3, "Balcony"), // already duplicated in a stored draft (written by the old restore)
    item("item_61a0e6c4-0000-0000-0000-000000000000", 1, undefined, 2),
  ];

  // the old rebuild: first 8 digits of the id
  const oldIds = stored.map((entry, index) => Number(entry.id.replace(/\D/g, "").slice(0, 8)) || index + 1);
  assert.equal(oldIds[0], oldIds[1], "documents the old failure: two timestamp ids collapsed to the same number");

  const rooms = restore(draftWith(stored));
  const restored = rooms[0].items;
  assert.equal(restored.length, 5, "all five entries are restored");
  assert.equal(new Set(restored.map((entry) => entry.id)).size, 5, "every entry has its own id");
  assert.equal(restored[0].id, 17612345678901, "a timestamp id keeps its exact value");
  assert.equal(restored[1].id, 17612345678902);
  assert.deepEqual(restored.map((entry) => entry.quantity), [2, 1, 4, 3, 1], "each entry keeps its own quantity");
  assert.deepEqual(restored.map((entry) => entry.notes ?? null), ["Entrance wall", "Bedside", "Hall", "Balcony", null], "each entry keeps its own location");
  assert.deepEqual(restored.map((entry) => entry.productVariantId), [1, 1, 1, 1, 2], "each entry keeps its own variant");
  assert.ok(restored.every((entry) => entry.productId === 1), "all five reference the same product");
  pass("an offline draft restores five entries of one product with five distinct ids, quantities, locations and variants (timestamp ids and stored duplicates included)");

  // ── restoring again (after the editor saved the draft back) keeps the same ids ──
  const base = draftWith(stored);
  const quotation = offlineDraftToQuotation(base, catalog, roomTypes);
  const savedBack = quotationToOfflineDraft(quotation, base);
  const again = restore(savedBack);
  assert.deepEqual(again[0].items.map((entry) => entry.id), restored.map((entry) => entry.id), "ids are stable across save and restore");
  assert.deepEqual(again[0].items.map((entry) => entry.notes ?? null), restored.map((entry) => entry.notes ?? null));
  assert.deepEqual(again[0].items.map((entry) => entry.quantity), restored.map((entry) => entry.quantity));
  const thirdTime = restore(quotationToOfflineDraft(offlineDraftToQuotation(savedBack, catalog, roomTypes), savedBack));
  assert.deepEqual(thirdTime[0].items.map((entry) => entry.id), restored.map((entry) => entry.id));
  pass("saving a restored draft and restoring it again keeps the same ids, quantities and locations (stable across reloads)");

  // ── the id assignment itself ──
  const assigned = assignDraftItemNumericIds([
    { items: [{ id: "item_100" }, { id: "item_100" }, { id: "item_101" }] },
    { items: [{ id: "item_abc" }, { id: "item_abc" }] },
  ]);
  const flat = assigned.flat();
  assert.equal(new Set(flat).size, flat.length, "no two entries share an id, even for identical stored ids");
  assert.equal(assigned[0][0], 100, "the first of two identical exact ids keeps its value");
  assert.ok(!assigned[1].includes(100) && !assigned[1].includes(101), "a hashed id never takes an exact id");
  assert.deepEqual(assignDraftItemNumericIds([{ items: [{ id: "item_abc" }] }]), assignDraftItemNumericIds([{ items: [{ id: "item_abc" }] }]), "the assignment is deterministic");
  pass("id assignment is collision-free and deterministic (exact ids first, hashes never collide with them)");

  // ── normalisation keeps two entries of one product separate and sums both ──
  const normalised = normalizeQuotation({
    id: "q_1",
    status: "draft",
    discountType: "none",
    rooms: [
      {
        id: 1,
        roomTypeId: 1,
        items: [
          { id: 11, quotationRoomId: 1, productId: 1, productVariantId: 1, quantity: 2, unitPrice: "1000.00", notes: "Entrance wall" },
          { id: 12, quotationRoomId: 1, productId: 1, productVariantId: 1, quantity: 3, unitPrice: "1000.00", notes: "Bedside" },
        ],
      },
    ],
  } as never);
  const lines = normalised.rooms?.[0]?.items ?? [];
  assert.equal(lines.length, 2, "two lines, not one merged line");
  assert.deepEqual(lines.map((line) => Number(line.id)), [11, 12]);
  assert.deepEqual(lines.map((line) => line.notes), ["Entrance wall", "Bedside"]);
  assert.equal(Number(normalised.subtotal), 5000, "the room / quotation subtotal sums both entries (2 x 1000 + 3 x 1000)");
  pass("quotation normalisation keeps two entries of the same product as two lines and sums both");

  // ── the product configuration step never merges ──
  const source = readFileSync(join(__dirname, "..", "src", "components", "proposal-builder", "StepProductConfig.tsx"), "utf8");
  const body = (name: string) => {
    const start = source.indexOf(`const ${name} = async`);
    assert.ok(start >= 0, `${name} exists`);
    const next = source.indexOf("\n  const ", start + 10);
    return source.slice(start, next > start ? next : undefined);
  };
  for (const handler of ["handleAddProduct", "handleAddVariant", "handleAddTypedQuantity"]) {
    const code = body(handler);
    assert.ok(!/onUpdateItem\(/.test(code), `${handler} must not update an existing item`);
    assert.ok(!/\.find\(\(i\)/.test(code), `${handler} must not look for an existing line to merge into`);
  }
  assert.ok(/onAddItem\(/.test(body("handleAddTypedQuantity")), "typed Add creates an entry");
  assert.ok(/key=\{itemId\}/.test(source), "Added Products rows are keyed by the item id");
  pass("the product configuration add handlers only create entries; they never find-and-update an existing line");

  console.log(`\n${count} tests passed.`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
