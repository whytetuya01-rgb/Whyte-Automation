import { adoptDeliveryPdf } from "@/lib/quotationRevisionService";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, Quotation, QuotationDelivery, QuotationDeliveryFile, DELIVERY_MAX_PDF_BYTES } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { canModifyQuotation, canViewQuotation } from "@/lib/quotationAccess";
import { quotationHasProducts } from "@/lib/quotationProducts";
import { checkRateLimit } from "@/lib/rateLimit";
import { displayNameOf } from "@/lib/quotationAudit";
import { isValidEmail } from "@/lib/validation/fields";
import {
  attemptDelivery,
  deliveryRateLimit,
  isPdf,
  markQuotationSentIfDraft,
  newDeliveryId,
  pushDeliveryEvent,
  sendDeliverySchema,
  sha256Hex,
  shareWhatsAppSchema,
} from "@/lib/quotationDelivery";
import { defaultWhatsAppMessage, whatsappShareUrl } from "@/lib/quotationDeliveryShared";
import { deliveryDto, issueLink, quotationLinkUrl } from "@/lib/quotationLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** `QT-2026-001.pdf`-style name: the sender's file name is never used as-is. */
function attachmentNameFor(quotationNumber: string | null | undefined): string {
  const base = (quotationNumber ?? "Quotation").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Quotation";
  return `${base}.pdf`;
}

/** GET — the delivery history of one quotation (newest first), for anyone who may view the quotation. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canViewQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
      }
      const deliveries = await QuotationDelivery.find({ quotationId }).sort({ createdAt: -1 }).limit(50).lean();
      return apiSuccess(deliveries.map((delivery) => deliveryDto(delivery)));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/deliveries" });
  }
}

/**
 * POST (multipart/form-data) — send the quotation PDF to a client.
 *   channel  "email" (default) or "whatsapp"
 *   email:     to (address), subject, message (optional)
 *   whatsapp:  to (mobile number), message (optional)
 *   pdf        the generated PDF file
 * Every delivery gets a secure view link (/q/<token>) showing the exact PDF; opening it marks the delivery
 * "Viewed". Email goes through the email provider (the link is in the email); WhatsApp is shared from the sender's
 * own WhatsApp, so the response carries the click-to-chat address with the message and link filled in.
 * The company and sender come from the session; the quotation must be one the caller may modify.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      const quotationId = parseQuotationId((await context.params).id);

      const { limited, retryAfterSeconds } = checkRateLimit(`quotation-delivery:${companyId}:${userId}`, deliveryRateLimit());
      if (limited) {
        throw new ApiError("RATE_LIMITED", "Too many quotations were sent in a short time. Please try again later.", { details: { retryAfterSeconds } });
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data submission.");
      }
      const text = (key: string) => {
        const value = formData.get(key);
        if (value !== null && typeof value !== "string") throw new ApiError("VALIDATION_ERROR", `"${key}" must be text.`, { field: key });
        return value ?? undefined;
      };
      const channel = text("channel") ?? "email";
      if (channel !== "email" && channel !== "whatsapp") throw new ApiError("VALIDATION_ERROR", "Choose email or WhatsApp.", { field: "channel" });

      const parsed =
        channel === "email"
          ? sendDeliverySchema.safeParse({ to: text("to"), subject: text("subject"), message: text("message") })
          : shareWhatsAppSchema.safeParse({ to: text("to"), message: text("message") });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid delivery details.", { field: String(issue?.path[0] ?? "") || undefined });
      }

      const file = formData.get("pdf");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("FILE_REQUIRED", "The quotation PDF is required.", { field: "pdf" });
      if (file.size > DELIVERY_MAX_PDF_BYTES) {
        throw new ApiError("FILE_TOO_LARGE", `The PDF must be ${DELIVERY_MAX_PDF_BYTES / (1024 * 1024)}MB or smaller.`, { field: "pdf" });
      }
      const pdf = Buffer.from(await file.arrayBuffer());
      if (!isPdf(pdf)) throw new ApiError("INVALID_FILE_TYPE", "The attachment must be a PDF.", { field: "pdf" });

      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId);
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to send this quotation.");
      }
      if (!(await quotationHasProducts(quotationId))) {
        throw new ApiError("CONFLICT", "Add at least one product to this quotation before it can be sent.");
      }

      const [company, sender] = await Promise.all([
        companyId ? Company.findById(companyId).select("name").lean() : null,
        AdminUser.findById(userId).select("name firstName lastName email").lean(),
      ]);
      const companyName = company?.name?.trim() || "Your supplier";
      const senderName = displayNameOf(sender);
      const link = issueLink();
      const viewUrl = quotationLinkUrl(link.token);

      const deliveryId = newDeliveryId();
      const sha256 = sha256Hex(pdf);
      await QuotationDeliveryFile.create({ _id: deliveryId, mime: "application/pdf", size: pdf.length, sha256, data: pdf });
      const delivery = new QuotationDelivery({
        _id: deliveryId,
        quotationId,
        revision: quotation.revision ?? 1,
        channel,
        recipient: parsed.data.to,
        subject: "subject" in parsed.data ? parsed.data.subject : `Quotation ${quotation.quotationNumber}`,
        message: parsed.data.message,
        attachmentName: attachmentNameFor(quotation.quotationNumber),
        attachmentSize: pdf.length,
        attachmentSha256: sha256,
        status: "queued",
        attempts: 0,
        createdBy: userId,
        createdByName: senderName,
        viewTokenHash: link.tokenHash,
        viewTokenSealed: link.sealed,
        viewExpiresAt: link.expiresAt,
      });

      if (channel === "whatsapp") {
        // Sent from the sender's own WhatsApp: we record the share and track opens of the link.
        const now = new Date();
        delivery.status = "sent";
        delivery.sentAt = now;
        delivery.attempts = 1;
        pushDeliveryEvent(delivery, "shared", `Shared on WhatsApp with +${parsed.data.to}.`, now);
        await delivery.save();
        await markQuotationSentIfDraft(quotation, userId, "whatsapp");
        await adoptDeliveryPdf(quotationId, { _id: deliveryId }); // the revision being sent keeps this exact PDF
        const message = parsed.data.message ?? defaultWhatsAppMessage({ clientName: quotation.clientName, quotationNumber: quotation.quotationNumber, companyName });
        return apiSuccess(
          { ...deliveryDto(delivery.toObject()), whatsappUrl: whatsappShareUrl(parsed.data.to, `${message}\n\nView your quotation: ${viewUrl}`) },
          { status: 201 }
        );
      }

      pushDeliveryEvent(delivery, "queued", `Sending to ${parsed.data.to}.`);
      await delivery.save();
      const accepted = await attemptDelivery(delivery, pdf, {
        companyName,
        quotationNumber: quotation.quotationNumber,
        clientName: quotation.clientName,
        senderName,
        replyTo: sender?.email && isValidEmail(sender.email) ? sender.email : null,
        viewUrl,
      });
      await delivery.save();
      if (accepted) {
        await markQuotationSentIfDraft(quotation, userId);
        await adoptDeliveryPdf(quotationId, { _id: deliveryId }); // the revision being sent keeps this exact PDF
      }

      return apiSuccess(deliveryDto(delivery.toObject()), { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/deliveries" });
  }
}
