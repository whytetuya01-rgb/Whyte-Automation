import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { listEligibleOwners } from "@/lib/followUpService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/follow-up-owners — the people a follow-up can be given to: active members of the caller's company who can
 * manage leads. Names and roles only. Dealers, Sales Executives and platform admins are never listed.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) throw new ApiError("FORBIDDEN", "You do not have permission to assign follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      return apiSuccess(await listEligibleOwners(companyId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/follow-up-owners" });
  }
}
