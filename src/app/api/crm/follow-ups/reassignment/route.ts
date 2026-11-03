import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canReassignFollowUps, findOrphanedFollowUps } from "@/lib/followUpReassignment";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/follow-ups/reassignment            the open follow-ups whose owner can no longer own them (deactivated, or no
 *                                                  longer allowed to manage leads), grouped by that person, plus the follow-ups
 * GET /api/crm/follow-ups/reassignment?summary=1  just the counts, for the notice on the Follow-ups screen
 *
 * Only people who can manage users and leads (they are the ones who deactivate people) may review them. Anyone else gets an
 * empty summary, never the list, so the notice simply does not appear for them.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:read")) throw new ApiError("FORBIDDEN", "You do not have permission to view follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      const summaryOnly = new URL(req.url).searchParams.get("summary") === "1";
      const allowed = canReassignFollowUps(role, permissions);

      if (!allowed) {
        if (summaryOnly) return apiSuccess({ canReassign: false, totals: { tasks: 0, owners: 0 } });
        throw new ApiError("FORBIDDEN", "Only people who can manage users and leads can review and reassign follow-ups.");
      }
      const report = await findOrphanedFollowUps(companyId, { listTasks: !summaryOnly });
      return apiSuccess(summaryOnly ? { canReassign: true, totals: report.totals, truncated: report.truncated } : { canReassign: true, ...report });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/follow-ups/reassignment" });
  }
}
