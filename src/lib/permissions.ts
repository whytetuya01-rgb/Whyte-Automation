import type { AdminRole } from "@/types";

/**
 * Central Permission Registry for Whyte Quotation Platform.
 *
 * Defines all granular permission capabilities across catalog, pricing, dealers,
 * quotations, company settings, and system oversight.
 */

export const ALL_PERMISSIONS = [
  // Catalog Management
  "catalog:read",
  "catalog:create",
  "catalog:edit",
  "catalog:delete",
  "categories:read",
  "categories:manage",
  "spaces:read",
  "spaces:manage",
  "spaces:hard_delete", // Super Admin only: hard-delete house types & room types

  // Pricing & Margin Visibility
  "pricing:view_cost", // View cost (purchase price) and purchaseTaxPercent

  // Dealer Management
  "dealers:read",
  "dealers:manage",

  // Quotation Management
  "quotations:read_all",
  "quotations:create",
  "quotations:edit_all",
  "quotations:delete",
  "quotations:assign_dealer",
  "quotations:transition",

  // Company Profile & Settings
  "company:read",
  "company:edit",

  // System Oversight & User Administration (Super Admin exclusive)
  "activity:view",      // View audit trail / activity log
  "admins:read",        // View administrative user accounts
  "admins:manage",      // Create, update, deactivate administrative accounts & assign permissions
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * Super Admin-exclusive permissions that must never be assigned or granted
 * to regular `admin`, `configurable_admin`, or `dealer` accounts.
 */
export const SUPER_ADMIN_EXCLUSIVE_PERMISSIONS = new Set<Permission>([
  "spaces:hard_delete",
  "activity:view",
  "admins:manage",
]);

/**
 * Exact, explicit permission set for the legacy `admin` role.
 *
 * Preserves 100% of the existing Admin capabilities across catalog, dealers,
 * quotations, and company settings, while explicitly excluding Super Admin-only
 * operations. An explicit set is used instead of a wildcard to guarantee no
 * accidental privilege escalation for future sensitive features.
 */
export const ADMIN_PERMISSIONS = new Set<Permission>([
  "catalog:read",
  "catalog:create",
  "catalog:edit",
  "catalog:delete",
  "categories:read",
  "categories:manage",
  "spaces:read",
  "spaces:manage",
  "pricing:view_cost",
  "dealers:read",
  "dealers:manage",
  "quotations:read_all",
  "quotations:create",
  "quotations:edit_all",
  "quotations:delete",
  "quotations:assign_dealer",
  "quotations:transition",
  "company:read",
  "company:edit",
  "admins:read",
]);

export const ADMIN_DEFAULT_PERMISSIONS = ADMIN_PERMISSIONS;

/**
 * Default permission set for the `dealer` role before any custom customization.
 * Dealers can create quotations/proposals and read catalog master structures.
 */
export const DEALER_DEFAULT_PERMISSIONS = new Set<Permission>([
  "quotations:create",
  "categories:read",
  "spaces:read",
  "company:read",
]);

/**
 * Complete permission set for `super_admin`.
 */
export const SUPER_ADMIN_PERMISSIONS = new Set<Permission>(ALL_PERMISSIONS);

/** Validates if an unknown value is a known, valid Permission literal. */
export function isValidPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/** Filters an array of unknown values into a deduplicated list of strictly valid permissions. */
export function sanitizePermissions(values: unknown[]): Permission[] {
  if (!Array.isArray(values)) return [];
  const result = new Set<Permission>();
  for (const v of values) {
    if (isValidPermission(v)) {
      result.add(v);
    }
  }
  return Array.from(result);
}

/**
 * Evaluates whether an actor with a given role and assigned permission set
 * possesses the required permission.
 *
 * Rules:
 * - `super_admin`: Granted all permissions in `SUPER_ADMIN_PERMISSIONS`.
 * - Non-super-admin roles can NEVER possess Super Admin-exclusive permissions.
 * - When explicit `assignedPermissions` are provided (from DB RoleDefinition or user),
 *   membership in that list determines access.
 * - If `assignedPermissions` is omitted/null, falls back to the default permission
 *   set for that role (preserving 100% legacy behavior).
 */
export function hasPermission(
  role: AdminRole | string | null | undefined,
  assignedPermissions: string[] | null | undefined,
  requiredPermission: Permission
): boolean {
  if (!role) return false;
  const normRole = role.trim().toLowerCase();
  if (normRole === "sales") return false;

  if (normRole === "super_admin") {
    return SUPER_ADMIN_PERMISSIONS.has(requiredPermission);
  }

  // Super Admin-exclusive permissions can NEVER be granted to any non-super-admin role
  if (SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(requiredPermission)) {
    return false;
  }

  // If explicit permissions are provided (e.g. from session actor or DB role definition):
  if (Array.isArray(assignedPermissions) && assignedPermissions.length > 0) {
    return assignedPermissions.includes(requiredPermission);
  }

  // Fallback defaults for legacy callers, tests, or unpopulated user permissions:
  if (normRole === "admin") {
    return ADMIN_PERMISSIONS.has(requiredPermission);
  }

  if (normRole === "dealer") {
    return DEALER_DEFAULT_PERMISSIONS.has(requiredPermission);
  }

  return false;
}

/**
 * Returns the effective list of permissions available to the given actor.
 */
export function getEffectivePermissions(
  role: AdminRole | string | null | undefined,
  assignedPermissions: string[] | null | undefined
): Permission[] {
  if (!role) return [];
  const normRole = role.trim().toLowerCase();
  if (normRole === "sales") return [];

  if (normRole === "super_admin") {
    return Array.from(SUPER_ADMIN_PERMISSIONS);
  }

  if (Array.isArray(assignedPermissions) && assignedPermissions.length > 0) {
    return assignedPermissions.filter(
      (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
    );
  }

  if (role === "admin") {
    return Array.from(ADMIN_PERMISSIONS);
  }

  if (role === "dealer") {
    return Array.from(DEALER_DEFAULT_PERMISSIONS);
  }

  return [];
}

export type PermissionActionType =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "export"
  | "transition"
  | "settings"
  | "manage";

export interface PermissionMeta {
  key: Permission;
  label: string;
  description: string;
  module: string;
  action: PermissionActionType;
  isSuperAdminExclusive: boolean;
  isIncludedInAdmin: boolean;
}

export interface PermissionModuleGroup {
  id: string;
  name: string;
  description: string;
  permissions: PermissionMeta[];
}

export const PERMISSION_METADATA: Record<Permission, PermissionMeta> = {
  // Catalog Management
  "catalog:read": {
    key: "catalog:read",
    label: "View Products",
    description: "Browse products, technical specifications, and variant lists.",
    module: "Product Catalog",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "catalog:create": {
    key: "catalog:create",
    label: "Create Products",
    description: "Add new products and product variants to the catalog.",
    module: "Product Catalog",
    action: "create",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "catalog:edit": {
    key: "catalog:edit",
    label: "Edit Products",
    description: "Modify existing products, specifications, pricing, and assets.",
    module: "Product Catalog",
    action: "edit",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "catalog:delete": {
    key: "catalog:delete",
    label: "Soft Delete Products",
    description: "Deactivate and soft-delete products from the active catalog.",
    module: "Product Catalog",
    action: "delete",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },

  // Categories & Spaces
  "categories:read": {
    key: "categories:read",
    label: "View Categories",
    description: "Browse product categories and category hierarchies.",
    module: "Categories & Spaces",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "categories:manage": {
    key: "categories:manage",
    label: "Manage Categories",
    description: "Create, reorder, and update product categories.",
    module: "Categories & Spaces",
    action: "manage",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "spaces:read": {
    key: "spaces:read",
    label: "View Spaces",
    description: "Browse configured house types, room types, and architectural presets.",
    module: "Categories & Spaces",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "spaces:manage": {
    key: "spaces:manage",
    label: "Manage Spaces",
    description: "Create, edit, and soft-delete house types and room types.",
    module: "Categories & Spaces",
    action: "manage",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "spaces:hard_delete": {
    key: "spaces:hard_delete",
    label: "Hard Delete Spaces",
    description: "Permanently destroy house types and room types from the database.",
    module: "Categories & Spaces",
    action: "delete",
    isSuperAdminExclusive: true,
    isIncludedInAdmin: false,
  },

  // Pricing & Margins
  "pricing:view_cost": {
    key: "pricing:view_cost",
    label: "View Cost Prices & Margins",
    description: "Inspect raw purchase costs, purchase tax percentages, and base dealer margins.",
    module: "Pricing & Margins",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },

  // Dealer Management
  "dealers:read": {
    key: "dealers:read",
    label: "View Dealers",
    description: "Browse registered dealers, accounts, and order volume metrics.",
    module: "Dealer Management",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "dealers:manage": {
    key: "dealers:manage",
    label: "Manage Dealers",
    description: "Create, edit dealer profiles, and assign trade discount allocation percentages.",
    module: "Dealer Management",
    action: "manage",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },

  // Quotation Management
  "quotations:read_all": {
    key: "quotations:read_all",
    label: "View All Quotations",
    description: "Access and review quotations submitted across all dealers and administrative accounts.",
    module: "Quotation Management",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "quotations:create": {
    key: "quotations:create",
    label: "Create Quotations",
    description: "Generate new quotes, proposals, and room-by-room device schedules.",
    module: "Quotation Management",
    action: "create",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "quotations:edit_all": {
    key: "quotations:edit_all",
    label: "Edit All Quotations",
    description: "Modify existing quotations, change device quantities, and adjust line-item discounts.",
    module: "Quotation Management",
    action: "edit",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "quotations:delete": {
    key: "quotations:delete",
    label: "Delete Quotations",
    description: "Delete draft, rejected, or archived quotations.",
    module: "Quotation Management",
    action: "delete",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "quotations:assign_dealer": {
    key: "quotations:assign_dealer",
    label: "Assign Dealer Ownership",
    description: "Reassign quotation ownership or credit to specific registered dealers.",
    module: "Quotation Management",
    action: "manage",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "quotations:transition": {
    key: "quotations:transition",
    label: "Approve & Reject Proposals",
    description: "Approve, reject, or mark quotations as delivered in the quotation lifecycle.",
    module: "Quotation Management",
    action: "transition",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },

  // Company Profile & Settings
  "company:read": {
    key: "company:read",
    label: "View Company Profile",
    description: "Review company information, branding assets, bank details, and contact points.",
    module: "Company Settings",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "company:edit": {
    key: "company:edit",
    label: "Edit Company Profile",
    description: "Update company profile, proposal terms & conditions, and default print settings.",
    module: "Company Settings",
    action: "settings",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },

  // System Oversight & User Administration
  "activity:view": {
    key: "activity:view",
    label: "View Audit Trail & Activity Logs",
    description: "Inspect immutable audit logs, proposal transitions, and administrator actions.",
    module: "System Oversight",
    action: "view",
    isSuperAdminExclusive: true,
    isIncludedInAdmin: false,
  },
  "admins:read": {
    key: "admins:read",
    label: "View Administrative Accounts",
    description: "Browse administrative user accounts, roles, and assigned permission profiles.",
    module: "System Oversight",
    action: "view",
    isSuperAdminExclusive: false,
    isIncludedInAdmin: true,
  },
  "admins:manage": {
    key: "admins:manage",
    label: "Manage Administrative Roles & Accounts",
    description: "Create, edit, deactivate administrative users and modify granular permission sets.",
    module: "System Oversight",
    action: "manage",
    isSuperAdminExclusive: true,
    isIncludedInAdmin: false,
  },
};

export const PERMISSION_MODULE_GROUPS: PermissionModuleGroup[] = [
  {
    id: "catalog",
    name: "Product Catalog",
    description: "Manage products, technical specifications, and catalog variants.",
    permissions: [
      PERMISSION_METADATA["catalog:read"],
      PERMISSION_METADATA["catalog:create"],
      PERMISSION_METADATA["catalog:edit"],
      PERMISSION_METADATA["catalog:delete"],
    ],
  },
  {
    id: "spaces",
    name: "Categories & Spaces",
    description: "Manage categories, house types, room types, and architectural space templates.",
    permissions: [
      PERMISSION_METADATA["categories:read"],
      PERMISSION_METADATA["categories:manage"],
      PERMISSION_METADATA["spaces:read"],
      PERMISSION_METADATA["spaces:manage"],
      PERMISSION_METADATA["spaces:hard_delete"],
    ],
  },
  {
    id: "pricing",
    name: "Pricing & Margins",
    description: "Cost prices, purchase tax percentages, and internal margin oversight.",
    permissions: [PERMISSION_METADATA["pricing:view_cost"]],
  },
  {
    id: "dealers",
    name: "Dealer Management",
    description: "Manage dealer directory, discount allocation limits, and channel performance.",
    permissions: [
      PERMISSION_METADATA["dealers:read"],
      PERMISSION_METADATA["dealers:manage"],
    ],
  },
  {
    id: "quotations",
    name: "Quotation Management",
    description: "Generate, edit, assign, approve, and track proposal lifecycles.",
    permissions: [
      PERMISSION_METADATA["quotations:read_all"],
      PERMISSION_METADATA["quotations:create"],
      PERMISSION_METADATA["quotations:edit_all"],
      PERMISSION_METADATA["quotations:delete"],
      PERMISSION_METADATA["quotations:assign_dealer"],
      PERMISSION_METADATA["quotations:transition"],
    ],
  },
  {
    id: "company",
    name: "Company Settings",
    description: "Company contact information, branding logos, and quotation printing defaults.",
    permissions: [
      PERMISSION_METADATA["company:read"],
      PERMISSION_METADATA["company:edit"],
    ],
  },
  {
    id: "oversight",
    name: "System Oversight & Security",
    description: "Audit trail monitoring and administrative account management.",
    permissions: [
      PERMISSION_METADATA["activity:view"],
      PERMISSION_METADATA["admins:read"],
      PERMISSION_METADATA["admins:manage"],
    ],
  },
];

export const PERMISSION_PRESETS: {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}[] = [
  {
    id: "full_safe",
    name: "Standard Administrator (Full Safe)",
    description: "Grants all 20 standard administrative permissions without Super Admin exclusives.",
    permissions: Array.from(ADMIN_PERMISSIONS),
  },
  {
    id: "catalog_manager",
    name: "Catalog & Spaces Manager",
    description: "Manage products, categories, house types, and room types.",
    permissions: [
      "catalog:read",
      "catalog:create",
      "catalog:edit",
      "catalog:delete",
      "categories:read",
      "categories:manage",
      "spaces:read",
      "spaces:manage",
    ],
  },
  {
    id: "sales_ops",
    name: "Sales & Proposals Operations",
    description: "Create, edit, and transition quotations, manage dealers, view costs.",
    permissions: [
      "quotations:read_all",
      "quotations:create",
      "quotations:edit_all",
      "quotations:assign_dealer",
      "quotations:transition",
      "dealers:read",
      "dealers:manage",
      "catalog:read",
      "pricing:view_cost",
    ],
  },
  {
    id: "view_only",
    name: "Read-Only Auditor",
    description: "View-only access across catalog, spaces, dealers, quotations, company, and admins.",
    permissions: [
      "catalog:read",
      "categories:read",
      "spaces:read",
      "dealers:read",
      "quotations:read_all",
      "company:read",
      "admins:read",
    ],
  },
];

