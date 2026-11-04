import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { quotationHasProducts } from "@/lib/quotationProducts";
import { syncLeadWithQuotation } from "@/lib/crmService";
import { assertStorablePdf, attachRevisionPdf, issueRevision } from "@/lib/quotationRevisionService";
import { withRequiredTransaction } from "@/lib/transaction";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** The PDF sent with the request (multipart field "pdf"), or null when there is none. */
async function pdfFrom(req: Request): Promise<Buffer | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) return null;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "The upload could not be read. Try again.", { field: "pdf" });
  }
  const file = form.get("pdf");
  if (!(file instanceof File) || file.size === 0) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  assertStorablePdf(buffer);
  return buffer;
}

/**
 * POST /api/quotations/[id]/mark-sent (multipart: pdf)
 *
 * Issues a draft quotation: it becomes "sent" and its current revision is frozen TOGETHER WITH ITS PDF, in one transaction, so a
 * quotation can never be "sent" without the PDF of what was sent. The PDF is the one the person just downloaded or printed (the
 * Proposal Preview builds it); without it a draft is refused and stays a draft.
 *
 * - Already issued: nothing changes; a PDF sent along is kept if the current revision has none yet (stored once, never replaced).
 * - Verifies caller ownership (dealer owns quotation, or assigned sales, or admin with edit_all permission).
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const { id } = await context.params;
      const quotationId = parseQuotationId(id);
      const pdf = await pdfFrom(req);

      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId);
      if (!quotation) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }

      // Authorization check: Dealers can only mark their own quotations as sent
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to update this quotation.");
      }

      if (quotation.status === "draft") {
        if (!pdf) {
          throw new ApiError("FILE_REQUIRED", "A quotation is marked sent together with its PDF. Use Download PDF, Print or Send on the Proposal Preview.", { field: "pdf", details: { reason: "PDF_REQUIRED" } });
        }
        if (!(await quotationHasProducts(quotationId))) {
          throw new ApiError("CONFLICT", "Add at least one product to this quotation before it can be sent.");
        }
        // Sent, frozen and its PDF kept: all together, or nothing. The quotation is read again inside the transaction, so a retried
        // attempt (MongoDB retries transient conflicts) starts from what is really stored, never from an earlier attempt's copy.
        await withRequiredTransaction(async (session) => {
          const current = await Quotation.findById(quotationId).session(session ?? null);
          if (!current) throw new ApiError("NOT_FOUND", "Quotation not found.");
          if (current.status !== "draft") return; // issued by someone else a moment ago: nothing to do
          current.status = "sent";
          current.sentAt = new Date();
          current.sentBy = userId;
          await current.save(session ? { session } : {});
          await issueRevision(current, { userId, session });
          await attachRevisionPdf(quotationId, pdf, session);
        });
        const issued = await Quotation.findById(quotationId).select("status sentAt sentBy revision");
        if (issued) {
          quotation.status = issued.status;
          quotation.sentAt = issued.sentAt;
          quotation.sentBy = issued.sentBy;
        }
        await recordQuotationEvent({
          quotationId,
          action: "status_changed",
          performedBy: userId,
          previousValue: { status: "draft" },
          newValue: { status: "sent" },
        });
        await syncLeadWithQuotation({ leadId: quotation.leadId, quotationId, quotationNumber: quotation.quotationNumber, event: "sent", userId });
      } else if (pdf) {
        // Already issued: keep this PDF if the current revision has none yet; one already stored is never replaced.
        await attachRevisionPdf(quotationId, pdf).catch((error: unknown) => {
          if (error instanceof ApiError && (error.details as { reason?: string } | undefined)?.reason === "PDF_ALREADY_STORED") return;
          throw error;
        });
      }

      return apiSuccess({
        id: quotation._id,
        status: quotation.status,
        sentAt: quotation.sentAt,
        sentBy: quotation.sentBy,
        revision: quotation.revision ?? 1,
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/mark-sent" });
  }
}
