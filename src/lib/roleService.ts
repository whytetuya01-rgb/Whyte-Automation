import { connectMongoDB } from "@/lib/mongodb";
import { RoleDefinition } from "@/models/RoleDefinition";
import { AdminUser } from "@/models/AdminUser";
import {
  ALL_PERMISSIONS,
  ADMIN_DEFAULT_PERMISSIONS,
  SALES_EXECUTIVE_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  COMPANY_OWNER_PERMISSIONS,
  isValidPermission,
  type Permission,
} from "@/lib/permissions";
import { invalidateAllSessionActors } from "@/lib/sessionGuard";
import { runUnscoped } from "@/lib/tenant/context";
import { ApiError } from "@/lib/api-response";

const ROLE_KEY_PATTERN = /^[a-z0-9_-]{2,50}$/;

/** Keys of the calling company's own custom roles. Must run inside a tenant context (auto-scoped to that company). */
export async function getCompanyCustomRoleKeys(): Promise<string[]> {
  await connectMongoDB();
  const docs = await RoleDefinition.find({ isSystem: false }).select("key").lean();
  return docs.map((d) => d.key.trim().toLowerCase());
}

export interface RoleListItem {
  key: string;
  name: string;
  badge: string;
  type: "system_protected" | "system_customizable" | "configurable" | "custom";
  description: string;
  isEditable: boolean;
  isDeletable: boolean;
  isCustomized: boolean;
  permissionCount: number | string;
  permissions: Permission[];
  defaultPermissions?: Permission[];
  userCount: number;
  activeUserCount: number;
  createdAt?: string;
  updatedAt?: string;
}

// In-memory cache for role definitions
interface CachedRole {
  permissions: Permission[];
  isCustomized: boolean;
  expiresAt: number;
}

const roleCache = new Map<string, CachedRole>();
const ROLE_CACHE_TTL_MS = 30_000;

/**
 * Cache entries are keyed `${companyId}:${roleKey}` now that permissions are
 * per-company. Passing `companyId` clears exactly that company's entry;
 * passing only `key` clears every company's cached entry for that role key
 * (a same-named role, e.g. "admin", can be customized independently by many
 * companies, and a global system-template change — see `saveRolePermissions`
 * writing a `companyId: null` row — needs to invalidate all of them, not
 * just one).
 */
export function invalidateRoleCache(key?: string, companyId?: number | null): void {
  if (!key) {
    roleCache.clear();
    return;
  }
  const normalized = key.trim().toLowerCase();
  if (companyId !== undefined) {
    roleCache.delete(`${companyId}:${normalized}`);
    return;
  }
  const suffix = `:${normalized}`;
  for (const cacheKeyToCheck of Array.from(roleCache.keys())) {
    if (cacheKeyToCheck.endsWith(suffix)) roleCache.delete(cacheKeyToCheck);
  }
}

/**
 * Returns the effective permissions for a role key, within one company.
 *
 * Rules:
 * - `super_admin`: all 23 permissions, immutable. (No `companyId` — the
 *   platform role has none.)
 * - `admin` / `dealer`: that COMPANY's own customized `RoleDefinition`
 *   (`{ companyId, key, isCustomized: true }`) if it has one, else the
 *   global system template (`{ companyId: null, key }`), else the
 *   hardcoded `ADMIN_DEFAULT_PERMISSIONS`/`DEALER_DEFAULT_PERMISSIONS`.
 *   Every company can customize its own "admin"/"dealer" independently —
 *   the "admin" ROLE NAME is a shared, reserved system concept; its
 *   PERMISSION SET is per-company.
 * - `configurable_admin`: individual user permissions (handled at user level, returns []).
 * - custom roles: that company's own `RoleDefinition` DB permissions.
 *
 * Always strips SUPER_ADMIN_EXCLUSIVE_PERMISSIONS for non-super_admin roles.
 *
 * `companyId` is required for every role except `super_admin`/`configurable_admin`/`sales`
 * — this function is called from `sessionGuard.ts`'s `getSessionActor`, which
 * runs BEFORE any tenant context exists for the request (resolving the
 * company IS part of establishing that context), so its `RoleDefinition`
 * reads run via `runUnscoped("auth-lookup", ...)`, with `companyId` supplied
 * explicitly in the query filter instead of relying on ambient scoping.
 */
