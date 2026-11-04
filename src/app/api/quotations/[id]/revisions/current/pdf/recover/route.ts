import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { recoverCurrentRevisionPdf } from "@/lib/quotationRevisionService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/revisions/current/pdf/recover — "Store PDF now" for the current issued revision when it has none:
 * the PDF of a successful email / WhatsApp send of that revision becomes its PDF (the exact document the client got). When
 * there was no such send, 404 with what to do instead (Download PDF on the Proposal Preview stores it).
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy status").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to update this quotation.");
      if (quotation.status === "draft") throw new ApiError("CONFLICT", "This revision has not been issued yet: send or download it first.");
      const result = await recoverCurrentRevisionPdf(quotationId);
      if (!result) {
        throw new ApiError("NOT_FOUND", "No email or WhatsApp send of this revision has a stored PDF. Open the Proposal Preview and click Download PDF to store it.", { details: { reason: "NO_SENT_PDF" } });
      }
      return apiSuccess(result);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/revisions/current/pdf/recover" });
  }
}
