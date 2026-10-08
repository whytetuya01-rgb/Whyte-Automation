import type { Product, Quotation, QuotationItem, QuotationRoom } from "@/types";

/**
 * Server-side, role-aware redaction of internal margin fields.
 *
 * `cost` (purchase price) and `purchaseTaxPercent` are internal margin data:
 * only Super Admin / Admin may see them. Every other authenticated role
 * (currently: dealer) must never receive them in an API response or a page
 * prop, regardless of which screen is asking.
 *
 * This is applied at the response/prop boundary, not inside
 * `serializeVariant` / `normalizeProduct` themselves — those stay shared,
 * role-agnostic serializers that the admin catalog screens still need the
 * full (cost-inclusive) output from.
 */

const PRIVILEGED_ROLES = new Set(["super_admin", "admin"]);

export function isPrivilegedRole(role: string | null | undefined): boolean {
  return typeof role === "string" && PRIVILEGED_ROLES.has(role);
}

/**
 * Strips `cost` / `purchaseTaxPercent` from a single variant when the role is
 * not privileged. Generic over any variant-shaped object — including the
 * slim `QuotationItemVariantSummary` an embedded quotation item carries,
 * which never has these fields in the first place, making this a safe no-op
 * for it (deleting an absent key is harmless) rather than a type error.
 */
export function redactVariantForRole<T>(variant: T, role: string | null | undefined): T {
  if (isPrivilegedRole(role)) return variant;
  if (variant === null || typeof variant !== "object") return variant;
  const redacted = { ...(variant as Record<string, unknown>) };
  delete redacted.cost;
  delete redacted.purchaseTaxPercent;
  return redacted as T;
}

/** Strips `cost` / `purchaseTaxPercent` from every variant of a product when the role is not privileged. */
export function redactProductForRole<T extends Pick<Product, "variants">>(
  product: T,
  role: string | null | undefined
): T {
  if (isPrivilegedRole(role)) return product;
  if (!Array.isArray(product.variants)) return product;
  return {
    ...product,
    variants: product.variants.map((variant) => redactVariantForRole(variant, role)),
  };
}

/** Same as {@link redactProductForRole}, applied to a list. */
export function redactProductsForRole<T extends Pick<Product, "variants">>(
  products: T[],
  role: string | null | undefined
): T[] {
  if (isPrivilegedRole(role)) return products;
  return products.map((product) => redactProductForRole(product, role));
}

/** Redacts the nested `product` and `productVariant` of a single quotation item. */
export function redactQuotationItemForRole<T extends Pick<QuotationItem, "product" | "productVariant">>(
  item: T,
  role: string | null | undefined
): T {
  if (isPrivilegedRole(role)) return item;
  return {
    ...item,
    product: item.product ? redactProductForRole(item.product, role) : item.product,
    productVariant: item.productVariant ? redactVariantForRole(item.productVariant, role) : item.productVariant,
  };
}

/** Redacts every item inside every room of a quotation. */
export function redactQuotationForRole<T extends Pick<Quotation, "rooms">>(
  quotation: T,
  role: string | null | undefined
): T {
  if (isPrivilegedRole(role)) return quotation;
  const rooms = quotation.rooms as QuotationRoom[] | undefined;
  if (!Array.isArray(rooms)) return quotation;
  return {
    ...quotation,
    rooms: rooms.map((room) => ({
      ...room,
      items: Array.isArray(room.items)
        ? room.items.map((item) => redactQuotationItemForRole(item, role))
        : room.items,
    })),
  };
}
