import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { quotationHasProducts } from "@/lib/quotationProducts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/mark-sent
 * Idempotently transitions a quotation from "draft" to "sent" on first PDF download, share, or print.
 *
 * Rules:
 * - If status is "draft": transitions to "sent", sets sentAt = Date.now(), sentBy = userId.
 * - If status is already "sent", "approved", "rejected", or "delivered": no-op, returns existing status.
 * - Verifies caller ownership (dealer owns quotation, or assigned sales, or admin).
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const userId = Number((session.user as any).id);
    const role = (session.user as { role?: string }).role;

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();
    const quotation = await Quotation.findById(quotationId);
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    // Authorization check: Dealers can only mark their own quotations as sent
    if (!canModifyQuotation(role, userId, quotation)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to update this quotation.");
    }

    // Idempotent check: only draft transitions to sent
    if (quotation.status === "draft") {
      if (!(await quotationHasProducts(quotationId))) {
        throw new ApiError(
          "CONFLICT",
          "Add at least one product to this quotation before it can be sent."
        );
      }
      quotation.status = "sent";
      quotation.sentAt = new Date();
      quotation.sentBy = userId;
      await quotation.save();
      await recordQuotationEvent({
        quotationId,
        action: "status_changed",
        performedBy: userId,
        previousValue: { status: "draft" },
        newValue: { status: "sent" },
      });
    }

    return apiSuccess({
      id: quotation._id,
      status: quotation.status,
      sentAt: quotation.sentAt,
      sentBy: quotation.sentBy,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/mark-sent" });
  }
}
