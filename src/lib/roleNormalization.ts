/**
 * Canonical Role Registry & Normalization for Whyte Quotation Platform.
 *
 * Official four-role RBAC model:
 * 1. super_admin   -> Super Admin (Platform-level administration)
 * 2. admin         -> Admin (Company-scoped administration)
 * 3. sales_executive -> Sales Executive (Company-scoped assigned sales representative)
 * 4. dealer        -> Dealer (Authorized partner channel access)
 */

export const CANONICAL_ROLES = [
  "super_admin",
  "admin",
  "sales_executive",
  "dealer",
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

export const CANONICAL_ROLE_LABELS: Readonly<Record<CanonicalRole, string>> = {
  super_admin: "Super Admin",
  admin: "Admin",
  sales_executive: "Sales Executive",
  dealer: "Dealer",
};

const CANONICAL_ROLE_SET = new Set<string>(CANONICAL_ROLES);

/**
 * Validates whether an unknown value is one of the four canonical roles.
 */
export function isCanonicalRole(role: unknown): role is CanonicalRole {
  return typeof role === "string" && CANONICAL_ROLE_SET.has(role.trim().toLowerCase());
}

/**
 * Normalizes user-supplied or database role strings to their canonical form.
 * Handles common casing, spacing, and hyphenation variations.
 * Returns null if the value is not a valid or recognizable role string.
 */
export function normalizeRole(role: unknown): CanonicalRole | string | null {
  if (typeof role !== "string" || !role.trim()) return null;
  const cleaned = role.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (cleaned === "super_admin" || cleaned === "superadmin") {
    return "super_admin";
  }
  if (cleaned === "admin" || cleaned === "administrator") {
    return "admin";
  }
  if (cleaned === "sales_executive" || cleaned === "salesexecutive") {
    return "sales_executive";
  }
  if (cleaned === "dealer") {
    return "dealer";
  }

  // Preserve legacy role strings explicitly during transition
  if (cleaned === "company_owner" || cleaned === "configurable_admin" || cleaned === "sales") {
    return cleaned;
  }

  return cleaned;
}

/**
 * Returns the human-readable display label for any canonical or legacy role.
 */
export function getRoleLabel(role: unknown): string {
  if (typeof role !== "string" || !role.trim()) return "Unknown";
  const normalized = normalizeRole(role);

  switch (normalized) {
    case "super_admin":
      return CANONICAL_ROLE_LABELS.super_admin;
    case "admin":
      return CANONICAL_ROLE_LABELS.admin;
    case "sales_executive":
      return CANONICAL_ROLE_LABELS.sales_executive;
    case "dealer":
      return CANONICAL_ROLE_LABELS.dealer;
    case "company_owner":
      return "Company Owner (Legacy)";
    case "configurable_admin":
      return "Configurable Admin (Legacy)";
    case "sales":
      return "Sales (Legacy)";
    default:
      return role.trim();
  }
}
