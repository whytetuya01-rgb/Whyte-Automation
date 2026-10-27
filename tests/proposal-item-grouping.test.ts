/**
 * Proposal "Product Summary & Specifications": display-only grouping of one room's entries
 * (`@/lib/proposalItemGroups`). The stored quotation items stay independent; the proposal shows one row per
 * product / variant / configuration with the combined quantity, the sum of each entry's own line total, and every
 * distinct installation location.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/proposal-item-grouping.test.ts
 */
import assert from "node:assert/strict";
import { groupProposalItems, type ProposalGroupingOptions } from "../src/lib/proposalItemGroups";
import { getItemColor, getItemConnectivity, getItemFinish, getItemLocation, getItemModuleSize, getItemTier } from "../src/components/proposal-builder/StepProposalPreview";
import type { Quotation, QuotationItem } from "../src/types";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

let nextId = 100;
const entry = (overrides: Record<string, unknown> = {}): QuotationItem =>
  ({
    id: nextId++,
    quotationRoomId: 1,
    productId: 1,
    productVariantId: 1,
    variantLabel: "Black",
    variantConfig: { finish: "black" },
    quantity: 1,
    unitPrice: "4599.00",
    notes: null,
    sbNumber: null,
    isCustomPrice: false,
    product: { id: 1, name: "Touch Curtain Switch" },
    ...overrides,
  }) as unknown as QuotationItem;

// The same attribute readers the proposal uses.
const quotation = { id: "q_1", rooms: [] } as unknown as Quotation;
const options: ProposalGroupingOptions = {
  attributesOf: (item) => [getItemModuleSize(item), getItemFinish(item, quotation), getItemColor(item), getItemTier(item, quotation), getItemConnectivity(item)],
  locationOf: getItemLocation,
};
const roomSubtotal = (items: QuotationItem[]) => items.reduce((sum, i) => sum + Number(i.unitPrice || 0) * (Number(i.quantity) || 1), 0);