export async function getRolePermissions(roleKey: string, companyId: number | null): Promise<Permission[]> {
  if (!roleKey) return [];
  const normalized = roleKey.trim().toLowerCase();

  if (normalized === "super_admin") {
    return Array.from(SUPER_ADMIN_PERMISSIONS);
  }
  if (normalized === "company_owner") {
    return Array.from(COMPANY_OWNER_PERMISSIONS);
  }
  if (normalized === "configurable_admin" || normalized === "sales") {
    return [];
  }
  if (!companyId) {
    if (normalized === "admin") return Array.from(ADMIN_DEFAULT_PERMISSIONS);
    if (normalized === "sales_executive") return Array.from(SALES_EXECUTIVE_DEFAULT_PERMISSIONS);
    if (normalized === "dealer") return Array.from(DEALER_DEFAULT_PERMISSIONS);
    return [];
  }

  const cacheKey = `${companyId}:${normalized}`;
  const now = Date.now();
  const cached = roleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  try {
    await connectMongoDB();
    const doc = await runUnscoped("auth-lookup", async () => {
      const companyOverride = await RoleDefinition.findOne({ companyId, key: normalized, isCustomized: true }).lean();
      if (companyOverride) return companyOverride;
      return await RoleDefinition.findOne({ companyId: null, key: normalized }).lean();
    });

    let perms: Permission[];

    if (doc && Array.isArray(doc.permissions)) {
      perms = doc.permissions.filter(
        (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
      );
    } else if (normalized === "admin") {
      perms = Array.from(ADMIN_DEFAULT_PERMISSIONS);
    } else if (normalized === "sales_executive") {
      perms = Array.from(SALES_EXECUTIVE_DEFAULT_PERMISSIONS);
    } else if (normalized === "dealer") {
      perms = Array.from(DEALER_DEFAULT_PERMISSIONS);
    } else {
      perms = [];
    }

    roleCache.set(cacheKey, {
      permissions: perms,
      isCustomized: Boolean(doc?.isCustomized),
      expiresAt: now + ROLE_CACHE_TTL_MS,
    });

    return perms;
  } catch (error) {
    console.error(`[roleService] Error fetching permissions for role ${roleKey} (company ${companyId}):`, error);
    // Fallback to defaults on DB error
    if (normalized === "admin") return Array.from(ADMIN_DEFAULT_PERMISSIONS);
    if (normalized === "dealer") return Array.from(DEALER_DEFAULT_PERMISSIONS);
    return [];
  }
}

/**
 * Returns full metadata for all roles within one company.
 *
 * `companyId: null` (Super Admin without an act-as session) returns the
 * global system role templates with zero user counts — consistent with
 * "Super Admin sees no company business data by default": there is no
 * company's accounts to count.
 */
export async function getAllRolesMetadata(companyId: number | null): Promise<RoleListItem[]> {
  await connectMongoDB();

  // Aggregate user counts by role. Auto-scoped to `companyId` by the
  // tenant-scope plugin's own pre("aggregate") hook (see src/lib/tenant/plugin.ts)
  // — nothing here constructs that filter by hand.
  const userCountAgg =
    companyId === null
      ? []
      : await AdminUser.aggregate<{ _id: string; total: number; active: number }>([
          {
            $group: {
              _id: "$role",
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$isActive", false] }, 0, 1] } },
            },
          },
        ]);

  const userStats = new Map<string, { total: number; active: number }>();
  for (const item of userCountAgg) {
    if (item._id) {
      userStats.set(item._id.trim().toLowerCase(), { total: item.total, active: item.active });
    }
  }

  // RoleDefinition rows come from two places that a single scoped query can't
  // express at once (see the doc comment on `companyId` in
  // src/models/RoleDefinition.ts): the global system templates
  // (companyId: null — every company shares these as defaults) and, when a
  // company context is active, that company's own customized overrides and
  // custom roles. A company-specific "admin"/"dealer" override (isCustomized)
  // replaces the global template for display; everything else from the
  // system set (plus any key the company hasn't touched) still shows.
  const systemDocs = await runUnscoped("platform-admin", async () => await RoleDefinition.find({ companyId: null }).lean());
  const companyDocs = companyId === null ? [] : await RoleDefinition.find({ companyId }).lean();

  const roleDocsMap = new Map<string, (typeof systemDocs)[number]>();
  for (const doc of systemDocs) {
    if (doc.key) roleDocsMap.set(doc.key.trim().toLowerCase(), doc);
  }
  for (const doc of companyDocs) {
    if (doc.key && doc.isSystem && doc.isCustomized) {
      roleDocsMap.set(doc.key.trim().toLowerCase(), doc);
    }
  }

  const adminDoc = roleDocsMap.get("admin");
  const salesExecDoc = roleDocsMap.get("sales_executive");
  const dealerDoc = roleDocsMap.get("dealer");

  const adminPermissions =
    adminDoc && adminDoc.isCustomized && Array.isArray(adminDoc.permissions)
      ? adminDoc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        )
      : Array.from(ADMIN_DEFAULT_PERMISSIONS);

  const salesExecPermissions =
    salesExecDoc && salesExecDoc.isCustomized && Array.isArray(salesExecDoc.permissions)
      ? salesExecDoc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        )
      : Array.from(SALES_EXECUTIVE_DEFAULT_PERMISSIONS);

  const dealerPermissions =
    dealerDoc && dealerDoc.isCustomized && Array.isArray(dealerDoc.permissions)
      ? dealerDoc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        )
      : Array.from(DEALER_DEFAULT_PERMISSIONS);

  const superAdminStats = userStats.get("super_admin") || { total: 0, active: 0 };
  const adminStats = userStats.get("admin") || { total: 0, active: 0 };
  const salesExecStats = userStats.get("sales_executive") || { total: 0, active: 0 };
  const dealerStats = userStats.get("dealer") || { total: 0, active: 0 };
  const configStats = userStats.get("configurable_admin") || { total: 0, active: 0 };

  const rolesList: RoleListItem[] = [
    {
      key: "super_admin",
      name: "Super Administrator",
      badge: "Immutable Owner",
      type: "system_protected",
      description:
        "Full unrestricted platform owner with immutable authority over security, activity audit logs, and structural hard-deletes.",
      isEditable: false,
      isDeletable: false,
      isCustomized: false,
      permissionCount: ALL_PERMISSIONS.length,
      permissions: Array.from(SUPER_ADMIN_PERMISSIONS),
      userCount: superAdminStats.total,
      activeUserCount: superAdminStats.active,
    },
    {
      key: "admin",
      name: adminDoc?.name || "Administrator",
      badge: adminDoc?.badge || (adminDoc?.isCustomized ? "Customized System" : "System Standard"),
      type: "system_customizable",
      description:
        adminDoc?.description ||
        "Comprehensive administrative operational role across catalog, quotations, dealers, and company settings.",
      isEditable: true,
      isDeletable: false,
      isCustomized: Boolean(adminDoc?.isCustomized),
      permissionCount: adminPermissions.length,
      permissions: adminPermissions,
      defaultPermissions: Array.from(ADMIN_DEFAULT_PERMISSIONS),
      userCount: adminStats.total,
      activeUserCount: adminStats.active,
      updatedAt: adminDoc?.updatedAt ? new Date(adminDoc.updatedAt).toISOString() : undefined,
    },
    {
      key: "sales_executive",
      name: salesExecDoc?.name || "Sales Executive",
      badge: salesExecDoc?.badge || (salesExecDoc?.isCustomized ? "Customized Sales" : "Sales Representative"),
      type: "system_customizable",
      description:
        salesExecDoc?.description ||
        "Company-scoped sales representative restricted to assigned customers, proposals, and sales performance.",
      isEditable: true,
      isDeletable: false,
      isCustomized: Boolean(salesExecDoc?.isCustomized),
      permissionCount: salesExecPermissions.length,
      permissions: salesExecPermissions,
      defaultPermissions: Array.from(SALES_EXECUTIVE_DEFAULT_PERMISSIONS),
      userCount: salesExecStats.total,
      activeUserCount: salesExecStats.active,
      updatedAt: salesExecDoc?.updatedAt ? new Date(salesExecDoc.updatedAt).toISOString() : undefined,
    },
    {
      key: "dealer",
      name: dealerDoc?.name || "Dealer",
      badge: dealerDoc?.badge || (dealerDoc?.isCustomized ? "Customized Partner" : "Channel Partner"),
      type: "system_customizable",
      description:
        dealerDoc?.description ||
        "Authorized dealer partner account restricted to assigned proposals and catalog master views.",
      isEditable: true,
      isDeletable: false,
      isCustomized: Boolean(dealerDoc?.isCustomized),
      permissionCount: dealerPermissions.length,
      permissions: dealerPermissions,
      defaultPermissions: Array.from(DEALER_DEFAULT_PERMISSIONS),
      userCount: dealerStats.total,
      activeUserCount: dealerStats.active,
      updatedAt: dealerDoc?.updatedAt ? new Date(dealerDoc.updatedAt).toISOString() : undefined,
    },
    {
      key: "configurable_admin",
      name: "Configurable Administrator",
      badge: "Per-User Role",
      type: "configurable",
      description:
        "Granular administrator accounts with custom permissions assigned individually on each user profile.",
      isEditable: false,
      isDeletable: false,
      isCustomized: false,
      permissionCount: "Per-user assigned",
      permissions: [],
      userCount: configStats.total,
      activeUserCount: configStats.active,
    },
  ];

  // Append this company's own custom roles (never global — a custom role
  // always belongs to exactly one company).
  const customRoleDocs = companyDocs.filter((d) => !d.isSystem);
  for (const doc of customRoleDocs) {
    const normKey = doc.key.trim().toLowerCase();
    const stats = userStats.get(normKey) || { total: 0, active: 0 };
    const perms = (doc.permissions || []).filter(
      (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
    );

    rolesList.push({
      key: normKey,
      name: doc.name,
      badge: doc.badge || "Custom Role",
      type: "custom",
      description: doc.description || "Custom application role.",
      isEditable: true,
      isDeletable: true,
      isCustomized: true,
      permissionCount: perms.length,
      permissions: perms,
      userCount: stats.total,
      activeUserCount: stats.active,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
    });
  }

  return rolesList;
}

