import { Quotation } from "@/models";
import {
  CONFIRMED_EARNING_STATUSES,
  calculateDealerEarning,
  resolveCustomerDiscountPercent,
  roundMoney,
  subtotalFromRooms,
  toPlainNumber,
} from "@/lib/dealerEarnings";

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
export async function getConfirmedEarningsTotal(): Promise<number> {
  const quotations = await Quotation.find({
    dealerId: { $ne: null },
    status: { $in: [...CONFIRMED_EARNING_STATUSES] },
  })
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean();

  let total = 0;
  for (const quotation of quotations) {
    const { earningAmount } = calculateDealerEarning({
      subtotal: subtotalFromRooms((quotation as { rooms?: Array<{ items?: Array<{ quantity?: unknown; unitPrice?: unknown }> }> }).rooms),
      allocatedPercent: toPlainNumber(quotation.allocatedDiscountPercent),
      customerPercent: resolveCustomerDiscountPercent(quotation),
    });
    total += earningAmount;
  }
  return roundMoney(total);
}

export async function getConfirmedEarningsForDealer(dealerId: number): Promise<number> {
  const quotations = await Quotation.find({
    dealerId,
    status: { $in: [...CONFIRMED_EARNING_STATUSES] },
  })
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean();

  let total = 0;
  for (const quotation of quotations) {
    const { earningAmount } = calculateDealerEarning({
      subtotal: subtotalFromRooms((quotation as { rooms?: Array<{ items?: Array<{ quantity?: unknown; unitPrice?: unknown }> }> }).rooms),
      allocatedPercent: toPlainNumber(quotation.allocatedDiscountPercent),
      customerPercent: resolveCustomerDiscountPercent(quotation),
    });
    total += earningAmount;
  }
  return roundMoney(total);
}
