import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation, AdminUser } from "../../src/models";
import { dealerVisibilityFilter } from "../../src/lib/quotationAccess";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "../../src/lib/quotationTotals";

/**
 * READ-ONLY. Proves the NEW Home-page computation (lightweight query +
 * `aggregateQuotationRoomTotals`) produces IDENTICAL per-row `totalAmount`
 * and IDENTICAL summary totals to the OLD computation (the exact
 * `populate(rooms -> items)` + JS reduce this replaced in
 * `src/app/(app)/page.tsx`), for the admin view and for every real dealer.
 */
interface RawItem {
  quantity?: unknown;
  unitPrice?: unknown;
}
interface RawRoom {
  items?: RawItem[];
}
interface RawQuotation {
  _id: string;
  status?: string;
  discountType?: string | null;
  discountValue?: unknown;
  rooms?: RawRoom[];
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "object" && v && typeof (v as { toString: () => string }).toString === "function") {
    return Number((v as { toString: () => string }).toString());
  }
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function rowTotalAmount(subtotal: number, discountType: unknown, discountValue: unknown): number {
  let discount = 0;
  if (discountType === "percentage") discount = (subtotal * toNum(discountValue)) / 100;
  else if (discountType === "fixed") discount = toNum(discountValue);
  return Math.max(0, subtotal - discount);
}

async function computeOld(filter: Record<string, unknown>) {
  const docs = (await Quotation.find(filter)
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean({ virtuals: true })) as unknown as RawQuotation[];

  let drafts = 0;
  let completed = 0;
  let pendingSent = 0;
  let totalValue = 0;
  const perRow = new Map<string, { totalAmount: number; roomsCount: number; productsCount: number }>();

  for (const q of docs) {
    const rooms = Array.isArray(q.rooms) ? q.rooms : [];
    const roomsCount = rooms.length;
    const productsCount = rooms.reduce(
      (sum, r) => sum + (Array.isArray(r.items) ? r.items.reduce((s, i) => s + (Number(i.quantity) || 1), 0) : 0),
      0
    );
    const subtotal = rooms.reduce(
      (sum, r) =>
        sum +
        (Array.isArray(r.items)
          ? r.items.reduce((s, i) => s + (Number(i.quantity) || 1) * Number(i.unitPrice || 0), 0)
          : 0),
      0
    );
    const totalAmount = rowTotalAmount(subtotal, q.discountType, q.discountValue);
    perRow.set(String(q._id), { totalAmount, roomsCount, productsCount });

    const status = q.status || "draft";
    if (status === "draft") drafts += 1;
    if (status === "approved" || status === "sent" || status === "delivered") completed += 1;
    if (status === "sent") pendingSent += 1;
    totalValue += totalAmount;
  }

  return { perRow, summary: { total: docs.length, drafts, completed, pendingSent, totalValue } };
}

async function computeNew(filter: Record<string, unknown>) {
  const docs = (await Quotation.find(filter)
    .select("_id status discountType discountValue")
    .lean({ virtuals: true })) as unknown as RawQuotation[];
  const ids = docs.map((d) => String(d._id));
  const aggregated = await aggregateQuotationRoomTotals(ids);

  let drafts = 0;
  let completed = 0;
  let pendingSent = 0;
  let totalValue = 0;
  const perRow = new Map<string, { totalAmount: number; roomsCount: number; productsCount: number }>();

  for (const q of docs) {
    const id = String(q._id);
    const { roomsCount, productsCount, subtotal } = totalsForQuotation(aggregated, id);
    const totalAmount = rowTotalAmount(subtotal, q.discountType, q.discountValue);
    perRow.set(id, { totalAmount, roomsCount, productsCount });

    const status = q.status || "draft";
    if (status === "draft") drafts += 1;
    if (status === "approved" || status === "sent" || status === "delivered") completed += 1;
    if (status === "sent") pendingSent += 1;
    totalValue += totalAmount;
  }

  return { perRow, summary: { total: docs.length, drafts, completed, pendingSent, totalValue } };
}

async function compareFilter(label: string, filter: Record<string, unknown>): Promise<number> {
  const [oldR, newR] = await Promise.all([computeOld(filter), computeNew(filter)]);
  let mismatches = 0;

  for (const [id, oldRow] of oldR.perRow) {
    const newRow = newR.perRow.get(id);
    if (!newRow) {
      console.log(`[${label}] MISSING in new: ${id}`);
      mismatches += 1;
      continue;
    }
    if (
      Math.abs(oldRow.totalAmount - newRow.totalAmount) > 1e-9 ||
      oldRow.roomsCount !== newRow.roomsCount ||
      oldRow.productsCount !== newRow.productsCount
    ) {
      console.log(`[${label}] ROW DIFF ${id}:`, { old: oldRow, new: newRow });
      mismatches += 1;
    }
  }

  const s1 = oldR.summary;
  const s2 = newR.summary;
  const summaryKeys: Array<keyof typeof s1> = ["total", "drafts", "completed", "pendingSent", "totalValue"];
  for (const key of summaryKeys) {
    const diff = Math.abs(Number(s1[key]) - Number(s2[key]));
    if (diff > 1e-9) {
      console.log(`[${label}] SUMMARY DIFF .${key}: ${s1[key]} -> ${s2[key]}`);
      mismatches += 1;
    }
  }

  console.log(`[${label}] rows=${oldR.perRow.size} mismatches=${mismatches}`);
  return mismatches;
}

async function main() {
  await connectMongoDB();

  let totalMismatches = 0;
  totalMismatches += await compareFilter("admin (filter={})", {});

  const dealers = await AdminUser.find({ role: "dealer" }).select("_id").lean();
  for (const dealer of dealers) {
    const userId = Number((dealer as { _id: unknown })._id);
    totalMismatches += await compareFilter(`dealer#${userId}`, dealerVisibilityFilter(userId));
  }

  console.log(totalMismatches === 0 ? "\nPARITY OK: 0 mismatches across all views." : `\nPARITY FAILED: ${totalMismatches} mismatches.`);
  process.exit(totalMismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-homepage-totals failed:", error);
  process.exit(1);
});
