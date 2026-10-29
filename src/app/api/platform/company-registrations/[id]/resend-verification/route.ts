import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { getRegistration } from "@/lib/companyReview";
import { parseCompanyId, requireReviewer } from "@/lib/companyReviewRoute";
import { reissueVerification } from "@/lib/ownerEmailVerification";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/platform/company-registrations/[id]/resend-verification — emails the owner a new verification link. Super Admin only. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireReviewer();
    const companyId = parseCompanyId((await context.params).id);
    const outcome = await reissueVerification(companyId);
    if (outcome === "not_pending") throw new ApiError("CONFLICT", "This request is not waiting for email verification.");
    if (outcome === "limit") throw new ApiError("CONFLICT", "The verification email has already been sent the maximum number of times.");
    return apiSuccess(await getRegistration(companyId));
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/platform/company-registrations/[id]/resend-verification" });
  }
}
