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

export type QuotationActorRole = "super_admin" | "admin" | "dealer" | string | undefined;

export interface QuotationOwnershipFields {
  dealerId?: number | null;
  createdBy?: string | null;
}

export const ADMIN_QUOTATION_ROLES: readonly string[] = ["super_admin", "admin"];

export function isAdminRole(role: QuotationActorRole): boolean {
  return typeof role === "string" && ADMIN_QUOTATION_ROLES.includes(role);
}

export function canViewQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields
): boolean {
  if (role !== "dealer") return true;
  return quotation.dealerId === userId || quotation.createdBy === String(userId);
}

export function canModifyQuotation(
  role: QuotationActorRole,
  userId: number,
  quotation: QuotationOwnershipFields
): boolean {
  if (role !== "dealer") return true;
  return quotation.dealerId === userId;
}

/** Mongo filter limiting a query to the quotations a dealer may view. */
export function dealerVisibilityFilter(userId: number): Record<string, unknown> {
  return { $or: [{ dealerId: userId }, { createdBy: String(userId) }] };
}
