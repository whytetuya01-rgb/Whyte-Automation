import { apiSuccess, handleApiError } from "@/lib/api-response";
import { listRegistrations, reviewTabSchema } from "@/lib/companyReview";
import { requireReviewer } from "@/lib/companyReviewRoute";
import { ApiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/** GET /api/platform/company-registrations?status=pending_review|approved|rejected — Super Admin only. */
export async function GET(request: Request) {
  try {
    await requireReviewer();
    const raw = new URL(request.url).searchParams.get("status") ?? "pending_review";
    const tab = reviewTabSchema.safeParse(raw);
    if (!tab.success) throw new ApiError("VALIDATION_ERROR", "status must be pending_review, approved or rejected.", { field: "status" });
    return apiSuccess(await listRegistrations(tab.data));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/platform/company-registrations" });
  }
}
