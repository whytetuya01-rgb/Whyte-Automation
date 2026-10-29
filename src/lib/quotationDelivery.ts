import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { emailSchema } from "@/lib/validation/fields";
import { sendEmail } from "@/lib/email/service";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import {
  DELIVERY_MAX_EVENTS,
  type DeliveryEventType,
  type DeliveryStatus,
  type IQuotationDeliveryDocument,
} from "@/models/QuotationDelivery";
import type { IQuotationDocument } from "@/models/Quotation";

/**
 * Quotation delivery: sending a quotation PDF by email, recording each attempt, and applying the email provider's
 * later notifications (delivered / opened / bounced). Server-only.
 */

// ── input ─────────────────────────────────────────────────────────────────────

const noControlChars = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export const sendDeliverySchema = z
  .object({
    to: emailSchema,
    subject: z
      .string({ message: "Subject is required." })
      .trim()
      .min(1, "Subject is required.")
      .max(200, "Subject must be 200 characters or fewer.")
      .refine((value) => !/[\r\n]/.test(value) && noControlChars(value), "Subject contains invalid characters."),
    message: z
      .string()
      .trim()
      .max(2000, "Message must be 2000 characters or fewer.")
      .refine(noControlChars, "Message contains invalid characters.")
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .strict();

export type SendDeliveryInput = z.infer<typeof sendDeliverySchema>;

/** Sends (including retries) per user per hour (in-process; see `rateLimit.ts`). Tunable per deployment. */
export function deliveryRateLimit(): { max: number; windowMs: number } {
  const configured = Number(process.env.QUOTATION_DELIVERY_RATE_LIMIT_MAX);
  return { max: Number.isInteger(configured) && configured > 0 ? configured : 30, windowMs: 60 * 60 * 1000 };
}

export function newDeliveryId(): string {
  return `qd_${randomUUID().replace(/-/g, "")}`;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A real PDF starts with `%PDF-`; the declared content type alone is never trusted. */
export function isPdf(data: Buffer): boolean {
  return data.length > 5 && data.subarray(0, 5).toString("latin1") === "%PDF-";
}

// ── outcome mapping ──────────────────────────────────────────────────────────

/** Maps a send failure to a safe, user-facing code and message (never the provider's raw text). */
export function deliveryErrorFor(reason: string | undefined): { code: string; message: string } {
  if (reason === "EMAIL_NOT_CONFIGURED") {
    return { code: "EMAIL_NOT_CONFIGURED", message: "Email sending is not set up for this workspace yet. Ask your administrator to configure it, then retry." };
  }
  if (reason === "NETWORK_ERROR") {
    return { code: "NETWORK_ERROR", message: "The email service could not be reached. Please retry in a moment." };
  }
  const status = /^PROVIDER_ERROR_(\d{3})$/.exec(reason ?? "")?.[1];
  if (status && Number(status) >= 500) {
    return { code: "PROVIDER_UNAVAILABLE", message: "The email service had a temporary problem. Please retry in a moment." };
  }
  if (status === "429") {
    return { code: "PROVIDER_RATE_LIMITED", message: "Too many emails were sent in a short time. Please retry in a minute." };
  }
  return { code: "PROVIDER_REJECTED", message: "The email service refused this message. Check the recipient address and retry." };
}

export const DELIVERY_ERROR_BOUNCED = { code: "BOUNCED", message: "The recipient's mail server rejected the message (bounced). Check the address and retry." };

// ── history ──────────────────────────────────────────────────────────────────

/** Appends one event, keeping the newest `DELIVERY_MAX_EVENTS`. */
export function pushDeliveryEvent(delivery: IQuotationDeliveryDocument, type: DeliveryEventType, detail: string | null, at = new Date()): void {
  delivery.events.push({ type, at, detail });
  if (delivery.events.length > DELIVERY_MAX_EVENTS) {
    delivery.events.splice(0, delivery.events.length - DELIVERY_MAX_EVENTS);
  }
}

// ── email ────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

export function renderQuotationEmail(input: {
  companyName: string;
  quotationNumber: string;
  clientName: string;
  senderName: string | null;
  message: string | null;
}): { html: string; text: string } {
  const greeting = `Dear ${input.clientName},`;
  const body = input.message ?? `Please find attached quotation ${input.quotationNumber} from ${input.companyName}.`;
  const signoff = [input.senderName, input.companyName].filter(Boolean).join("\n");
  const text = `${greeting}\n\n${body}\n\nQuotation: ${input.quotationNumber} (PDF attached)\n\nRegards,\n${signoff}\n`;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f7;font-family:Arial,Helvetica,sans-serif;color:#1e1e22">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e7;border-radius:12px;padding:28px">
<p style="margin:0 0 14px">${escapeHtml(greeting)}</p>
${paragraphs}
<p style="margin:0 0 14px;padding:12px 14px;background:#f6f6f7;border-radius:8px;font-size:14px">Quotation <strong>${escapeHtml(input.quotationNumber)}</strong> is attached as a PDF.</p>
<p style="margin:18px 0 0">Regards,<br>${signoff.split("\n").map(escapeHtml).join("<br>")}</p>
</div></body></html>`;
  return { html, text };
}

/**
 * Sends (or re-sends) one delivery with its stored PDF and records the outcome on the document (not saved here).
 * Returns true when the provider accepted the message.
 */
export async function attemptDelivery(
  delivery: IQuotationDeliveryDocument,
  pdf: Buffer,
  context: { companyName: string; quotationNumber: string; clientName: string; senderName: string | null; replyTo: string | null }
): Promise<boolean> {
  const { html, text } = renderQuotationEmail({
    companyName: context.companyName,
    quotationNumber: context.quotationNumber,
    clientName: context.clientName,
    senderName: context.senderName,
    message: delivery.message,
  });
  const result = await sendEmail({
    to: delivery.recipient,
    subject: delivery.subject,
    html,
    text,
    attachments: [{ filename: delivery.attachmentName, content: pdf.toString("base64") }],
    replyTo: context.replyTo ?? undefined,
  });

  const now = new Date();
  delivery.attempts += 1;
  if (result.sent) {
    delivery.status = "sent";
    delivery.sentAt = now;
    delivery.failedAt = null;
    delivery.lastError = null;
    delivery.providerMessageId = result.id ?? null;
    pushDeliveryEvent(delivery, "sent", `Accepted by the email service (attempt ${delivery.attempts}).`, now);
    return true;
  }
  const error = deliveryErrorFor(result.reason);
  delivery.status = "failed";
  delivery.failedAt = now;
  delivery.lastError = { ...error, at: now };
  delivery.providerMessageId = null;
  pushDeliveryEvent(delivery, "failed", `${error.message} (attempt ${delivery.attempts})`, now);
  return false;
}

/** First successful send of a draft quotation moves it to "sent", exactly like downloading or sharing it does. */
export async function markQuotationSentIfDraft(quotation: IQuotationDocument, userId: number): Promise<boolean> {
  if (quotation.status !== "draft") return false;
  quotation.status = "sent";
  quotation.sentAt = new Date();
  quotation.sentBy = userId;
  await quotation.save();
  await recordQuotationEvent({
    quotationId: quotation._id,
    action: "status_changed",
    performedBy: userId,
    previousValue: { status: "draft" },
    newValue: { status: "sent" },
    metadata: { via: "email" },
  });
  return true;
}

// ── provider notifications ───────────────────────────────────────────────────

const STATUS_RANK: Record<DeliveryStatus, number> = { queued: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

export type ProviderEventKind = "delivered" | "opened" | "bounced" | "complained" | "delayed";

/** Resend notification type → our event kind (anything else is ignored). */
export function providerEventKind(type: unknown): ProviderEventKind | null {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.bounced":
    case "email.failed":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.delivery_delayed":
      return "delayed";
    default:
      return null;
  }
}

/**
 * Applies one provider notification to a delivery (not saved here). Status only moves forward (a late "delivered"
 * never undoes "read"; a bounce after delivery is recorded but does not mark it failed). Returns true if anything
 * changed. Idempotent through `processedEventIds`.
 */
export function applyProviderEvent(delivery: IQuotationDeliveryDocument, eventId: string, kind: ProviderEventKind, at: Date): boolean {
  if (delivery.processedEventIds.includes(eventId)) return false;
  delivery.processedEventIds.push(eventId);
  if (delivery.processedEventIds.length > DELIVERY_MAX_EVENTS) delivery.processedEventIds.splice(0, delivery.processedEventIds.length - DELIVERY_MAX_EVENTS);

  const rank = STATUS_RANK[delivery.status];
  switch (kind) {
    case "delivered":
      if (delivery.status !== "failed" && rank < STATUS_RANK.delivered) delivery.status = "delivered";
      delivery.deliveredAt = delivery.deliveredAt ?? at;
      pushDeliveryEvent(delivery, "delivered", "Delivered to the recipient's mail server.", at);
      return true;
    case "opened":
      if (delivery.status !== "failed" && rank < STATUS_RANK.read) delivery.status = "read";
      delivery.deliveredAt = delivery.deliveredAt ?? at;
      delivery.readAt = delivery.readAt ?? at;
      pushDeliveryEvent(delivery, "read", "Opened by the recipient (where the mail app reports it).", at);
      return true;
    case "bounced":
      if (rank < STATUS_RANK.delivered) {
        delivery.status = "failed";
        delivery.failedAt = at;
        delivery.lastError = { ...DELIVERY_ERROR_BOUNCED, at };
      }
      pushDeliveryEvent(delivery, "failed", DELIVERY_ERROR_BOUNCED.message, at);
      return true;
    case "complained":
      pushDeliveryEvent(delivery, "complained", "The recipient marked the email as spam.", at);
      return true;
    case "delayed":
      pushDeliveryEvent(delivery, "delayed", "Delivery is delayed; the email service keeps trying.", at);
      return true;
  }
}

/**
 * Verifies a Resend (Svix) webhook signature: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 secret
 * after its `whsec_` prefix, compared in constant time against every `v1,` signature, within a 5-minute window.
 */
export function verifyWebhookSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 5 * 60) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature
    .split(" ")
    .map((part) => part.split(","))
    .filter(([version, value]) => version === "v1" && Boolean(value))
    .some(([, value]) => {
      const given = Buffer.from(value, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
