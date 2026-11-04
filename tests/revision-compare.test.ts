/**
 * Comparing two frozen revision snapshots (pure; no database).
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/revision-compare.test.ts
 */
import assert from "node:assert/strict";
import { compareRevisionSnapshots } from "../src/lib/revisionCompare";
import type { RevisionSnapshot, RevisionSnapshotItem } from "../src/models/QuotationRevision";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const item = (over: Partial<RevisionSnapshotItem> & Pick<RevisionSnapshotItem, "itemId" | "productId" | "productName">): RevisionSnapshotItem => ({
  productCode: null,
  variantId: null,
  variantLabel: null,
  quantity: 1,
  unitPrice: 1180,
  priceWithoutTax: 1000,
  taxPercent: 18,
  taxAmount: 180,
  notes: null,
  ...over,
});

/** Totals as the app computes them: net = subtotal - discount; the 18% Service & Integration charge on net; total = net + charge. */
function snapshot(rooms: RevisionSnapshot["rooms"], discountAmount = 0): RevisionSnapshot {
  const subtotal = rooms.flatMap((r) => r.items).reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const net = subtotal - discountAmount;
  const charge = Math.round(net * 0.18 * 100) / 100;
  return {
    quotation: { quotationNumber: "QT-1", clientName: "C", clientGstNumber: null, clientPhone: null, clientEmail: null, clientAddress: null, houseTypeId: null, notes: null, terms: null, validUntil: null, discountType: null, discountValue: 0, customerDiscountPercent: 0, allocatedDiscountPercent: 0, dealerId: null },
    rooms,
    totals: { subtotal, discountAmount, netSubtotal: net, totalGstAmount: charge, grandTotal: Math.round((net + charge) * 100) / 100 },
  };
}

const living = (items: RevisionSnapshotItem[]) => ({ roomId: 1, name: "Living Room", subArea: null, notes: null, items });

{
  const rev1 = snapshot([living([item({ itemId: 1, productId: 10, productName: "Smart Switch", quantity: 4 }), item({ itemId: 2, productId: 20, productName: "Switch Frame", unitPrice: 300, taxAmount: 45.76 })])]);
  const rev2 = snapshot([
    living([item({ itemId: 1, productId: 10, productName: "Smart Switch", quantity: 6 }), item({ itemId: 3, productId: 30, productName: "Curtain Motor", unitPrice: 9440, taxAmount: 1440 })]),
    { roomId: 2, name: "Master Bedroom", subArea: null, notes: null, items: [item({ itemId: 4, productId: 10, productName: "Smart Switch" })] },
  ]);
  const result = compareRevisionSnapshots(rev1, rev2);
  const byProduct = (name: string, kind: string) => result.lines.find((l) => l.product === name && l.kind === kind);
  const switchLine = byProduct("Smart Switch", "modified");
  assert.ok(switchLine, "the switch line changed");
  assert.deepEqual(switchLine.fields, ["quantity"]);
  assert.deepEqual([switchLine.from?.quantity, switchLine.to?.quantity, switchLine.totalDelta], [4, 6, 2360]);
  assert.equal(byProduct("Curtain Motor", "added")?.to?.lineTotal, 9440);
  assert.equal(byProduct("Switch Frame", "removed")?.from?.lineTotal, 300);
  assert.equal(result.lines.filter((l) => l.kind === "added").length, 2, "the motor and the bedroom's switch are added");
  assert.deepEqual(result.rooms.map((r) => [r.kind, r.name]), [["added", "Master Bedroom"]]);
  assert.deepEqual([result.summary.added, result.summary.removed, result.summary.modified, result.summary.roomsAdded, result.summary.identical], [2, 1, 1, 1, false]);
  const total = result.totals.find((t) => t.key === "grandTotal")!;
  assert.equal(total.from, rev1.totals.grandTotal);
  assert.equal(total.to, rev2.totals.grandTotal);
  assert.equal(total.delta, Math.round((rev2.totals.grandTotal - rev1.totals.grandTotal) * 100) / 100);
  const charge = result.totals.find((t) => t.key === "serviceCharge")!;
  assert.equal(charge.to, Math.round(rev2.totals.netSubtotal * 0.18 * 100) / 100, "the Service & Integration row is the 18% on the net subtotal");
  assert.equal(result.totals.find((t) => t.key === "productGst")!.from, 4 * 180 + 45.76, "GST within product prices adds up per line");
  pass("added, removed and changed products, a new room, line totals, the 18% charge and the final difference");
}

{
  const before = snapshot([living([item({ itemId: 1, productId: 10, productName: "Smart Switch", variantId: 1, variantLabel: "White" })])]);
  const after = snapshot([living([item({ itemId: 1, productId: 10, productName: "Smart Switch", variantId: 2, variantLabel: "Black", unitPrice: 1062, discountType: "percentage", discountValue: 10, preDiscountUnitPrice: 1180 })])]);
  const [line] = compareRevisionSnapshots(before, after).lines;
  assert.deepEqual(line.fields, ["variant", "unitPrice", "discount"]);
  assert.deepEqual([line.from?.variant, line.to?.variant, line.from?.discount, line.to?.discount], ["White", "Black", null, "10% off"]);
  assert.equal(compareRevisionSnapshots(before, after).totals.find((t) => t.key === "productDiscounts")!.to, 118);
  pass("a changed variant, unit price and per-product discount on the same line read as one modified line");
}

{
  const before = snapshot([living([item({ itemId: 1, productId: 10, productName: "Smart Switch", quantity: 2 })])]);
  const readded = snapshot([living([item({ itemId: 9, productId: 10, productName: "Smart Switch", quantity: 3 })])]);
  const result = compareRevisionSnapshots(before, readded);
  assert.deepEqual(result.lines.map((l) => [l.kind, l.fields]), [["modified", ["quantity"]]], "deleted and added again in the same room = modified");
  pass("a line deleted and added again for the same product and room is paired as one change");
}

{
  const same = snapshot([living([item({ itemId: 1, productId: 10, productName: "Smart Switch" })])]);
  const result = compareRevisionSnapshots(same, structuredClone(same));
  assert.equal(result.summary.identical, true);
  assert.equal(result.lines.length, 0);
  const renamed = structuredClone(same);
  renamed.rooms[0].name = "Lounge";
  assert.deepEqual(compareRevisionSnapshots(same, renamed).rooms.map((r) => [r.kind, r.previousName, r.name]), [["renamed", "Living Room", "Lounge"]]);
  const removedRoom = snapshot([]);
  const gone = compareRevisionSnapshots(same, removedRoom);
  assert.deepEqual([gone.rooms[0].kind, gone.lines[0].kind, gone.summary.roomsRemoved], ["removed", "removed", 1]);
  pass("identical revisions report no change; a renamed and a removed room are reported");
}

console.log(`\nALL ${count} REVISION COMPARE TESTS PASSED!`);
