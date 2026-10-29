import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One attempt to deliver a quotation to a client (today: an email with the PDF attached), with its full history.
 *
 * Status moves forward only: queued → sent → delivered → read. `failed` is set when the provider refuses the
 * message or later reports a bounce; a failed delivery can be retried, which re-sends the same stored PDF and
 * records a new attempt. Every change is appended to `events`, so the communication history is never rewritten.
 * Tenant-scoped: every query is filtered by the caller's company.
 */

export const DELIVERY_CHANNELS = ["email"] as const;
export const DELIVERY_STATUSES = ["queued", "sent", "delivered", "read", "failed"] as const;
export const DELIVERY_EVENT_TYPES = ["queued", "sent", "delivered", "read", "failed", "retried", "delayed", "complained"] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

/** Upper bounds that keep one delivery document small no matter how many provider events arrive. */
export const DELIVERY_MAX_EVENTS = 60;
export const DELIVERY_MAX_ATTEMPTS = 5;

export interface DeliveryEvent {
  type: DeliveryEventType;
  at: Date;
  /** Short, safe description (never a raw provider error). */
  detail: string | null;
}

export interface IQuotationDelivery {
  _id: string;
  id?: string;
  companyId: number;
  quotationId: string;
  channel: DeliveryChannel;
  recipient: string;
  subject: string;
  message: string | null;
  attachmentName: string;
  attachmentSize: number;
  attachmentSha256: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: { code: string; message: string; at: Date } | null;
  /** The email provider's id for the latest attempt; used to match its delivery / open / bounce notifications. */
  providerMessageId: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  createdBy: number;
  createdByName: string | null;
  events: DeliveryEvent[];
  /** Provider notification ids already applied, so a re-delivered notification is never applied twice. */
  processedEventIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuotationDeliveryDocument extends Omit<IQuotationDelivery, "id">, Document<string> {
  id: string;
}

const QuotationDeliverySchema = new Schema<IQuotationDeliveryDocument>(
  {
    _id: { type: String, required: true },
    quotationId: { type: String, required: true },
    channel: { type: String, enum: DELIVERY_CHANNELS, required: true, default: "email" },
    recipient: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    subject: { type: String, required: true, maxlength: 200 },
    message: { type: String, default: null, maxlength: 2000 },
    attachmentName: { type: String, required: true, maxlength: 200 },
    attachmentSize: { type: Number, required: true, min: 1 },
    attachmentSha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "queued" },
    attempts: { type: Number, required: true, default: 0, min: 0, max: DELIVERY_MAX_ATTEMPTS },
    lastError: {
      type: new Schema(
        { code: { type: String, required: true }, message: { type: String, required: true }, at: { type: Date, required: true } },
        { _id: false }
      ),
      default: null,
    },
    providerMessageId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    createdBy: { type: Number, required: true },
    createdByName: { type: String, default: null },
    events: {
      type: [
        new Schema(
          {
            type: { type: String, enum: DELIVERY_EVENT_TYPES, required: true },
            at: { type: Date, required: true },
            detail: { type: String, default: null, maxlength: 300 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    processedEventIds: { type: [String], default: [] },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.processedEventIds;
        return ret;
      },
    },
  }
);

QuotationDeliverySchema.index({ companyId: 1, quotationId: 1, createdAt: -1 });
// A provider message id belongs to exactly one delivery (sparse: queued/failed attempts have none).
QuotationDeliverySchema.index({ providerMessageId: 1 }, { unique: true, partialFilterExpression: { providerMessageId: { $type: "string" } } });

tenantScopePlugin(QuotationDeliverySchema);

export const QuotationDelivery: Model<IQuotationDeliveryDocument> =
  (mongoose.models.QuotationDelivery as Model<IQuotationDeliveryDocument> | undefined) ??
  mongoose.model<IQuotationDeliveryDocument>("QuotationDelivery", QuotationDeliverySchema);

export default QuotationDelivery;
