import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, Quotation, QuotationDelivery, QuotationDeliveryFile, DELIVERY_MAX_ATTEMPTS } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { checkRateLimit } from "@/lib/rateLimit";
import { displayNameOf } from "@/lib/quotationAudit";
import { isValidEmail } from "@/lib/validation/fields";
import { attemptDelivery, deliveryRateLimit, markQuotationSentIfDraft, pushDeliveryEvent, sha256Hex } from "@/lib/quotationDelivery";
import { toDeliveryDto } from "@/lib/quotationDeliveryShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> };

/**
 * POST — retry a failed delivery with the exact PDF that was stored for it. Only a `failed` delivery with attempts
 * left can be retried; the status is claimed atomically, so two clicks never send twice.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      const params = await context.params;
      const quotationId = parseQuotationId(params.id);
      const deliveryId = typeof params.deliveryId === "string" && /^qd_[0-9a-f]{32}$/.test(params.deliveryId) ? params.deliveryId : null;
      if (!deliveryId) throw new ApiError("INVALID_ID", "Invalid delivery id.", { field: "deliveryId" });

      const { limited, retryAfterSeconds } = checkRateLimit(`quotation-delivery:${companyId}:${userId}`, deliveryRateLimit());
      if (limited) {
        throw new ApiError("RATE_LIMITED", "Too many quotations were sent in a short time. Please try again later.", { details: { retryAfterSeconds } });
      }

      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId);
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to send this quotation.");
      }

      const existing = await QuotationDelivery.findOne({ _id: deliveryId, quotationId }).select("status attempts").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Delivery not found.");
      if (existing.status !== "failed") throw new ApiError("CONFLICT", "Only a failed delivery can be retried.");
      if (existing.attempts >= DELIVERY_MAX_ATTEMPTS) {
        throw new ApiError("CONFLICT", `This delivery has already been tried ${DELIVERY_MAX_ATTEMPTS} times. Send it again as a new delivery.`);
      }

      // Claim it: only one request can move it from failed to queued.
      const delivery = await QuotationDelivery.findOneAndUpdate(
        { _id: deliveryId, quotationId, status: "failed", attempts: { $lt: DELIVERY_MAX_ATTEMPTS } },
        { $set: { status: "queued" } },
        { returnDocument: "after" }
      );
      if (!delivery) throw new ApiError("CONFLICT", "This delivery is already being retried.");
      pushDeliveryEvent(delivery, "retried", `Retry requested (attempt ${delivery.attempts + 1}).`);

      const file = await QuotationDeliveryFile.findById(deliveryId);
      if (!file || sha256Hex(file.data) !== delivery.attachmentSha256) {
        const now = new Date();
        delivery.status = "failed";
        delivery.failedAt = now;
        delivery.lastError = { code: "ATTACHMENT_MISSING", message: "The stored PDF is no longer available. Send the quotation again.", at: now };
        pushDeliveryEvent(delivery, "failed", delivery.lastError.message, now);
        await delivery.save();
        throw new ApiError("CONFLICT", delivery.lastError.message);
      }

      const [company, sender] = await Promise.all([
        companyId ? Company.findById(companyId).select("name").lean() : null,
        AdminUser.findById(userId).select("name firstName lastName email").lean(),
      ]);
      const accepted = await attemptDelivery(delivery, file.data, {
        companyName: company?.name?.trim() || "Your supplier",
        quotationNumber: quotation.quotationNumber,
        clientName: quotation.clientName,
        senderName: displayNameOf(sender),
        replyTo: sender?.email && isValidEmail(sender.email) ? sender.email : null,
      });
      await delivery.save();
      if (accepted) await markQuotationSentIfDraft(quotation, userId);

      return apiSuccess(toDeliveryDto(delivery.toObject(), DELIVERY_MAX_ATTEMPTS));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/deliveries/[deliveryId]/retry" });
  }
}
