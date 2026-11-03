/**
 * Resolves the post-login landing destination for Admin and Superadmin users.
 * When logging in, admins navigate to the Apps launcher (/admin/apps) instead of the dashboard,
 * while honoring valid deep links to specific admin subpages (e.g. /admin/crm/leads).
 */
export function resolveAdminLoginDestination(requestedCallback: string | null): string {
  if (!requestedCallback) return "/admin/apps";
  if (!requestedCallback.startsWith("/") || requestedCallback.startsWith("//")) return "/admin/apps";

  const pathOnly = requestedCallback.split("?")[0].split("#")[0];

  // Root, dashboard, apps entry points, and login screens always navigate to the Apps launcher
  if (
    pathOnly === "/" ||
    pathOnly === "/admin" ||
    pathOnly === "/admin/dashboard" ||
    pathOnly === "/admin/login" ||
    pathOnly === "/login" ||
    pathOnly === "/apps" ||
    pathOnly.startsWith("/apps/") ||
    pathOnly === "/admin/apps"
  ) {
    return "/admin/apps";
  }

  // Preserve specific administrative deep links (e.g. /admin/products, /admin/crm/leads)
  if (pathOnly.startsWith("/admin/")) {
    return requestedCallback;
  }

  return "/admin/apps";
}
