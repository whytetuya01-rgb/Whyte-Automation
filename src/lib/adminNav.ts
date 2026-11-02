import { hasPermission } from "@/lib/permissions";

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

/**
 * Sidebar links that need a permission, not just a role: shown when the user holds ANY of the listed permissions.
 * Super Admin, Company Owner and Admin always have CRM (see hasPermission), so this only hides CRM links from a
 * Configurable Admin whose role was not granted them. Visibility only: each CRM API checks its own permission.
 */
const NAV_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "/admin/crm/pipeline": ["crm:read", "leads:read"],
  "/admin/crm/leads": ["leads:read"],
  "/admin/crm/follow-ups": ["leads:read"],
  "/admin/crm/customers": ["customers:read"],
  "/admin/crm/sources": ["crm:manage"],
  "/admin/crm/assignment": ["crm:manage"],
};

export function canSeeAdminNavItem(href: string, rawRole: string | null | undefined, permissions?: readonly string[] | null): boolean {
  const allowed = RESTRICTED_NAV_ROLES[href];
  if (allowed && !allowed.includes(toAdminNavRole(rawRole))) return false;
  const needed = NAV_PERMISSIONS[href];
  if (!needed) return true;
  return needed.some((permission) => hasPermission(rawRole, permissions ? [...permissions] : [], permission));
}
