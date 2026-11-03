import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, handleApiError } from "@/lib/api-response";
import { canViewQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { loadRevisionPdf } from "@/lib/quotationRevisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; revision: string }> };

/** GET /api/quotations/[id]/revisions/[revision]/pdf — the exact PDF that was issued for that version, byte for byte. */
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
      const file = await loadRevisionPdf(quotationId, number);
      if (!file) throw new ApiError("NOT_FOUND", "No PDF was stored for that revision.");
      return new Response(new Uint8Array(file.data), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Content-Length": String(file.data.length),
          "Cache-Control": "private, max-age=3600",
          "X-Revision-Sha256": file.sha256,
        },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/revisions/[revision]/pdf" });
  }
}
