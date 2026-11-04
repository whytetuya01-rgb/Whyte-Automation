import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canViewQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { compareRevisions } from "@/lib/quotationRevisionService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const revisionParam = (params: URLSearchParams, name: "from" | "to") => {
  const raw = params.get(name);
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1 || value > 10_000) throw new ApiError("VALIDATION_ERROR", `Choose the revision to compare (${name}).`, { field: name });
  return value;
};

/**
 * GET /api/quotations/[id]/revisions/compare?from=1&to=2 — what changed between two issued revisions (products added, removed or
 * changed; quantities, prices, per-product discounts, rooms, GST, the Service & Integration charge and the final total), read only
 * from their frozen snapshots. Whoever may view the quotation may compare its revisions; nothing is changed.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      const params = new URL(req.url).searchParams;
      const from = revisionParam(params, "from");
      const to = revisionParam(params, "to");
      if (from === to) throw new ApiError("VALIDATION_ERROR", "Choose two different revisions to compare.", { field: "to" });
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canViewQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
      return apiSuccess(await compareRevisions(quotationId, from, to));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/revisions/compare" });
  }
}
