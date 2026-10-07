import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationAuditEvent } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { canViewQuotation } from "@/lib/quotationAccess";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/quotations/[id]/activity
 * Read-only audit trail, oldest first. Visible to whoever may view the quotation.
 * There is deliberately no POST/PATCH/DELETE: audit events are append-only and are
 * only ever written by the server as a side effect of quotation operations.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as { id?: string }).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();
    const quotation = await Quotation.findById(quotationId).select("_id dealerId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (!canViewQuotation(role, userId, quotation)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
    }

    const events = await QuotationAuditEvent.find({ quotationId }).sort({ performedOn: 1, _id: 1 }).lean();

    return apiSuccess(
      events.map((event) => ({
        id: event._id,
        action: event.action,
        performedByName: event.performedByName ?? null,
        performedOn: event.performedOn.toISOString(),
        previousValue: event.previousValue ?? null,
        newValue: event.newValue ?? null,
        metadata: event.metadata ?? null,
      }))
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/activity" });
  }
}
