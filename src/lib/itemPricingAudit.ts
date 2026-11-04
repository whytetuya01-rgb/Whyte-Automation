/**
 * Plain-language lines for the pricing events in a quotation's audit trail (a custom unit price, a per-product discount).
 * Pure, so the quotation activity list and the admin activity log describe them identically.
 */

export const ITEM_PRICING_AUDIT_ACTIONS = ["item_price_overridden", "item_price_reset", "item_discount_applied", "item_discount_removed"] as const;

const inr = (value: unknown): string => {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
};

const text = (source: Record<string, unknown> | null | undefined, key: string): string => {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
};

/** The line for one pricing event, or null when the action is not a pricing one. */
export function describeItemPricingEvent(
  action: string,
  previousValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const product = text(metadata, "productName") || "a product";
  const quantity = Number(metadata?.quantity);
  const on = Number.isFinite(quantity) && quantity > 0 ? `${product} (×${quantity})` : product;
  switch (action) {
    case "item_price_overridden":
      return `Set a custom unit price on ${on}: ${inr(previousValue?.unitPrice)} → ${inr(newValue?.unitPrice)}`;
    case "item_price_reset":
      return `Put ${on} back to the catalogue price: ${inr(previousValue?.unitPrice)} → ${inr(newValue?.unitPrice)}`;
    case "item_discount_applied": {
      const type = text(newValue, "discountType");
      const value = Number(newValue?.discountValue);
      const label = type === "percentage" ? `${value}%` : inr(value);
      return `Gave a ${label} discount on ${on}: ${inr(previousValue?.unitPrice)} → ${inr(newValue?.unitPrice)} each`;
    }
    case "item_discount_removed":
      return `Removed the discount on ${on}: ${inr(previousValue?.unitPrice)} → ${inr(newValue?.unitPrice)} each`;
    default:
      return null;
  }
}
