/**
 * Quotation delivery data as the browser sees it, plus display labels. No server imports, so client components
 * can use it.
 */

export type DeliveryStatusValue = "queued" | "sent" | "delivered" | "read" | "failed";

export interface QuotationDeliveryDto {
  id: string;
  channel: "email";
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
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatusValue, string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

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
}

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

export function toDeliveryDto(doc: DeliveryLike, maxAttempts: number): QuotationDeliveryDto {
  return {
    id: doc._id,
    channel: "email",
    recipient: doc.recipient,
    subject: doc.subject,
    message: doc.message ?? null,
    attachmentName: doc.attachmentName,
    attachmentSize: doc.attachmentSize,
    status: doc.status,
    attempts: doc.attempts,
    maxAttempts,
    canRetry: doc.status === "failed" && doc.attempts < maxAttempts,
    lastError: doc.lastError ? { code: doc.lastError.code, message: doc.lastError.message, at: iso(doc.lastError.at) as string } : null,
    sentAt: iso(doc.sentAt),
    deliveredAt: iso(doc.deliveredAt),
    readAt: iso(doc.readAt),
    failedAt: iso(doc.failedAt),
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
    createdByName: doc.createdByName ?? null,
    events: (doc.events ?? []).map((event) => ({ type: event.type, at: iso(event.at) as string, detail: event.detail ?? null })),
  };
}