/**
 * Saves a COMPANY's own permission configuration for an existing system role
 * (admin or dealer) or one of its custom roles. Always writes a company-owned
 * row (`companyId` in the filter, never `null`) — this never touches the
 * global system template, so every company customizes its own "admin"/
 * "dealer" independently (see the doc comment on `getRolePermissions`).
 *
 * The filter (not a validate-hook stamp) is what makes this tenant-safe:
 * `findOneAndUpdate`'s document hooks don't run for upserts, but MongoDB's
 * own upsert semantics copy every equality field FROM the filter onto a
 * newly-inserted document — so `{ companyId, key }` in the filter is what
 * actually stamps `companyId` correctly on a brand-new override row.
 */
export async function saveRolePermissions(
  key: string,
  permissions: string[],
  companyId: number,
  metadata?: { name?: string; description?: string; badge?: string }
): Promise<RoleListItem | null> {
  const normalizedKey = key.trim().toLowerCase();

  if (normalizedKey === "super_admin") {
    throw new ApiError("FORBIDDEN", "Super Administrator permissions are immutable and cannot be modified.");
  }
  if (normalizedKey === "company_owner") {
    throw new ApiError("FORBIDDEN", "Company Owner permissions are immutable and cannot be modified.");
  }
  if (normalizedKey === "configurable_admin") {
    throw new ApiError("VALIDATION_ERROR", "Configurable Administrator permissions are assigned on individual user profiles.");
  }
  if (!ROLE_KEY_PATTERN.test(normalizedKey)) {
    throw new ApiError("VALIDATION_ERROR", "Role key must be 2-50 characters of lowercase letters, numbers, hyphens, and underscores.", { field: "key" });
  }

  await connectMongoDB();

  // Validate and sanitize permissions
  const sanitized = permissions.filter((p): p is Permission => {
    return isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p);
  });

  const isSystemRole =
    normalizedKey === "admin" || normalizedKey === "dealer" || normalizedKey === "sales_executive";

  const updateData: Record<string, unknown> = {
    permissions: sanitized,
    isCustomized: true,
    isSystem: isSystemRole,
  };

  if (metadata?.name?.trim()) updateData.name = metadata.name.trim();
  if (metadata?.description !== undefined) updateData.description = metadata.description.trim();
  if (metadata?.badge !== undefined) updateData.badge = metadata.badge?.trim() || null;

  // Default names if upserting system roles for the first time
  if (isSystemRole && !updateData.name) {
    updateData.name =
      normalizedKey === "admin"
        ? "Administrator"
        : normalizedKey === "sales_executive"
        ? "Sales Executive"
        : "Dealer";
  }

  // Filter is just `{ key }`, not `{ companyId, key }`: the tenant-scope
  // plugin's own pre-hook already ANDs a `{ companyId }` condition into
  // every query automatically (see src/lib/tenant/plugin.ts) — adding it
  // here too makes MongoDB see the same path matched twice across the
  // resulting `$and`, which upsert's "infer the new document's fields from
  // the filter" logic refuses to resolve (`NotSingleValueField`). Explicit
  // `$setOnInsert` is what actually, unambiguously stamps `companyId` on a
  // brand-new override row — it doesn't depend on upsert path-inference at all.
  // Only the system roles (admin, dealer) may be created on first save: a
  // company's first customization of them is what writes its override row.
  // Any other key must already be one of THIS company's custom roles — an
  // unknown key is never silently created here, since that would bypass the
  // validated creation flow (`createCustomRole`: name, key rules, uniqueness).
  const saved = await RoleDefinition.findOneAndUpdate(
    { key: normalizedKey },
    { $set: updateData, $setOnInsert: { companyId } },
    { upsert: isSystemRole, returnDocument: "after", new: true, setDefaultsOnInsert: true }
  );
  if (!saved) {
    throw new ApiError("NOT_FOUND", `Role '${normalizedKey}' does not exist for this company.`, { field: "key" });
  }

  // Invalidate in-memory caches immediately
  invalidateRoleCache(normalizedKey, companyId);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata(companyId);
  return allRoles.find((r) => r.key === normalizedKey) || null;
}

