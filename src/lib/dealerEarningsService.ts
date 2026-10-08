import { Quotation } from "@/models";
import {
  CONFIRMED_EARNING_STATUSES,
  calculateDealerEarning,
  resolveCustomerDiscountPercent,
  roundMoney,
  toPlainNumber,
} from "@/lib/dealerEarnings";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "@/lib/quotationTotals";

/**
 * Authoritative confirmed earnings for one dealer: the sum over that dealer's
 * ASSIGNED quotations (dealerId, not createdBy) that are Approved or Delivered,
 * each calculated from its own allocation snapshot, customer discount and line
 * items. Every quotation is counted once, so Approved -> Delivered never doubles.
 */
/**
 * Confirmed earnings across ALL dealers (admin overview). Same rule and the same
 * per-quotation calculation as `getConfirmedEarningsForDealer`: Approved and
 * Delivered quotations that are assigned to a dealer, each counted once.
 */
/**
 * Shared by both functions below: fetches the matching quotations' scalar
 * fields only (never `rooms`/`items`), gets every one of their subtotals in
 * one aggregation, and sums `calculateDealerEarning`'s result over them —
 * the identical formula both functions always used, just no longer fed by a
 * `rooms -> items` populate.
 */
async function sumConfirmedEarnings(filter: Record<string, unknown>): Promise<number> {
  const quotations = await Quotation.find(filter)
    .select("_id allocatedDiscountPercent discountType discountValue customerDiscountPercent")
    .lean();

  const ids = quotations.map((q) => String(q._id));
  const aggregatedTotals = await aggregateQuotationRoomTotals(ids);

  let total = 0;
  for (const quotation of quotations) {
    const { subtotal } = totalsForQuotation(aggregatedTotals, String(quotation._id));
    const { earningAmount } = calculateDealerEarning({
      subtotal,
      allocatedPercent: toPlainNumber(quotation.allocatedDiscountPercent),
      customerPercent: resolveCustomerDiscountPercent(quotation),
    });
    total += earningAmount;
  }
  return roundMoney(total);
}

export async function getConfirmedEarningsTotal(): Promise<number> {
  return sumConfirmedEarnings({
    dealerId: { $ne: null },
    status: { $in: [...CONFIRMED_EARNING_STATUSES] },
  });
}

export async function getConfirmedEarningsForDealer(dealerId: number): Promise<number> {
  return sumConfirmedEarnings({
    dealerId,
    status: { $in: [...CONFIRMED_EARNING_STATUSES] },
  });
}
