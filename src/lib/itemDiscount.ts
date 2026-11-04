/**
 * Per-product discount on a quotation line (Admin and Company Owner only).
 *
 * How it is stored: the line's `unitPrice` stays THE price the customer pays per unit (so every total, the PDF, the
 * dashboard and the CRM keep adding up exactly as before); the discount is recorded beside it as `discountType`,
 * `discountValue` and `preDiscountUnitPrice` (the price before the discount). A discount is "per unit": a percentage of the
 * unit price, or a fixed rupee amount off each unit, so changing the quantity never needs the price re-worked.
 *
 * Pure (no server imports) so the review grid, the API and the tests share one definition.
 */

export type ItemDiscountType = "percentage" | "fixed";

export const ITEM_DISCOUNT_ROLES: readonly string[] = ["admin", "company_owner"];

/**
 * Only an Admin or a Company Owner may give a per-product discount. A Super Admin may too, but only while explicitly
 * acting within a selected company (the "act as company" grant): outside one it has no company's quotation to discount.
 */
export function canGiveItemDiscount(role: string | null | undefined, actingAsCompany = false): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "super_admin") return actingAsCompany;
  return ITEM_DISCOUNT_ROLES.includes(normalized);
}

/** Roles that may set a custom unit price (an override of the catalogue price). Sales executives and dealers may not. */
export const PRICE_OVERRIDE_ROLES: readonly string[] = ["admin", "company_owner"];

export function canOverrideItemPrice(role: string | null | undefined): boolean {
  return PRICE_OVERRIDE_ROLES.includes((role ?? "").trim().toLowerCase());
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Why this discount is not acceptable on a unit price, or null when it is. */
export function validateItemDiscount(basePrice: number, type: ItemDiscountType, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return "Enter a discount greater than zero.";
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return "A discount can have at most 2 decimal places.";
  if (type === "percentage" && value > 100) return "A percentage discount cannot be more than 100%.";
  if (type === "fixed" && value > basePrice + 1e-9) return `The discount cannot be more than the unit price (₹${round2(basePrice)}).`;
  return null;
}

/** The rupees taken off each unit. */
export function discountPerUnit(basePrice: number, type: ItemDiscountType, value: number): number {
  return type === "percentage" ? round2((basePrice * value) / 100) : round2(value);
}

/** The price per unit after the discount (never below zero). */
export function netUnitPrice(basePrice: number, type: ItemDiscountType, value: number): number {
  const net = type === "percentage" ? round2((basePrice * (100 - value)) / 100) : round2(basePrice - value);
  return net < 0 ? 0 : net;
}

export interface ItemDiscountPreview {
  perUnit: number;
  netUnit: number;
  lineBefore: number;
  lineAfter: number;
  saving: number;
}

/** What the discount does to a line, as the review grid shows it while the person is typing. */
export function previewItemDiscount(basePrice: number, quantity: number, type: ItemDiscountType, value: number): ItemDiscountPreview {
  const netUnit = netUnitPrice(basePrice, type, value);
  const qty = Math.max(1, Math.round(quantity) || 1);
  const lineBefore = round2(basePrice * qty);
  const lineAfter = round2(netUnit * qty);
  return { perUnit: round2(basePrice - netUnit), netUnit, lineBefore, lineAfter, saving: round2(lineBefore - lineAfter) };
}

export interface StoredItemDiscount {
  type: ItemDiscountType;
  value: number;
  /** The unit price before the discount. */
  preDiscountUnitPrice: number;
}

/**
 * The discount on a line, if it is still valid: the stored discount applied to the stored pre-discount price must still
 * give the line's current unit price. If the price was changed in some other way (another product or variant chosen,
 * a mass edit, a custom price) the stored discount is stale and is ignored.
 */
export function intactItemDiscount(item: {
  unitPrice?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  preDiscountUnitPrice?: unknown;
}): StoredItemDiscount | null {
  const type = item.discountType;
  if (type !== "percentage" && type !== "fixed") return null;
  const value = Number(item.discountValue);
  const pre = Number(item.preDiscountUnitPrice);
  const unit = Number(item.unitPrice);
  if (![value, pre, unit].every(Number.isFinite) || value <= 0 || pre < 0) return null;
  if (Math.abs(netUnitPrice(pre, type, value) - unit) > 0.011) return null;
  return { type, value, preDiscountUnitPrice: pre };
}

/** The price per unit before any discount: the stored one when a discount is intact, otherwise the current unit price. */
export function basePriceBeforeDiscount(item: { unitPrice?: unknown; discountType?: unknown; discountValue?: unknown; preDiscountUnitPrice?: unknown }): number {
  return intactItemDiscount(item)?.preDiscountUnitPrice ?? Number(item.unitPrice ?? 0);
}

/** A short label for the badge on a discounted line: "10% off" or "₹500 off". */
export function itemDiscountLabel(type: ItemDiscountType, value: number): string {
  return type === "percentage" ? `${round2(value)}% off` : `₹${round2(value)} off`;
}
