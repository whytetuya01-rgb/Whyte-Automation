import { apiSuccess, handleApiError } from "@/lib/api-response";
import { getRegistration } from "@/lib/companyReview";
import { parseCompanyId, requireReviewer } from "@/lib/companyReviewRoute";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/platform/company-registrations/[id] — full registration details. Super Admin only. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireReviewer();
    const { id } = await context.params;
    return apiSuccess(await getRegistration(parseCompanyId(id)));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/platform/company-registrations/[id]" });
  }
}
