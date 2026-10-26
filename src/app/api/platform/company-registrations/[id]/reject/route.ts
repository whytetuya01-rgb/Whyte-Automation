import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { rejectBodySchema, rejectCompany } from "@/lib/companyReview";
import { parseCompanyId, requireReviewer } from "@/lib/companyReviewRoute";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/platform/company-registrations/[id]/reject — Super Admin only.
 * Body (optional): { note?: string (internal, never emailed), notifyOwner?: boolean }.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const reviewer = await requireReviewer();
    const { id } = await context.params;
    const raw = await request.text();
    const body = rejectBodySchema.parse(raw.trim() ? await readJsonBody(new Request(request.url, { method: "POST", body: raw, headers: { "content-type": "application/json" } })) : {});
    return apiSuccess(await rejectCompany(parseCompanyId(id), reviewer, body));
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/platform/company-registrations/[id]/reject" });
  }
}
