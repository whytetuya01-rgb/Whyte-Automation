/**
 * Who may create and modify which accounts, and with which roles.
 *
 * The `/api/admin/users*` routes enforce these rules server-side (and every
 * query is tenant-scoped by the session's company, never by client input);
 * the Users page imports the same functions only to decide what to show, so
 * the UI cannot drift from what the API will actually accept.
 *
 *  - Account management is a Company Owner capability (own company only) and
 *    a Super Admin capability. It is NOT the `admins:manage` permission, which
 *    is Super Admin-exclusive platform administration no Company Owner holds.
 *  - A Super Admin with no company selected has no company to manage. The one
 *    platform-level action still allowed is creating another `super_admin`
 *    account, which belongs to no company.
 *  - Only a Super Admin can create an `admin` or promote an account to it.
 *    A Company Owner / company Admin can assign only `configurable_admin`,
 *    `sales_executive` and the company's own custom roles. Never `super_admin`,
 *    `admin`, `company_owner` (full control of the company) or `dealer`
 *    (registration/dealer flow). This is enforced in `canAssignRole`, which
 *    every create/update path calls, so a direct API call cannot bypass it.
 *  - A Company Owner cannot modify `company_owner` or `super_admin` accounts.
 */

export const OWNER_ASSIGNABLE_SYSTEM_ROLES = ["configurable_admin", "sales_executive"] as const;

/** Roles with company-wide administrative control; only a Super Admin may grant them. */
export const ADMIN_LEVEL_ROLE_KEYS = ["admin", "company_owner", "super_admin"] as const;

/** Account/role management roles. Whether they can act right now also depends on having a company context. */
export function isUserManager(role: string | null | undefined): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === "super_admin" || normalized === "company_owner" || normalized === "admin";
}

export interface UserManagementActor {
  role: string | null | undefined;
  /** True when the request runs inside a company (always for a Company Owner/Admin; for a Super Admin only while acting as one). */
  hasCompanyContext: boolean;
}

/** Whether `actor` may give an account the role `targetRoleKey` (on create, or when changing an existing account's role). */
export function canAssignRole(
  actor: UserManagementActor,
  targetRoleKey: string,
  companyCustomRoleKeys: readonly string[]
): boolean {
  const caller = actor.role?.trim().toLowerCase();
  const key = targetRoleKey.trim().toLowerCase();
  if (key === "dealer" || key === "sales") return false;

  if (caller === "super_admin") {
    if (!actor.hasCompanyContext) return key === "super_admin";
    return true;
  }

  if (caller === "company_owner" || caller === "admin") {
    if (!actor.hasCompanyContext) return false;
    if ((ADMIN_LEVEL_ROLE_KEYS as readonly string[]).includes(key)) return false;
    return (
      (OWNER_ASSIGNABLE_SYSTEM_ROLES as readonly string[]).includes(key) ||
      companyCustomRoleKeys.map((k) => k.toLowerCase()).includes(key)
    );
  }

  return false;
}

/** Whether `actor` may modify an existing, non-dealer account whose current role is `targetRole`. */
export function canModifyAccountWithRole(actor: UserManagementActor, targetRole: string): boolean {
  const caller = actor.role?.trim().toLowerCase();
  const target = targetRole.trim().toLowerCase();
  if (!actor.hasCompanyContext) return false;
  if (caller === "super_admin") return true;
  if (caller === "company_owner" || caller === "admin") return target !== "company_owner" && target !== "admin" && target !== "super_admin";
  return false;
}
