import { apiSuccess, handleApiError } from "@/lib/api-response";
import { resendDecisionEmail } from "@/lib/companyReview";
import { parseCompanyId, requireReviewer } from "@/lib/companyReviewRoute";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/platform/company-registrations/[id]/resend-email — retries a failed decision email. Super Admin only. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireReviewer();
    const { id } = await context.params;
    return apiSuccess(await resendDecisionEmail(parseCompanyId(id)));
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/platform/company-registrations/[id]/resend-email" });
  }
}
