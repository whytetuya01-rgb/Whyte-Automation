import { requirePermission } from "@/lib/api-auth";
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
 * Returns role metadata (including admin, dealer, configurable_admin, and custom roles),
 * user counts, and the centralized permission matrix.
 * Guarded server-side by `admins:read`.
 */
export async function GET() {
  try {
    await requirePermission("admins:read");

    const roles = await getAllRolesMetadata();

    const totalAccounts = roles.reduce((sum, r) => sum + r.userCount, 0);
    const activeAccounts = roles.reduce((sum, r) => sum + r.activeUserCount, 0);

    return apiSuccess({
      roles,
      modules: PERMISSION_MODULE_GROUPS,
      presets: PERMISSION_PRESETS,
      stats: {
        totalAccounts,
        activeAccounts,
      },
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
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role;

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may create custom roles.");
    }

    const body = await req.json();
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return handleApiError(parsed.error, { logPrefix: "POST /api/admin/roles" });
    }

    const created = await createCustomRole(parsed.data);

    return apiSuccess(created, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/roles" });
  }
}
