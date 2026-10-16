/**
 * What the Roles & Permissions and Users pages SHOW to a signed-in user. This
 * is a UX hint only — every `/api/admin/*` handler independently enforces the
 * same rules server-side (and tenant-scopes every query), so hiding or
 * showing controls here is never what protects anything.
 *
 * The two levels, as the API routes define them:
 *
 *  - READ (`GET /api/admin/roles*`, `GET /api/admin/users*`): the
 *    `admins:read` permission. Held by `super_admin`, `company_owner` and (by
 *    default) `admin`; a `configurable_admin` only if that permission was
 *    assigned to the user.
 *  - WRITE (roles: create / customize / reset / delete; users: create /
 *    modify): `super_admin` or `company_owner` only, and only inside a
 *    company context — a Company Owner always has one; a Super Admin only
 *    while explicitly "acting as" a company. This is deliberately NOT the
 *    `admins:manage` permission, which is Super Admin-exclusive (platform
 *    administration) and is never held by a Company Owner or Company Admin.
 *
 * `sessionPermissions` is the per-user list carried in the JWT, which only
 * matters for `configurable_admin`; it is not the role's effective permission
 * set, so an `admin` whose company revoked `admins:read` from the admin role
 * still sees the page and is simply refused by the API.
 */
export interface RolesPageAccess {
  canRead: boolean;
  /** Role write controls are available right now (a manager role WITH a company context). */
  canManage: boolean;
  /** A Super Admin with no company selected — company-specific writes are unavailable until one is. */
  needsCompanySelection: boolean;
}

export function getRolesPageAccess(
  role: string | null | undefined,
  sessionPermissions: readonly string[] | null | undefined,
  _hasCompanyContext = true
): RolesPageAccess {
  const normalizedRole = role?.trim().toLowerCase();
  const permissions = Array.isArray(sessionPermissions) ? sessionPermissions : [];

  // Only super_admin may manage global role definitions.
  const isSuperAdmin = normalizedRole === "super_admin";
  const hasOwnAdminsRead = normalizedRole === "configurable_admin" && permissions.includes("admins:read");

  return {
    canRead: isSuperAdmin || hasOwnAdminsRead,
    canManage: isSuperAdmin,
    needsCompanySelection: false,
  };
}

/** Users page: company user management (Add/Edit controls for permitted roles). */
export function getUsersPageAccess(
  role: string | null | undefined,
  sessionPermissions: readonly string[] | null | undefined,
  hasCompanyContext = true
): { canRead: boolean; canManage: boolean; needsCompanySelection: boolean } {
  const normalizedRole = role?.trim().toLowerCase();
  const permissions = Array.isArray(sessionPermissions) ? sessionPermissions : [];
  const isManager =
    normalizedRole === "super_admin" ||
    normalizedRole === "company_owner" ||
    normalizedRole === "admin";
  const hasOwnAdminsRead = normalizedRole === "configurable_admin" && permissions.includes("admins:read");

  return {
    canRead: isManager || hasOwnAdminsRead,
    canManage: isManager && (normalizedRole !== "super_admin" || hasCompanyContext),
    needsCompanySelection: normalizedRole === "super_admin" && !hasCompanyContext,
  };
}
