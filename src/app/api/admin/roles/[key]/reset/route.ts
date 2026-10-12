import { requirePermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { resetRoleToDefaults } from "@/lib/roleService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * POST /api/admin/roles/[key]/reset
 * Resets a system role (admin or dealer) back to standard default permissions.
 * Guarded by `admins:manage` and strictly restricted to Super Admin.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role?.trim().toLowerCase();

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may reset role permissions to defaults.");
    }

    const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
    const rawKey = resolvedParams?.key;
    if (!rawKey) {
      throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
    }
    const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

    if (normalizedKey !== "admin" && normalizedKey !== "dealer") {
      throw new ApiError("VALIDATION_ERROR", "Only Admin and Dealer system roles can be reset to defaults.");
    }

    const resetRole = await resetRoleToDefaults(normalizedKey);

    return apiSuccess(resetRole);
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/roles/[key]/reset" });
  }
}
