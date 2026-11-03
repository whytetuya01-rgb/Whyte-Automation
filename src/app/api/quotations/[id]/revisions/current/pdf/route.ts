import { connectMongoDB } from "@/lib/mongodb";
import { DELIVERY_MAX_PDF_BYTES, Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { attachRevisionPdf } from "@/lib/quotationRevisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/revisions/current/pdf (multipart: pdf)
 *
 * Stores the PDF of the version that was just issued. Write-once: sending the same PDF again changes nothing, and a different PDF
 * for a version that already has one is refused (create a new revision instead).
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to update this quotation.");
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload with the PDF.", { field: "pdf" });
      }
      const file = form.get("pdf");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("FILE_REQUIRED", "The quotation PDF is required.", { field: "pdf" });
      if (file.size > DELIVERY_MAX_PDF_BYTES) throw new ApiError("FILE_TOO_LARGE", `The PDF must be ${DELIVERY_MAX_PDF_BYTES / (1024 * 1024)}MB or smaller.`, { field: "pdf" });
      return apiSuccess(await attachRevisionPdf(quotationId, Buffer.from(await file.arrayBuffer())));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/revisions/current/pdf" });
  }
}
