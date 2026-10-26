import { apiSuccess, handleApiError } from "@/lib/api-response";
import { approveCompany } from "@/lib/companyReview";
import { parseCompanyId, requireReviewer } from "@/lib/companyReviewRoute";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/platform/company-registrations/[id]/approve — Super Admin only.
 * Idempotent: approving an already approved request returns it unchanged (`changed: false`) and sends nothing.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const reviewer = await requireReviewer();
    const { id } = await context.params;
    return apiSuccess(await approveCompany(parseCompanyId(id), reviewer));
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/platform/company-registrations/[id]/approve" });
  }
}
