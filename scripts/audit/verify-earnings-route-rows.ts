import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { AdminUser, Quotation } from "../../src/models";
import {
  calculateDealerEarning,
  isConfirmedEarningStatus,
  resolveCustomerDiscountPercent,
  subtotalFromRooms,
  toPlainNumber,
} from "../../src/lib/dealerEarnings";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "../../src/lib/quotationTotals";

/**
 * READ-ONLY. Re-runs the EXACT per-quotation loop from
 * `GET /api/dealer/earnings` twice — once with the OLD subtotal source
 * (`subtotalFromRooms` over a full `rooms -> items` populate) and once with
 * the NEW one (`aggregateQuotationRoomTotals`) — for every real dealer, and
 * diffs every field the route computes. Only the subtotal SOURCE differs;
 * every formula below is copied verbatim from the route.
 */
interface Row {
  subtotal: number;
  customerDiscountPercent: number;
  customerDiscountAmount: number;
  netQuotationValue: number;
  allocatedDiscountPercent: number;
  dealerCommissionPercent: number;
  estimatedCommissionAmount: number;
  confirmedCommissionAmount: number;
  isConfirmed: boolean;
}

function computeRow(q: Record<string, unknown>, subtotalIn: number): Row {
  const qStatus = (q.status as string) || "draft";
  let subtotal = subtotalIn;

  const allocatedPct = toPlainNumber(q.allocatedDiscountPercent);
  const customerPct = resolveCustomerDiscountPercent(q as Parameters<typeof resolveCustomerDiscountPercent>[0]);
  const { earningPercent: commissionPct } = calculateDealerEarning({ subtotal: 0, allocatedPercent: allocatedPct, customerPercent: customerPct });

  const docEarning = toPlainNumber(q.estimatedEarningAmount);
  if (subtotal === 0 && docEarning > 0) {
    subtotal = commissionPct > 0 ? Math.round((docEarning / (commissionPct / 100)) * 100) / 100 : docEarning;
  }

  let customerDiscountAmount = 0;
  if (q.discountType === "percentage" || customerPct > 0) {
    customerDiscountAmount = Math.round(((subtotal * customerPct) / 100) * 100) / 100;
  } else if (q.discountType === "fixed") {
    customerDiscountAmount = toPlainNumber(q.discountValue);
  }

  const netQuotationValue = Math.max(0, Math.round((subtotal - customerDiscountAmount) * 100) / 100);

  let itemEstimatedCommission = calculateDealerEarning({ subtotal, allocatedPercent: allocatedPct, customerPercent: customerPct }).earningAmount;
  if (subtotal === 0 && docEarning > 0) itemEstimatedCommission = docEarning;

  const isConfirmed = isConfirmedEarningStatus(qStatus);
  const itemConfirmedCommission = isConfirmed ? itemEstimatedCommission : 0;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    customerDiscountPercent: customerPct,
    customerDiscountAmount: Math.round(customerDiscountAmount * 100) / 100,
    netQuotationValue,
    allocatedDiscountPercent: allocatedPct,
    dealerCommissionPercent: commissionPct,
    estimatedCommissionAmount: itemEstimatedCommission,
    confirmedCommissionAmount: itemConfirmedCommission,
    isConfirmed,
  };
}

async function main() {
  await connectMongoDB();
  const dealers = await AdminUser.find({ role: "dealer" }).select("_id").lean();

  let totalMismatches = 0;
  let totalRows = 0;

  for (const dealer of dealers) {
    const dealerId = Number((dealer as { _id: unknown })._id);
    const docs = await Quotation.find({ dealerId })
      .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
      .lean();
    const ids = docs.map((d) => String(d._id));
    const aggregated = await aggregateQuotationRoomTotals(ids);

    for (const doc of docs) {
      totalRows += 1;
      const oldSubtotal = subtotalFromRooms(
        (doc as { rooms?: Array<{ items?: Array<{ quantity?: unknown; unitPrice?: unknown }> }> }).rooms
      );
      const newSubtotal = totalsForQuotation(aggregated, String(doc._id)).subtotal;

      const oldRow = computeRow(doc as unknown as Record<string, unknown>, oldSubtotal);
      const newRow = computeRow(doc as unknown as Record<string, unknown>, newSubtotal);

      for (const key of Object.keys(oldRow) as Array<keyof Row>) {
        const a = oldRow[key];
        const b = newRow[key];
        const diff = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) : a === b ? 0 : 1;
        if (diff > 1e-9) {
          console.log(`MISMATCH dealer#${dealerId} quotation#${String(doc._id)}.${key}: ${a} -> ${b}`);
          totalMismatches += 1;
        }
      }
    }
  }

  console.log(`Checked ${totalRows} quotation rows across ${dealers.length} dealers.`);
  console.log(totalMismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${totalMismatches} mismatches.`);
  process.exit(totalMismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-earnings-route-rows failed:", error);
  process.exit(1);
});
