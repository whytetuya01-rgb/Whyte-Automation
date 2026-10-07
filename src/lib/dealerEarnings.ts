/**
 * Single source of truth for dealer earning maths and the customer-discount cap.
 * Pure functions only (no database, no React), so the API routes, the dealer
 * dashboard and the quotation Review screen all use the exact same rules.
 *
 * Business rule (unchanged):
 *   Dealer allocated discount  = the most the dealer may give the customer.
 *   Customer discount          <= allocated discount.
 *   Dealer earning             = eligibleSubtotal x (allocated% - customer%)
 *
 * Earnings only count as CONFIRMED once a quotation is Approved or Delivered.
 * `estimatedEarningAmount` stored on the quotation is only an estimate/frozen
 * copy; confirmed earnings are always recalculated from the quotation's own
 * allocation snapshot, customer discount and line items.
 */

export const CONFIRMED_EARNING_STATUSES = ["approved", "delivered"] as const;

export function isConfirmedEarningStatus(status: string | null | undefined): boolean {
  return status === "approved" || status === "delivered";
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Converts anything a quotation field may hold (number, numeric string,
 * Decimal128, `{ $numberDecimal }`) to a plain finite number. Never returns an
 * object, so BSON values cannot leak into JSON sent to Client Components.
 */
export function toPlainNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "$numberDecimal" in value) {
    return toPlainNumber((value as { $numberDecimal: unknown }).$numberDecimal);
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface DiscountFields {
  customerDiscountPercent?: unknown;
  discountType?: string | null;
  discountValue?: unknown;
}

/** The customer discount percentage a quotation currently carries. */
export function resolveCustomerDiscountPercent(quotation: DiscountFields): number {
  if (quotation.customerDiscountPercent !== undefined && quotation.customerDiscountPercent !== null) {
    return toPlainNumber(quotation.customerDiscountPercent);
  }
  return quotation.discountType === "percentage" ? toPlainNumber(quotation.discountValue) : 0;
}

export interface EarningInput {
  subtotal: number;
  allocatedPercent: number;
  customerPercent: number;
}

export interface EarningResult {
  /** allocated% - customer%, never below zero. */
  earningPercent: number;
  earningAmount: number;
}

export function calculateDealerEarning({ subtotal, allocatedPercent, customerPercent }: EarningInput): EarningResult {
  const earningPercent = Math.max(0, allocatedPercent - customerPercent);
  return { earningPercent, earningAmount: roundMoney((subtotal * earningPercent) / 100) };
}

interface RoomWithItems {
  items?: Array<{ quantity?: unknown; unitPrice?: unknown }> | null;
}

/** Eligible subtotal: sum of quantity x unit price over every line item. */
export function subtotalFromRooms(rooms: RoomWithItems[] | null | undefined): number {
  if (!Array.isArray(rooms)) return 0;
  return rooms.reduce(
    (sum, room) =>
      sum +
      (Array.isArray(room.items)
        ? room.items.reduce(
            (itemSum, item) => itemSum + (toPlainNumber(item.quantity) || 1) * toPlainNumber(item.unitPrice),
            0
          )
        : 0),
    0
  );
}

/**
 * Customer discount cap.
 *
 * A quotation that belongs to a dealer is capped at that dealer's allocation
 * snapshot, INCLUDING a snapshot of 0% (no allocation = no customer discount).
 * Quotations with no dealer are not capped here.
 */
export function customerDiscountError(params: {
  hasDealer: boolean;
  allocatedPercent: number;
  customerPercent: number;
  /** true when the caller is the dealer themself ("your" vs "the dealer's"). */
  actorIsDealer: boolean;
}): string | null {
  const { hasDealer, allocatedPercent, customerPercent, actorIsDealer } = params;
  if (!hasDealer) return null;
  // Compare at 2dp so 20.00 vs 20.004 style float noise never blocks a valid value.
  if (roundMoney(customerPercent) <= roundMoney(allocatedPercent)) return null;
  const owner = actorIsDealer ? "your" : "the dealer's";
  return `Customer discount cannot exceed ${owner} allocated discount of ${allocatedPercent}%.`;
}
