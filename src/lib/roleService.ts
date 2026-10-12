import { connectMongoDB } from "@/lib/mongodb";
import { RoleDefinition } from "@/models/RoleDefinition";
import { AdminUser } from "@/models/AdminUser";
import {
  ALL_PERMISSIONS,
  ADMIN_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  isValidPermission,
  type Permission,
} from "@/lib/permissions";
import { invalidateAllSessionActors } from "@/lib/sessionGuard";

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

export function invalidateRoleCache(key?: string): void {
  if (key) {
    roleCache.delete(key.trim().toLowerCase());
  } else {
    roleCache.clear();
  }
}

/**
 * Returns the effective permissions for a role key.
 *
 * Rules:
 * - `super_admin`: all 23 permissions, immutable.
 * - `admin`: DB custom permissions if customized, else ADMIN_DEFAULT_PERMISSIONS.
 * - `dealer`: DB custom permissions if customized, else DEALER_DEFAULT_PERMISSIONS.
 * - `configurable_admin`: individual user permissions (handled at user level, returns []).
 * - custom roles: DB permissions.
 *
 * Always strips SUPER_ADMIN_EXCLUSIVE_PERMISSIONS for non-super_admin roles.
 */
export async function getRolePermissions(roleKey: string): Promise<Permission[]> {
  if (!roleKey) return [];
  const normalized = roleKey.trim().toLowerCase();

  if (normalized === "super_admin") {
    return Array.from(SUPER_ADMIN_PERMISSIONS);
  }
  if (normalized === "configurable_admin" || normalized === "sales") {
    return [];
  }

  const now = Date.now();
  const cached = roleCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  try {
    await connectMongoDB();
    const doc = await RoleDefinition.findOne({ key: normalized }).lean();

    let perms: Permission[];

    if (normalized === "admin") {
      if (doc && doc.isCustomized && Array.isArray(doc.permissions)) {
        perms = doc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        );
      } else {
        perms = Array.from(ADMIN_DEFAULT_PERMISSIONS);
      }
    } else if (normalized === "dealer") {
      if (doc && doc.isCustomized && Array.isArray(doc.permissions)) {
        perms = doc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        );
      } else {
        perms = Array.from(DEALER_DEFAULT_PERMISSIONS);
      }
    } else if (doc && Array.isArray(doc.permissions)) {
      perms = doc.permissions.filter(
        (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
      );
    } else {
      perms = [];
    }

    roleCache.set(normalized, {
      permissions: perms,
      isCustomized: Boolean(doc?.isCustomized),
      expiresAt: now + ROLE_CACHE_TTL_MS,
    });

    return perms;
  } catch (error) {
    console.error(`[roleService] Error fetching permissions for role ${roleKey}:`, error);
    // Fallback to defaults on DB error
    if (normalized === "admin") return Array.from(ADMIN_DEFAULT_PERMISSIONS);
    if (normalized === "dealer") return Array.from(DEALER_DEFAULT_PERMISSIONS);
    return [];
  }
}

/**
 * Returns full metadata for all roles in the system.
 */
export async function getAllRolesMetadata(): Promise<RoleListItem[]> {
  await connectMongoDB();

  // Aggregate user counts by role
  const userCountAgg = await AdminUser.aggregate<{
    _id: string;
    total: number;
    active: number;
  }>([
    {
      $group: {
        _id: "$role",
        total: { $sum: 1 },
        active: {
          $sum: {
            $cond: [{ $eq: ["$isActive", false] }, 0, 1],
          },
        },
      },
    },
  ]);

  const userStats = new Map<string, { total: number; active: number }>();
  for (const item of userCountAgg) {
    if (item._id) {
      userStats.set(item._id.trim().toLowerCase(), { total: item.total, active: item.active });
    }
  }

  // Load custom role definitions and customized system role overrides from MongoDB
  const roleDocs = await RoleDefinition.find({}).lean();
  const roleDocsMap = new Map<string, typeof roleDocs[number]>();
  for (const doc of roleDocs) {
    if (doc.key) {
      roleDocsMap.set(doc.key.trim().toLowerCase(), doc);
    }
  }

  const adminDoc = roleDocsMap.get("admin");
  const dealerDoc = roleDocsMap.get("dealer");

  const adminPermissions =
    adminDoc && adminDoc.isCustomized && Array.isArray(adminDoc.permissions)
      ? adminDoc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        )
      : Array.from(ADMIN_DEFAULT_PERMISSIONS);

  const dealerPermissions =
    dealerDoc && dealerDoc.isCustomized && Array.isArray(dealerDoc.permissions)
      ? dealerDoc.permissions.filter(
          (p): p is Permission => isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)
        )
      : Array.from(DEALER_DEFAULT_PERMISSIONS);

  const superAdminStats = userStats.get("super_admin") || { total: 0, active: 0 };
  const adminStats = userStats.get("admin") || { total: 0, active: 0 };
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

  // Append custom roles
  const customRoleDocs = roleDocs.filter((d) => !d.isSystem);
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
 * Saves permission configuration for an existing system role (admin or dealer) or a custom role.
 */
