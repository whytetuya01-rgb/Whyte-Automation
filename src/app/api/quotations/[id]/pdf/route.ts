import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationDelivery, QuotationDeliveryFile } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { canViewQuotation } from "@/lib/quotationAccess";
import { loadRevisionPdf } from "@/lib/quotationRevisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET — Returns the official frozen PDF binary for a quotation if one exists (from its revision storage or delivery history).
 * This ensures 100% deterministic, byte-identical PDF downloads across any client device (iOS Safari, Android Chrome, Desktop).
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      await connectMongoDB();

      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy quotationNumber status revision").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");

      if (!canViewQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
      }

      // 1. Check revision history for current revision PDF (stored via mark-sent or revision issuance)
      const currentRev = Number((quotation as any).revision || 1);
      const revisionPdf = await loadRevisionPdf(quotationId, currentRev);
      if (revisionPdf && revisionPdf.data) {
        const filename = revisionPdf.filename || `${quotation.quotationNumber || `Quotation-${quotationId}`}.pdf`;
        return new Response(new Uint8Array(revisionPdf.data), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(revisionPdf.data.length),
            "Cache-Control": "private, max-age=3600",
            "X-Quotation-Source": "frozen-revision",
            "X-Revision-Sha256": revisionPdf.sha256,
          },
        });
      }

      // 2. Check delivery history for the most recent sent/delivered PDF
      const latestDelivery = await QuotationDelivery.findOne({ quotationId })
        .sort({ createdAt: -1 })
        .lean();

      if (latestDelivery) {
        const file = await QuotationDeliveryFile.findById(latestDelivery._id).lean();
        if (file && file.data) {
          const filename = latestDelivery.attachmentName || `${quotation.quotationNumber || `Quotation-${quotationId}`}.pdf`;
          return new Response(new Uint8Array(file.data), {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Content-Length": String(file.data.length),
              "Cache-Control": "private, max-age=3600",
              "X-Quotation-Source": "frozen-delivery",
              "X-Quotation-Delivery-Id": String(latestDelivery._id),
            },
          });
        }
      }

      throw new ApiError("NOT_FOUND", "No frozen PDF available for this quotation.");
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/pdf" });
  }
}
