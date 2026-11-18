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
  companyId?: number | null;
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

/**
 * Builds a strict tenant-scoped query filter for looking up a single quotation.
 * If companyId is supplied, it strictly scopes the query to that company.
 * If missing, it returns an unsatisfiable filter { companyId: -1 } (fail closed).
 */
export function tenantQuotationFilter(
  quotationId: string,
  role?: QuotationActorRole,
  companyId?: number | null
): Record<string, unknown> {
  const filter: Record<string, unknown> = { _id: quotationId };

  if (companyId != null) {
    filter.companyId = companyId;
  } else {
    // Missing company context fails closed for all tenant roles
    filter.companyId = -1;
  }

  return filter;
}

export function canViewQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields,
  permissions?: string[] | null,
  activeCompanyId?: number | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  // Strict tenant isolation: verify company scope matches if both are present
  if (activeCompanyId != null && quotation.companyId != null) {
    if (Number(quotation.companyId) !== Number(activeCompanyId)) {
      return false; // Cross-company access forbidden
    }
  } else if (!activeCompanyId && normRole !== "super_admin") {
    return false; // Missing company context fails closed
  }

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
  permissions?: string[] | null,
  activeCompanyId?: number | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  // Strict tenant isolation: verify company scope matches if both are present
  if (activeCompanyId != null && quotation.companyId != null) {
    if (Number(quotation.companyId) !== Number(activeCompanyId)) {
      return false; // Cross-company modification forbidden
    }
  } else if (!activeCompanyId && normRole !== "super_admin") {
    return false; // Missing company context fails closed
  }

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
  permissions?: string[] | null,
  activeCompanyId?: number | null
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();

  // Strict tenant isolation: verify company scope matches if both are present
  if (activeCompanyId != null && quotation.companyId != null) {
    if (Number(quotation.companyId) !== Number(activeCompanyId)) {
      return false; // Cross-company deletion forbidden
    }
  } else if (!activeCompanyId && normRole !== "super_admin") {
    return false; // Missing company context fails closed
  }

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

/** Returns the strict visibility query filter for a given actor role, user ID, and company ID. */
export function quotationVisibilityFilter(
  role: string | null | undefined,
  userId: number,
  permissions?: string[] | null,
  companyId?: number | null
): Record<string, unknown> {
  const normRole = (role || "").trim().toLowerCase();
  const filter: Record<string, unknown> = {};

  if (companyId != null) {
    filter.companyId = companyId;
  } else if (normRole !== "super_admin") {
    // Missing company context fails closed for all tenant roles
    return { companyId: -1 };
  }

  if (normRole === "super_admin") return filter;
  if (normRole === "dealer") return { ...filter, ...dealerVisibilityFilter(userId) };
  if (normRole === "sales_executive") return { ...filter, ...salesExecutiveVisibilityFilter(userId) };
  if (hasPermission(role, permissions, "quotations:read_all")) return filter;
  return { ...filter, createdBy: String(userId) };
}

