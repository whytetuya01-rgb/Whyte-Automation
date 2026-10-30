import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationDelivery } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { pushDeliveryEvent } from "@/lib/quotationDelivery";
import { deliveryDto } from "@/lib/quotationLinks";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> };

/**
 * POST { action: "revoke" } — switches off a delivery's secure view link (e.g. it was sent to the wrong person).
 * Revoking cannot be undone; send the quotation again for a new link. Only people who may modify the quotation can.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const params = await context.params;
      const quotationId = parseQuotationId(params.id);
      const deliveryId = typeof params.deliveryId === "string" && /^qd_[0-9a-f]{32}$/.test(params.deliveryId) ? params.deliveryId : null;
      if (!deliveryId) throw new ApiError("INVALID_ID", "Invalid delivery id.", { field: "deliveryId" });
      const body = (await readJsonBody(req)) as { action?: unknown } | null;
      if (body?.action !== "revoke") throw new ApiError("VALIDATION_ERROR", "Unknown link action.", { field: "action" });

      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to change this quotation's links.");
      }
      const delivery = await QuotationDelivery.findOne({ _id: deliveryId, quotationId });
      if (!delivery) throw new ApiError("NOT_FOUND", "Delivery not found.");
      if (!delivery.viewTokenHash) throw new ApiError("CONFLICT", "This delivery has no link.");
      if (!delivery.viewRevokedAt) {
        delivery.viewRevokedAt = new Date();
        pushDeliveryEvent(delivery, "link_revoked", "The view link was switched off.");
        await delivery.save();
      }
      return apiSuccess(deliveryDto(delivery.toObject()));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/deliveries/[deliveryId]/link" });
  }
}
