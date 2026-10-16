import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { resetRoleToDefaults } from "@/lib/roleService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * POST /api/admin/roles/[key]/reset
 * Resets a system role (admin or dealer) back to standard default permissions
 * FOR THIS COMPANY (removes that company's own override, see `resetRoleToDefaults`).
 * Restricted to a Super Admin acting as the company.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role: callerRole, companyId }) => {
      if (callerRole !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin may reset role permissions to defaults.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "A company context is required to reset role permissions.");
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

      const resetRole = await resetRoleToDefaults(normalizedKey, companyId);

      return apiSuccess(resetRole);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/roles/[key]/reset" });
  }
}
