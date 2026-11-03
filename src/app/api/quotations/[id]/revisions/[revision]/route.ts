import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canViewQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { getRevision } from "@/lib/quotationRevisionService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; revision: string }> };

/** GET /api/quotations/[id]/revisions/[revision] — the frozen copy of one issued version (details, rooms, items, prices, totals). */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const params = await context.params;
      const quotationId = parseQuotationId(params.id);
      const number = Number(params.revision);
      if (!Number.isInteger(number) || number < 1) throw new ApiError("VALIDATION_ERROR", "That is not a revision number.", { field: "revision" });
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canViewQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
      const record = await getRevision(quotationId, number);
      return apiSuccess({ revision: record.revision, issuedAt: record.issuedAt, issuedByName: record.issuedByName, reason: record.reason, reconstructed: record.reconstructed, hasPdf: Boolean(record.pdf), snapshot: record.snapshot });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/revisions/[revision]" });
  }
}