export async function saveRolePermissions(
  key: string,
  permissions: string[],
  metadata?: { name?: string; description?: string; badge?: string }
): Promise<RoleListItem | null> {
  const normalizedKey = key.trim().toLowerCase();

  if (normalizedKey === "super_admin") {
    throw new Error("Super Administrator permissions are immutable and cannot be modified.");
  }
  if (normalizedKey === "configurable_admin") {
    throw new Error("Configurable Administrator permissions are assigned on individual user profiles.");
  }

  await connectMongoDB();

  // Validate and sanitize permissions
  const sanitized = permissions.filter((p): p is Permission => {
    return isValidPermission(p) && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p);
  });

  const isSystemRole = normalizedKey === "admin" || normalizedKey === "dealer";

  const updateData: Record<string, unknown> = {
    permissions: sanitized,
    isCustomized: true,
    isSystem: isSystemRole,
  };

  if (metadata?.name?.trim()) updateData.name = metadata.name.trim();
  if (metadata?.description !== undefined) updateData.description = metadata.description.trim();
  if (metadata?.badge !== undefined) updateData.badge = metadata.badge?.trim() || null;

  // Default names if upserting admin or dealer for the first time
  if (isSystemRole && !updateData.name) {
    updateData.name = normalizedKey === "admin" ? "Administrator" : "Dealer";
  }

  await RoleDefinition.findOneAndUpdate(
    { key: normalizedKey },
    { $set: updateData },
    { upsert: true, returnDocument: "after", new: true, setDefaultsOnInsert: true }
  );

  // Invalidate in-memory caches immediately
  invalidateRoleCache(normalizedKey);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata();
  return allRoles.find((r) => r.key === normalizedKey) || null;
}

/**
 * Resets a system role (admin or dealer) back to default permissions.
 */
export async function resetRoleToDefaults(key: string): Promise<RoleListItem | null> {
  const normalizedKey = key.trim().toLowerCase();

  if (normalizedKey !== "admin" && normalizedKey !== "dealer") {
    throw new Error("Only Admin and Dealer system roles can be reset to defaults.");
  }

  await connectMongoDB();

  const defaultPerms =
    normalizedKey === "admin"
      ? Array.from(ADMIN_DEFAULT_PERMISSIONS)
      : Array.from(DEALER_DEFAULT_PERMISSIONS);

  await RoleDefinition.findOneAndUpdate(
    { key: normalizedKey },
    {
      $set: {
        permissions: defaultPerms,
        isCustomized: false,
        isSystem: true,
      },
    },
    { upsert: true, returnDocument: "after", new: true }
  );

  invalidateRoleCache(normalizedKey);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata();
  return allRoles.find((r) => r.key === normalizedKey) || null;
}

/**
 * Creates a brand new custom role.
 */
export async function createCustomRole(data: {
  key: string;
  name: string;
  description?: string;
  badge?: string;
  permissions: string[];
}): Promise<RoleListItem> {
  const normalizedKey = data.key.toLowerCase().trim();

  // Validate key
  if (!normalizedKey || normalizedKey.length < 2 || normalizedKey.length > 50) {
    throw new Error("Role key must be between 2 and 50 characters.");
  }
  if (!/^[a-z0-9_-]+$/.test(normalizedKey)) {
    throw new Error("Role key may only contain lowercase letters, numbers, hyphens, and underscores.");
  }

  const protectedKeys = new Set(["super_admin", "admin", "dealer", "configurable_admin", "sales"]);
  if (protectedKeys.has(normalizedKey)) {
    throw new Error(`Role key '${normalizedKey}' is reserved and cannot be created.`);
  }

  if (!data.name || data.name.trim().length < 2 || data.name.trim().length > 60) {
    throw new Error("Role name must be between 2 and 60 characters.");
  }

  await connectMongoDB();

  const existing = await RoleDefinition.exists({ key: normalizedKey });
  if (existing) {
    throw new Error(`A role with key '${normalizedKey}' already exists.`);
  }

  // Validate and sanitize permissions
  for (const p of data.permissions) {
    if (!isValidPermission(p)) {
      throw new Error(`Unknown permission: '${p}'.`);
    }
    if (SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)) {
      throw new Error(`Permission '${p}' is Super Admin-exclusive and cannot be assigned to custom roles.`);
    }
  }

  const sanitized = Array.from(new Set(data.permissions as Permission[]));

  const newDoc = new RoleDefinition({
    key: normalizedKey,
    name: data.name.trim(),
    description: data.description?.trim() || "",
    badge: data.badge?.trim() || "Custom Role",
    isSystem: false,
    permissions: sanitized,
    isCustomized: true,
  });

  await newDoc.save();

  invalidateRoleCache(normalizedKey);
  invalidateAllSessionActors();

  const allRoles = await getAllRolesMetadata();
  const created = allRoles.find((r) => r.key === normalizedKey);
  if (!created) {
    throw new Error("Failed to retrieve created role metadata.");
  }
  return created;
}

/**
 * Deletes a custom role if no users are currently assigned to it.
 */
export async function deleteCustomRole(key: string): Promise<void> {
  const normalizedKey = key.trim().toLowerCase();
  const protectedKeys = new Set(["super_admin", "admin", "dealer", "configurable_admin", "sales"]);
  if (protectedKeys.has(normalizedKey)) {
    throw new Error(`System role '${normalizedKey}' cannot be deleted.`);
  }

  await connectMongoDB();

  const assignedUsersCount = await AdminUser.countDocuments({ role: normalizedKey });
  if (assignedUsersCount > 0) {
    throw new Error(
      `Cannot delete role '${normalizedKey}' because ${assignedUsersCount} user account(s) are currently assigned to it. Reassign or remove these users first.`
    );
  }

  await RoleDefinition.deleteOne({ key: normalizedKey, isSystem: false });

  invalidateRoleCache(normalizedKey);
  invalidateAllSessionActors();
}
