/**
 * Which admin-panel sidebar roles may SEE the restricted links. Visibility
 * only: each target's API independently enforces its own authorization, so a
 * visible link never grants anything.
 *
 *  - Activity Log is platform-wide oversight (`activity:view`, Super Admin
 *    exclusive), so only `super_admin` sees it.
 *  - Users and Roles & Permissions are company-scoped management screens: a
 *    Company Owner manages its own company's accounts and roles; a Super
 *    Admin manages them while acting as a company.
 */
export type AdminNavRole = "super_admin" | "company_owner" | "admin" | "configurable_admin";

export const RESTRICTED_NAV_ROLES: Readonly<Record<string, readonly AdminNavRole[]>> = {
  "/admin/activity": ["super_admin"],
  "/admin/companies": ["super_admin"],
  "/admin/theme": ["super_admin", "company_owner", "admin"],
  "/admin/users": ["super_admin", "company_owner", "admin"],
  "/admin/roles": ["super_admin"],
};

/** Collapses a session role to the sidebar's role set (unknown/legacy admin-panel roles behave as `admin`). */
export function toAdminNavRole(rawRole: string | null | undefined): AdminNavRole {
  if (rawRole === "super_admin" || rawRole === "company_owner" || rawRole === "admin" || rawRole === "configurable_admin") return rawRole;
  return "admin";
}

export function canSeeAdminNavItem(href: string, rawRole: string | null | undefined): boolean {
  const allowed = RESTRICTED_NAV_ROLES[href];
  return !allowed || allowed.includes(toAdminNavRole(rawRole));
}
