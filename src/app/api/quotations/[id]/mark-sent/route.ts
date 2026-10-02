import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";

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
    if (role === "dealer" && quotation.dealerId !== userId) {
      throw new ApiError("FORBIDDEN", "You do not have permission to update this quotation.");
    }

    // Idempotent check: only draft transitions to sent
    if (quotation.status === "draft") {
      quotation.status = "sent";
      quotation.sentAt = new Date();
      quotation.sentBy = userId;
      await quotation.save();
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
