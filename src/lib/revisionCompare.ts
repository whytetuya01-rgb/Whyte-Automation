import type { RevisionSnapshot, RevisionSnapshotItem } from "@/models/QuotationRevision";

/**
 * What changed between two issued revisions of a quotation, read only from their frozen snapshots (never from the live
 * quotation, the catalogue or the company's current settings), so the comparison of Rev 1 and Rev 3 is the same today and in a
 * year. Pure (no server imports): the API, the comparison screen and the tests share it.
 *
 * Lines are matched by their item id (a line edited between revisions keeps its id). A line deleted and added again for the
 * same product in the same room is paired too, so it reads as "modified" rather than "removed" plus "added".
 *
 * Money: product prices are GST-inclusive; a line's total is unit price x quantity (after any per-product discount). The
 * Service & Integration charge is the 18% on the net subtotal (`totals.totalGstAmount` in the snapshot).
 */

export type LineChangeKind = "added" | "removed" | "modified";
export type LineField = "variant" | "quantity" | "unitPrice" | "discount" | "gst";

export interface LineSide {
  variant: string | null;
  quantity: number;
  unitPrice: number;
  /** "10% off" / "₹50 off each", or null without a per-product discount. */
  discount: string | null;
  lineTotal: number;
  /** GST included in the line (per-unit tax x quantity), or null when the snapshot does not carry the split. */
  gst: number | null;
}

export interface LineChange {
  key: string;
  kind: LineChangeKind;
  room: string;
  product: string;
  code: string | null;
  /** For a modified line: what changed. */
  fields: LineField[];
  from: LineSide | null;
  to: LineSide | null;
  /** Change in the line's total (positive = more). */
  totalDelta: number;
}

export interface RoomChange {
  kind: "added" | "removed" | "renamed";
  name: string;
  previousName: string | null;
  items: number;
}

export type TotalKey = "subtotal" | "productDiscounts" | "quotationDiscount" | "netSubtotal" | "productGst" | "serviceCharge" | "grandTotal";

export interface TotalRow {
  key: TotalKey;
  label: string;
  from: number;
  to: number;
  delta: number;
}

