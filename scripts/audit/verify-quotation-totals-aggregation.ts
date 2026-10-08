import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "../../src/lib/quotationTotals";

/**
 * READ-ONLY. Proves the new `aggregateQuotationRoomTotals` produces IDENTICAL
 * {roomsCount, productsCount, subtotal} to the existing JS reducer (copied
 * verbatim from `normalizeQuotation`) for every real quotation, before the
 * aggregation is wired into any live code path.
 */
interface RawItem {
  quantity?: unknown;
  unitPrice?: unknown;
}
interface RawRoom {
  items?: RawItem[];
}

function jsReducerTotals(rooms: RawRoom[]): { roomsCount: number; productsCount: number; subtotal: number } {
  let subtotal = 0;
  let productsCount = 0;
  for (const r of rooms) {
    for (const item of r.items ?? []) {
      const q = Math.max(1, (Number(item.quantity) || 1));
      const p = Number(item.unitPrice || 0);
      subtotal += q * p;
      productsCount += q;
    }
  }
  return { roomsCount: rooms.length, productsCount, subtotal };
}

async function main() {
  await connectMongoDB();

  const docs = await Quotation.find()
    .select("_id")
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean({ virtuals: true });

  const ids = docs.map((d) => String(d._id));
  const aggregated = await aggregateQuotationRoomTotals(ids);

  let mismatches = 0;
  for (const doc of docs) {
    const id = String(doc._id);
    const rooms = Array.isArray((doc as unknown as { rooms?: RawRoom[] }).rooms)
      ? (doc as unknown as { rooms: RawRoom[] }).rooms
      : [];
    const expected = jsReducerTotals(rooms);
    const actual = totalsForQuotation(aggregated, id);

    const subtotalDiff = Math.abs(expected.subtotal - actual.subtotal);
    const ok =
      expected.roomsCount === actual.roomsCount &&
      expected.productsCount === actual.productsCount &&
      subtotalDiff < 1e-9;

    if (!ok) {
      mismatches += 1;
      console.log(`MISMATCH ${id}:`, { expected, actual, subtotalDiff });
    }
  }

  console.log(`Checked ${docs.length} quotations.`);
  console.log(mismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${mismatches} mismatches.`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-quotation-totals-aggregation failed:", error);
  process.exit(1);
});