function main() {
  // ── two entries, same product, different locations -> one row ──
  const a = entry({ quantity: 2, notes: "Entrance wall" });
  const b = entry({ quantity: 3, notes: "Bedside" });
  const before = JSON.stringify([a, b]);
  const rows = groupProposalItems([a, b], options);
  assert.equal(rows.length, 1, "one row");
  assert.equal(rows[0].quantity, 5, "combined quantity 2 + 3");
  assert.equal(rows[0].lineTotal, 5 * 4599, "line total = 2 x 4599 + 3 x 4599");
  assert.deepEqual(rows[0].locations, [{ label: "Entrance wall", quantity: 2 }, { label: "Bedside", quantity: 3 }], "both locations, each with its units");
  assert.deepEqual(rows[0].entries.map((e) => e.id), [a.id, b.id], "the underlying entries are kept, in order");
  assert.equal(rows[0].item, a, "the first entry supplies the name, image and specifications");
  assert.equal(JSON.stringify([a, b]), before, "grouping reads the entries and changes none of them");
  assert.notEqual(a.id, b.id, "the two stored entries are still two independent items");
  pass("two entries of one product at different locations become one row: quantity 5, total 22,995, both locations, entries untouched");

  // ── same location twice (any case/spacing) is one location line; no location is listed as not specified ──
  const mixed = groupProposalItems(
    [entry({ quantity: 1, notes: "Hall" }), entry({ quantity: 2, notes: "  hall " }), entry({ quantity: 4 }), entry({ quantity: 1, notes: "unspecified" })],
    options
  );
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0].locations, [{ label: "Hall", quantity: 3 }, { label: null, quantity: 5 }], "Hall x 3; entries without a location (or a placeholder) x 5");
  assert.equal(mixed[0].quantity, 8);
  pass("the same location typed twice is one line (units added); entries without a location are kept as 'not specified'");

  // ── materially different entries stay separate ──
  const base = entry({ quantity: 1, notes: "Hall" });
  const baseWithoutVariant = entry({ productVariantId: null, quantity: 1, notes: "Hall" });
  const separate: Array<[string, QuotationItem]> = [
    ["a different variant", entry({ productVariantId: 2, variantLabel: "White", variantConfig: { finish: "white" } })],
    ["a different finish", entry({ variantConfig: { finish: "gold" } })],
    ["a different configuration (product without a variant)", entry({ productVariantId: null, variantConfig: { finish: "black", series: "premium" } })],
    ["a different product", entry({ productId: 2, product: { id: 2, name: "Dimmer" } })],
    ["a different unit price", entry({ unitPrice: "4999.00" })],
    ["a custom price", entry({ isCustomPrice: true })],
    ["a different SB number", entry({ sbNumber: "SB-2" })],
    ["an unavailable entry", entry({ isUnavailable: true })],
  ];
  for (const [label, other] of separate) {
    const result = groupProposalItems([label.includes("without a variant") ? baseWithoutVariant : base, other], options);
    assert.equal(result.length, 2, `${label} stays a separate row`);
  }
  // Stored configuration blobs that differ only in keys the proposal never prints do not split a row of one variant.
  assert.equal(groupProposalItems([base, entry({ variantConfig: { finish: "black", internalCode: "x-1" } })], options).length, 1, "same variant, same printed specifications: one row");
  assert.equal(groupProposalItems([base, entry({ variantConfig: { finish: "black" } })], options).length, 1, "same configuration groups");
  assert.equal(groupProposalItems([entry({ variantConfig: { a: "1", b: "2" } }), entry({ variantConfig: { b: "2", a: "1" } })], options).length, 1, "configuration key order does not matter");
  pass("different variants, finishes, configurations, products, prices, SB numbers or availability are never combined");

  // ── each row's total is the sum of its entries' actual line totals; rows add up to the room subtotal ──
  const room = [
    entry({ quantity: 2, notes: "Hall" }),
    entry({ quantity: 3, notes: "Study" }),
    entry({ productVariantId: 2, variantConfig: { finish: "white" }, unitPrice: "1800.00", quantity: 2, notes: "Terrace" }),
    entry({ unitPrice: "999.99", quantity: 3 }),
  ];
  const roomRows = groupProposalItems(room, options);
  assert.deepEqual(roomRows.map((r) => r.quantity), [5, 2, 3], "combined quantities per row");
  assert.deepEqual(roomRows.map((r) => Math.round(r.lineTotal * 100) / 100), [22995, 3600, 2999.97], "each total uses the entries' own prices");
  const rowsTotal = Math.round(roomRows.reduce((sum, r) => sum + r.lineTotal, 0) * 100) / 100;
  assert.equal(rowsTotal, Math.round(roomSubtotal(room) * 100) / 100, "the rows add up to the room subtotal");
  assert.equal(roomRows.reduce((sum, r) => sum + r.quantity, 0), room.reduce((sum, i) => sum + Number(i.quantity), 0), "the device count is unchanged");
  pass("row totals are the sum of each entry's own line total and add up to the room subtotal and device count");

  // ── rooms are grouped on their own: the same product in two rooms is never combined ──
  const living = groupProposalItems([entry({ quotationRoomId: 1, quantity: 2, notes: "Hall" })], options);
  const bedroom = groupProposalItems([entry({ quotationRoomId: 2, quantity: 3, notes: "Bedside" })], options);
  assert.equal(living.length + bedroom.length, 2, "one row per room");
  assert.equal(living[0].quantity, 2);
  assert.equal(bedroom[0].quantity, 3);
  pass("grouping runs per room, so the same product in different rooms stays in separate rows");

  // ── order and an empty room ──
  const ordered = groupProposalItems([entry({ productId: 5, product: { id: 5, name: "E" } }), entry({ productId: 6, product: { id: 6, name: "F" } }), entry({ productId: 5, product: { id: 5, name: "E" }, quantity: 2 })], options);
  assert.deepEqual(ordered.map((r) => r.item.productId), [5, 6], "rows keep the order of first appearance");
  assert.deepEqual(groupProposalItems([], options), []);
  pass("rows keep the order of first appearance; an empty room gives no rows");

  console.log(`\n${count} tests passed.`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
