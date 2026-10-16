/**
 * Single source of truth for who may see / change a quotation.
 *
 * Ownership model (see `src/models/Quotation.ts`):
 *   createdBy  - String(user id) of whoever created it
 *   dealerId   - dealer it is currently assigned to ("assignedTo")
 *
 * Super Admin and Admin keep their existing behaviour (all quotations). A dealer
 * may VIEW quotations assigned to them or created by them, but may only MODIFY
 * quotations currently assigned to them: if an admin moves a quotation to another
 * dealer, the original creator keeps read access without being able to edit it.
 */

import { hasPermission } from "@/lib/permissions";

export type QuotationActorRole =
  | "super_admin"
  | "admin"
  | "company_owner"
  | "sales_executive"
  | "dealer"
  | "configurable_admin"
  | string
  | undefined;

export interface QuotationOwnershipFields {
  dealerId?: number | null;
  assignedSalesId?: number | null;
  createdBy?: string | null;
}

export const ADMIN_QUOTATION_ROLES: readonly string[] = [
  "super_admin",
  "admin",
  "company_owner",
  "configurable_admin",
];

export function isAdminRole(role: QuotationActorRole): boolean {
  if (!role) return false;
  const norm = role.trim().toLowerCase();
  return ADMIN_QUOTATION_ROLES.includes(norm);
}

export function canViewQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields,
  permissions?: string[] | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  if (normRole === "super_admin") return true;

  if (normRole === "dealer") {
    return quotation.dealerId === userId || quotation.createdBy === String(userId);
  }

  if (normRole === "sales_executive") {
    // Sales Executive may only view quotations explicitly assigned to them
    return quotation.assignedSalesId === userId;
  }

  if (hasPermission(role, permissions, "quotations:read_all")) {
    return true;
  }

  return quotation.createdBy === String(userId);
}

export function canModifyQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields,
  permissions?: string[] | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  if (normRole === "super_admin") return true;

  if (normRole === "dealer") {
    return quotation.dealerId === userId;
  }

  if (normRole === "sales_executive") {
    // Sales Executive may only modify quotations explicitly assigned to them
    return quotation.assignedSalesId === userId;
  }

  if (hasPermission(role, permissions, "quotations:edit_all")) {
    return true;
  }

  return quotation.createdBy === String(userId) && hasPermission(role, permissions, "quotations:create");
}

export function canDeleteQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields,
  permissions?: string[] | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  if (normRole === "super_admin") return true;

  // Sales Executive does not possess deletion capabilities
  if (normRole === "sales_executive") return false;

  if (normRole === "dealer") {
    return quotation.dealerId === userId;
  }

  if (hasPermission(role, permissions, "quotations:delete")) {
    return true;
  }

  return false;
}

/** Mongo filter limiting a query to the quotations a dealer may view. */
export function dealerVisibilityFilter(userId: number): Record<string, unknown> {
  return { $or: [{ dealerId: userId }, { createdBy: String(userId) }] };
}

/** Mongo filter limiting a query to quotations assigned to a specific sales executive. */
export function salesExecutiveVisibilityFilter(userId: number): Record<string, unknown> {
  return { assignedSalesId: userId };
}

/** Returns the strict visibility query filter for a given actor role and user ID. */
export function quotationVisibilityFilter(
  role: string | null | undefined,
  userId: number,
  permissions?: string[] | null
): Record<string, unknown> | null {
  if (!role) return { companyId: -1 };
  const normRole = role.trim().toLowerCase();

  if (normRole === "super_admin") return null;
  if (normRole === "dealer") return dealerVisibilityFilter(userId);
  if (normRole === "sales_executive") return salesExecutiveVisibilityFilter(userId);
  if (hasPermission(role, permissions, "quotations:read_all")) return null;
  return { createdBy: String(userId) };
}

