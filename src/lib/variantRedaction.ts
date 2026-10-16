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
  const normRole = (role || "").trim().toLowerCase();
  if (normRole === "super_admin") return true;
  if (Array.isArray(permissions)) {
    return hasPermission(normRole, permissions, "pricing:view_cost");
  }
  if (normRole === "admin" || normRole === "company_owner") return true;
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

/** Redacts every item inside a single quotation room. */
export function redactQuotationRoomForRole<T extends Pick<QuotationRoom, "items">>(
  room: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return room;
  if (!Array.isArray(room.items)) return room;
  return {
    ...room,
    items: room.items.map((item) => redactQuotationItemForRole(item, role, permissions)),
  };
}

/** Redacts internal data from a quotation (costs from items; dealer earnings/allocations for unprivileged non-dealers). */
export function redactQuotationForRole<T extends Pick<Quotation, "rooms">>(
  quotation: T,
  role: string | null | undefined,
  permissions?: string[] | null | undefined
): T {
  if (isPrivilegedRole(role, permissions)) return quotation;
  const normRole = (role || "").trim().toLowerCase();
  const rooms = quotation.rooms as QuotationRoom[] | undefined;
  const redactedRooms = Array.isArray(rooms)
    ? rooms.map((room) => redactQuotationRoomForRole(room, role, permissions))
    : rooms;

  const result: Record<string, unknown> = {
    ...quotation,
    rooms: redactedRooms,
  };

  // For sales_executive, remove unauthorized dealer earnings and restricted discount-allocation details
  if (normRole === "sales_executive") {
    delete result.allocatedDiscountPercent;
    delete result.estimatedEarningPercent;
    delete result.estimatedEarningAmount;
  }

  return result as T;
}