export interface RevisionComparison {
  lines: LineChange[];
  rooms: RoomChange[];
  totals: TotalRow[];
  summary: { added: number; removed: number; modified: number; roomsAdded: number; roomsRemoved: number; identical: boolean };
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const rupee = (value: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;

function discountLabel(item: RevisionSnapshotItem): string | null {
  if (!item.discountType || !item.discountValue) return null;
  return item.discountType === "percentage" ? `${item.discountValue}% off` : `${rupee(item.discountValue)} off each`;
}

function sideOf(item: RevisionSnapshotItem): LineSide {
  const quantity = num(item.quantity) || 1;
  const unitPrice = num(item.unitPrice);
  return {
    variant: item.variantLabel ?? null,
    quantity,
    unitPrice,
    discount: discountLabel(item),
    lineTotal: round2(unitPrice * quantity),
    gst: item.taxAmount === null || item.taxAmount === undefined ? null : round2(num(item.taxAmount) * quantity),
  };
}

interface Located {
  item: RevisionSnapshotItem;
  roomId: number;
  room: string;
}

function locate(snapshot: RevisionSnapshot): Located[] {
  return snapshot.rooms.flatMap((room) => room.items.map((item) => ({ item, roomId: room.roomId, room: room.name })));
}

function lineTotals(snapshot: RevisionSnapshot) {
  let productDiscounts = 0;
  let productGst = 0;
  for (const { item } of locate(snapshot)) {
    const quantity = num(item.quantity) || 1;
    if (item.preDiscountUnitPrice !== null && item.preDiscountUnitPrice !== undefined && item.discountType) {
      productDiscounts += Math.max(0, num(item.preDiscountUnitPrice) - num(item.unitPrice)) * quantity;
    }
    if (item.taxAmount !== null && item.taxAmount !== undefined) productGst += num(item.taxAmount) * quantity;
  }
  return { productDiscounts: round2(productDiscounts), productGst: round2(productGst) };
}

function changedFields(a: RevisionSnapshotItem, b: RevisionSnapshotItem): LineField[] {
  const fields: LineField[] = [];
  const left = sideOf(a);
  const right = sideOf(b);
  if ((a.variantId ?? null) !== (b.variantId ?? null) || (left.variant ?? "") !== (right.variant ?? "")) fields.push("variant");
  if (left.quantity !== right.quantity) fields.push("quantity");
  if (round2(left.unitPrice) !== round2(right.unitPrice)) fields.push("unitPrice");
  if ((left.discount ?? "") !== (right.discount ?? "")) fields.push("discount");
  if (left.gst !== null && right.gst !== null && round2(left.gst / left.quantity) !== round2(right.gst / right.quantity)) fields.push("gst");
  return fields;
}

/** Compares an older revision (`from`) with a newer one (`to`). Either order works; "added" means present only in `to`. */
export function compareRevisionSnapshots(from: RevisionSnapshot, to: RevisionSnapshot): RevisionComparison {
  // ── rooms ──
  const fromRooms = new Map(from.rooms.map((room) => [room.roomId, room]));
  const toRooms = new Map(to.rooms.map((room) => [room.roomId, room]));
  const rooms: RoomChange[] = [];
  for (const room of to.rooms) {
    const before = fromRooms.get(room.roomId);
    if (!before) rooms.push({ kind: "added", name: room.name, previousName: null, items: room.items.length });
    else if (before.name !== room.name) rooms.push({ kind: "renamed", name: room.name, previousName: before.name, items: room.items.length });
  }
  for (const room of from.rooms) {
    if (!toRooms.has(room.roomId)) rooms.push({ kind: "removed", name: room.name, previousName: null, items: room.items.length });
  }

  // ── lines ──
  const before = locate(from);
  const after = locate(to);
  const beforeById = new Map(before.map((entry) => [entry.item.itemId, entry]));
  const afterIds = new Set(after.map((entry) => entry.item.itemId));
  const pairs: Array<[Located, Located]> = [];
  const added: Located[] = [];
  for (const entry of after) {
    const match = beforeById.get(entry.item.itemId);
    if (match) pairs.push([match, entry]);
    else added.push(entry);
  }
  const removed = before.filter((entry) => !afterIds.has(entry.item.itemId));
  // A line deleted and added again (same product, same room) is the same line changed.
  for (let i = added.length - 1; i >= 0; i -= 1) {
    const index = removed.findIndex((old) => old.item.productId === added[i].item.productId && old.roomId === added[i].roomId);
    if (index >= 0) {
      pairs.push([removed[index], added[i]]);
      removed.splice(index, 1);
      added.splice(i, 1);
    }
  }

  const line = (kind: LineChangeKind, a: Located | null, b: Located | null, fields: LineField[]): LineChange => {
    const subject = (b ?? a) as Located;
    const left = a ? sideOf(a.item) : null;
    const right = b ? sideOf(b.item) : null;
    return {
      key: `${kind}:${a?.item.itemId ?? "-"}:${b?.item.itemId ?? "-"}`,
      kind,
      room: subject.room,
      product: subject.item.productName,
      code: subject.item.productCode ?? null,
      fields,
      from: left,
      to: right,
      totalDelta: round2((right?.lineTotal ?? 0) - (left?.lineTotal ?? 0)),
    };
  };

  const order = new Map(after.map((entry, index) => [entry.item.itemId, index]));
  const lines: LineChange[] = [
    ...pairs
      .map(([a, b]) => ({ a, b, fields: changedFields(a.item, b.item) }))
      .filter(({ fields }) => fields.length > 0)
      .map(({ a, b, fields }) => line("modified", a, b, fields)),
    ...added.map((b) => line("added", null, b, [])),
  ].sort((x, y) => (order.get(Number(x.key.split(":")[2])) ?? 0) - (order.get(Number(y.key.split(":")[2])) ?? 0));
  lines.push(...removed.map((a) => line("removed", a, null, [])));

  // ── totals (from the frozen snapshots; the two line-derived rows from their lines) ──
  const fromLines = lineTotals(from);
  const toLines = lineTotals(to);
  const row = (key: TotalKey, label: string, a: number, b: number): TotalRow => ({ key, label, from: round2(a), to: round2(b), delta: round2(b - a) });
  const totals: TotalRow[] = [
    row("subtotal", "Products (GST included)", num(from.totals.subtotal), num(to.totals.subtotal)),
    row("productDiscounts", "Per-product discounts", fromLines.productDiscounts, toLines.productDiscounts),
    row("quotationDiscount", "Quotation discount", num(from.totals.discountAmount), num(to.totals.discountAmount)),
    row("netSubtotal", "Net subtotal", num(from.totals.netSubtotal), num(to.totals.netSubtotal)),
    row("productGst", "GST within product prices", fromLines.productGst, toLines.productGst),
    row("serviceCharge", "Service & Integration (18%)", num(from.totals.totalGstAmount), num(to.totals.totalGstAmount)),
    row("grandTotal", "Final quotation total", num(from.totals.grandTotal), num(to.totals.grandTotal)),
  ];

  const summary = {
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
    modified: lines.filter((l) => l.kind === "modified").length,
    roomsAdded: rooms.filter((r) => r.kind === "added").length,
    roomsRemoved: rooms.filter((r) => r.kind === "removed").length,
    identical: false,
  };
  summary.identical = lines.length === 0 && rooms.length === 0 && totals.every((t) => t.delta === 0);
  return { lines, rooms, totals, summary };
}