/**
 * Resets a system role (admin or dealer) back to default permissions.
 */
export async function resetRoleToDefaults(key: string, companyId: number): Promise<RoleListItem | null> {
  const normalizedKey = key.trim().toLowerCase();

  if (normalizedKey !== "admin" && normalizedKey !== "dealer" && normalizedKey !== "sales_executive") {
    throw new ApiError("VALIDATION_ERROR", "Only Admin, Sales Executive, and Dealer system roles can be reset to defaults.", { field: "key" });
  }

  await connectMongoDB();

  // Reverting to defaults means removing THIS company's override entirely —
  // it then falls back to the global system template automatically (see
  // `getAllRolesMetadata`'s merge logic), rather than writing a redundant
  // "isCustomized: false" row.
  await RoleDefinition.deleteOne({ companyId, key: normalizedKey });

  invalidateRoleCache(normalizedKey, companyId);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata(companyId);
  return allRoles.find((r) => r.key === normalizedKey) || null;
}

/**
 * Creates a brand new custom role.
 */
export async function createCustomRole(
  data: {
    key: string;
    name: string;
    description?: string;
    badge?: string;
    permissions: string[];
  },
  companyId: number
): Promise<RoleListItem> {
  const normalizedKey = data.key.toLowerCase().trim();

  // Validate key
  if (!normalizedKey || normalizedKey.length < 2 || normalizedKey.length > 50) {
    throw new ApiError("VALIDATION_ERROR", "Role key must be between 2 and 50 characters.", { field: "key" });
  }
  if (!/^[a-z0-9_-]+$/.test(normalizedKey)) {
    throw new ApiError("VALIDATION_ERROR", "Role key may only contain lowercase letters, numbers, hyphens, and underscores.", { field: "key" });
  }

  const protectedKeys = new Set(["super_admin", "company_owner", "admin", "dealer", "configurable_admin", "sales"]);
  if (protectedKeys.has(normalizedKey)) {
    throw new ApiError("VALIDATION_ERROR", `Role key '${normalizedKey}' is reserved and cannot be created.`, { field: "key" });
  }

  if (!data.name || data.name.trim().length < 2 || data.name.trim().length > 60) {
    throw new ApiError("VALIDATION_ERROR", "Role name must be between 2 and 60 characters.", { field: "name" });
  }

  await connectMongoDB();

  // Unique per company, not globally — see the compound index on RoleDefinition.
  const existing = await RoleDefinition.exists({ companyId, key: normalizedKey });
  if (existing) {
    throw new ApiError("DUPLICATE_RECORD", `A role with key '${normalizedKey}' already exists for this company.`, { field: "key" });
  }

  // Validate and sanitize permissions
  for (const p of data.permissions) {
    if (!isValidPermission(p)) {
      throw new ApiError("VALIDATION_ERROR", `Unknown permission: '${p}'.`, { field: "permissions" });
    }
    if (SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)) {
      throw new ApiError("VALIDATION_ERROR", `Permission '${p}' is Super Admin-exclusive and cannot be assigned to custom roles.`, { field: "permissions" });
    }
  }

  const sanitized = Array.from(new Set(data.permissions as Permission[]));

  const newDoc = new RoleDefinition({
    companyId,
    key: normalizedKey,
    name: data.name.trim(),
    description: data.description?.trim() || "",
    badge: data.badge?.trim() || "Custom Role",
    isSystem: false,
    permissions: sanitized,
    isCustomized: true,
  });

  await newDoc.save();

  invalidateRoleCache(normalizedKey, companyId);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata(companyId);
  const created = allRoles.find((r) => r.key === normalizedKey);
  if (!created) {
    throw new Error("Failed to retrieve created role metadata.");
  }
  return created;
}

