import type { Product, Quotation, QuotationItem, QuotationRoom } from "@/types";
import { hasPermission } from "@/lib/permissions";

/**
 * Server-side, role-aware redaction of internal margin fields.
 *
 * `cost` (purchase price) and `purchaseTaxPercent` are internal margin data:
 * only Super Admin, Admin, or a Configurable Admin explicitly granted the
 * `pricing:view_cost` capability may see them. Every other authenticated role
 * (dealer, unpermissioned configurable_admin) must never receive them in an
 * API response or page prop.
 *
 * This is applied at the response/prop boundary, not inside
 * `serializeVariant` / `normalizeProduct` themselves — those stay shared,
 * role-agnostic serializers that internal calculations and privileged screens
 * still need full output from.
 */


export function isPrivilegedRole(
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): boolean {
  if (!role) return false;
  if (role === "super_admin") return true;
  if (Array.isArray(permissions)) {
    return hasPermission(role, permissions, "pricing:view_cost");
  }
  if (role === "admin") return true;
  return false;
}

/**
 * Strips `cost` / `purchaseTaxPercent` from a single variant when the role is
 * not privileged or lacks explicit `pricing:view_cost` capability.
 */
export function redactVariantForRole<T>(
  variant: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return variant;
  if (variant === null || typeof variant !== "object") return variant;
  const redacted = { ...(variant as Record<string, unknown>) };
  delete redacted.cost;
  delete redacted.purchaseTaxPercent;
  return redacted as T;
}

/** Strips `cost` / `purchaseTaxPercent` from every variant of a product. */
export function redactProductForRole<T extends Pick<Product, "variants">>(
  product: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return product;
  if (!Array.isArray(product.variants)) return product;
  return {
    ...product,
    variants: product.variants.map((variant) => redactVariantForRole(variant, role, permissions)),
  };
}

/** Same as {@link redactProductForRole}, applied to a list. */
export function redactProductsForRole<T extends Pick<Product, "variants">>(
  products: T[],
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T[] {
  if (isPrivilegedRole(role, permissions)) return products;
  return products.map((product) => redactProductForRole(product, role, permissions));
}

/** Redacts the nested `product` and `productVariant` of a single quotation item. */
export function redactQuotationItemForRole<T extends Pick<QuotationItem, "product" | "productVariant">>(
  item: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return item;
  return {
    ...item,
    product: item.product ? redactProductForRole(item.product, role, permissions) : item.product,
    productVariant: item.productVariant
      ? redactVariantForRole(item.productVariant, role, permissions)
      : item.productVariant,
  };
}

/** Redacts every item inside every room of a quotation. */
export function redactQuotationForRole<T extends Pick<Quotation, "rooms">>(
  quotation: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return quotation;
  const rooms = quotation.rooms as QuotationRoom[] | undefined;
  if (!Array.isArray(rooms)) return quotation;
  return {
    ...quotation,
    rooms: rooms.map((room) => ({
      ...room,
      items: Array.isArray(room.items)
        ? room.items.map((item) => redactQuotationItemForRole(item, role, permissions))
        : room.items,
    })),
  };
}
