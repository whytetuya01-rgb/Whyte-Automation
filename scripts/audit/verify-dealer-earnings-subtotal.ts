import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { subtotalFromRooms } from "../../src/lib/dealerEarnings";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "../../src/lib/quotationTotals";

/**
 * READ-ONLY. `subtotalFromRooms` (used by the dealer earnings service/route)
 * and `aggregateQuotationRoomTotals` (the new aggregation) clamp a
 * *negative* item quantity slightly differently (see the comment in
 * `quotationTotals.ts`) — this proves that difference has zero footprint on
 * real data, for EVERY quotation, by comparing the two subtotal sources
 * directly.
 */
async function main() {
  await connectMongoDB();

  const docs = await Quotation.find()
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean();

  const ids = docs.map((d) => String(d._id));
  const aggregated = await aggregateQuotationRoomTotals(ids);

  let mismatches = 0;
  for (const doc of docs) {
    const id = String(doc._id);
    const oldSubtotal = subtotalFromRooms(
      (doc as { rooms?: Array<{ items?: Array<{ quantity?: unknown; unitPrice?: unknown }> }> }).rooms
    );
    const newSubtotal = totalsForQuotation(aggregated, id).subtotal;
    if (Math.abs(oldSubtotal - newSubtotal) > 1e-9) {
      console.log(`MISMATCH ${id}: old=${oldSubtotal} new=${newSubtotal}`);
      mismatches += 1;
    }
  }

  console.log(`Checked ${docs.length} quotations.`);
  console.log(mismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${mismatches} mismatches.`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-dealer-earnings-subtotal failed:", error);
  process.exit(1);
});