/**
 * Deletes one company's custom role if no users are currently assigned to it.
 */
export async function deleteCustomRole(key: string, companyId: number): Promise<void> {
  const normalizedKey = key.trim().toLowerCase();
  const protectedKeys = new Set(["super_admin", "company_owner", "admin", "dealer", "configurable_admin", "sales"]);
  if (protectedKeys.has(normalizedKey)) {
    throw new ApiError("FORBIDDEN", `System role '${normalizedKey}' cannot be deleted.`);
  }

  await connectMongoDB();

  // Auto-scoped to this company by the tenant-scope plugin.
  const exists = await RoleDefinition.exists({ companyId, key: normalizedKey, isSystem: false });
  if (!exists) {
    throw new ApiError("NOT_FOUND", `Role '${normalizedKey}' does not exist for this company.`, { field: "key" });
  }

  const assignedUsersCount = await AdminUser.countDocuments({ role: normalizedKey });
  if (assignedUsersCount > 0) {
    throw new ApiError(
      "DEPENDENCY_EXISTS",
      `Cannot delete role '${normalizedKey}' because ${assignedUsersCount} user account(s) are currently assigned to it. Reassign or remove these users first.`
    );
  }

  await RoleDefinition.deleteOne({ companyId, key: normalizedKey, isSystem: false });

  invalidateRoleCache(normalizedKey, companyId);
  invalidateAllSessionActors();
}
