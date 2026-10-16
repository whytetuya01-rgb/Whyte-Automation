import { withPermission, withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import {
  PERMISSION_MODULE_GROUPS,
  PERMISSION_PRESETS,
} from "@/lib/permissions";
import { getAllRolesMetadata, createCustomRole } from "@/lib/roleService";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Role key must be at least 2 characters.")
    .max(50, "Role key cannot exceed 50 characters.")
    .regex(/^[a-z0-9_-]+$/, "Role key must contain only lowercase letters, numbers, hyphens, and underscores."),
  name: z
    .string()
    .trim()
    .min(2, "Role name must be at least 2 characters.")
    .max(60, "Role name cannot exceed 60 characters."),
  description: z.string().trim().max(500).optional().default(""),
  badge: z.string().trim().max(30).optional(),
  permissions: z.array(z.string()).default([]),
});

/**
 * GET /api/admin/roles
 * Returns role metadata and centralized permission configuration.
 * - Full platform permission matrix & presets are strictly restricted to super_admin.
 * - Approved read-only exception: Company Admins (admin / company_owner) may read role metadata
 *   strictly to populate company user assignment, with platform configuration stripped.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, companyId }) => {
      const isSuperAdmin = role === "super_admin";
      const isManager = role === "admin" || role === "company_owner";

      if (!isSuperAdmin && !isManager) {
        throw new ApiError("FORBIDDEN", "Only Super Admin may access global role definitions.");
      }

      const roles = await getAllRolesMetadata(companyId);

      const totalAccounts = roles.reduce((sum, r) => sum + r.userCount, 0);
      const activeAccounts = roles.reduce((sum, r) => sum + r.activeUserCount, 0);

      // Platform permission configuration and presets are Super Admin-exclusive
      return apiSuccess({
        roles,
        ...(isSuperAdmin
          ? {
              modules: PERMISSION_MODULE_GROUPS,
              presets: PERMISSION_PRESETS,
            }
          : {}),
        stats: {
          totalAccounts,
          activeAccounts,
        },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/roles" });
  }
}

/**
 * POST /api/admin/roles
 * Creates a brand new custom role.
 * Guarded server-side by `admins:manage` and strictly restricted to Super Admin.
 */
export async function POST(req: Request) {
  try {
    // Role definitions are platform-managed: Super Admin only, acting as a
    // company. Not `withPermission("admins:manage", ...)` because the company
    // is taken from the act-as context, not from a permission check.
    return await withSession(async ({ role, companyId }) => {
      if (role !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin may create role definitions.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "A company context is required to create a custom role.");
      }

      const body = await req.json();
      const parsed = createRoleSchema.safeParse(body);
      if (!parsed.success) {
        return handleApiError(parsed.error, { logPrefix: "POST /api/admin/roles" });
      }

      const created = await createCustomRole(parsed.data, companyId);

      return apiSuccess(created, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/roles" });
  }
}
