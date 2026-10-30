/**
 * Quotation delivery data as the browser sees it, plus display labels and WhatsApp helpers. No server imports, so
 * client components can use it.
 */

export type DeliveryStatusValue = "queued" | "sent" | "delivered" | "read" | "failed";
export type DeliveryChannelValue = "email" | "whatsapp";
export type DeliveryLinkState = "active" | "expired" | "revoked" | "none";

export interface QuotationDeliveryDto {
  id: string;
  channel: DeliveryChannelValue;
  recipient: string;
  subject: string;
  message: string | null;
  attachmentName: string;
  attachmentSize: number;
  status: DeliveryStatusValue;
  attempts: number;
  maxAttempts: number;
  canRetry: boolean;
  lastError: { code: string; message: string; at: string } | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  events: Array<{ type: string; at: string; detail: string | null }>;
  /** Secure view link: its state, how often it was opened, and the URL to copy (only while it is active). */
  link: { state: DeliveryLinkState; url: string | null; expiresAt: string | null; viewCount: number; lastViewedAt: string | null };
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatusValue, string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

/** What the status means for each channel ("read" is "Viewed" when it came from the link). */
export function deliveryStatusLabel(delivery: Pick<QuotationDeliveryDto, "status" | "channel" | "link">): string {
  if (delivery.status === "read") return delivery.link.viewCount > 0 ? "Viewed" : "Read";
  if (delivery.channel === "whatsapp" && delivery.status === "sent") return "Shared";
  return DELIVERY_STATUS_LABELS[delivery.status];
}

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannelValue, string> = { email: "Email", whatsapp: "WhatsApp" };

const DELIVERY_EVENT_LABELS: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  retried: "Retried",
  delayed: "Delayed",
  complained: "Marked as spam",
  shared: "Shared",
  viewed: "Viewed",
  link_revoked: "Link switched off",
};

export function deliveryEventLabel(type: string): string {
  return DELIVERY_EVENT_LABELS[type] ?? type;
}

/**
 * A phone number as WhatsApp expects it: country code + number, digits only. A 10-digit Indian mobile (starting
 * 6–9), with or without a leading 0, gets +91. Anything else must already carry its country code (8–15 digits).
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  const hadPlus = raw.trim().startsWith("+");
  if (!hadPlus) {
    if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
    if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  }
  if (/^00\d{8,15}$/.test(digits)) return digits.slice(2);
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** The WhatsApp click-to-chat address that opens a chat with this number and the message typed in. */
export function whatsappShareUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function defaultWhatsAppMessage(input: { clientName: string; quotationNumber: string; companyName: string }): string {
  return `Dear ${input.clientName}, please find quotation ${input.quotationNumber} from ${input.companyName}.`;
}

interface DeliveryLike {
  _id: string;
  channel?: string;
  recipient: string;
  subject: string;
  message?: string | null;
  attachmentName: string;
  attachmentSize: number;
  status: DeliveryStatusValue;
  attempts: number;
  lastError?: { code: string; message: string; at: Date | string } | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  readAt?: Date | string | null;
  failedAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdByName?: string | null;
  events?: Array<{ type: string; at: Date | string; detail?: string | null }>;
  viewCount?: number | null;
  lastViewedAt?: Date | string | null;
  viewExpiresAt?: Date | string | null;
}

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/**
 * The browser's view of a delivery. `link` is worked out on the server (state + the URL from the encrypted copy),
 * so this module never handles tokens.
 */
export function toDeliveryDto(doc: DeliveryLike, maxAttempts: number, link?: { state: DeliveryLinkState; url: string | null }): QuotationDeliveryDto {
  const channel: DeliveryChannelValue = doc.channel === "whatsapp" ? "whatsapp" : "email";
  return {
    id: doc._id,
    channel,
    recipient: doc.recipient,
    subject: doc.subject,
    message: doc.message ?? null,
    attachmentName: doc.attachmentName,
    attachmentSize: doc.attachmentSize,
    status: doc.status,
    attempts: doc.attempts,
    maxAttempts,
    // Only email can fail and be retried; a WhatsApp share is sent by the sender's own app.
    canRetry: channel === "email" && doc.status === "failed" && doc.attempts < maxAttempts,
    lastError: doc.lastError ? { code: doc.lastError.code, message: doc.lastError.message, at: iso(doc.lastError.at) as string } : null,
    sentAt: iso(doc.sentAt),
    deliveredAt: iso(doc.deliveredAt),
    readAt: iso(doc.readAt),
    failedAt: iso(doc.failedAt),
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
    createdByName: doc.createdByName ?? null,
    events: (doc.events ?? []).map((event) => ({ type: event.type, at: iso(event.at) as string, detail: event.detail ?? null })),
    link: {
      state: link?.state ?? "none",
      url: link?.state === "active" ? link.url : null,
      expiresAt: iso(doc.viewExpiresAt),
      viewCount: doc.viewCount ?? 0,
      lastViewedAt: iso(doc.lastViewedAt),
    },
  };
}
