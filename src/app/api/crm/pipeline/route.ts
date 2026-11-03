import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseSearchQueryParam, parseIntQueryParam, parseStringQueryParam } from "@/lib/validation/common";
import { getPipelineBoardData } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/pipeline — Opportunity Kanban board data.
 * Computes stage values, opportunity cards, stage ageing, and quotation totals.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:read") && !hasPermission(role, permissions, "leads:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view the CRM pipeline.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { searchParams } = new URL(req.url);
      const search = parseSearchQueryParam(searchParams, "search");
      const salesId = parseIntQueryParam(searchParams, "assignedSalesId");
      const dealerId = parseIntQueryParam(searchParams, "dealerId");
      const tag = parseStringQueryParam(searchParams, "tag", { max: 60 });

      const stages = await getPipelineBoardData(
        companyId,
        { role, userId },
        {
          search: search || undefined,
          assignedSalesId: salesId || undefined,
          dealerId: dealerId || undefined,
          tag: tag || undefined,
        }
      );

      return apiSuccess(stages);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/pipeline" });
  }
}
