import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export const NOTIFICATION_TYPES = [
  "lead_assigned",
  "follow_up_due",
  "follow_up_overdue",
  "follow_up_assigned",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  _id: string;
  id?: string;
  companyId: number;
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  readAt: Date | null;
  dedupeKey: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface INotificationDocument extends Omit<INotification, "id">, Document<string> {
  id: string;
}

const NotificationSchema = new Schema<INotificationDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: Number, required: true, index: true },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true },
    readAt: { type: Date, default: null, index: true },
    dedupeKey: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

NotificationSchema.virtual("id").get(function () {
  return this._id;
});

// Indexes for fast lookup by user and company, plus deduplication
NotificationSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ companyId: 1, userId: 1, readAt: 1 });
NotificationSchema.index(
  { companyId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
    name: "uniq_company_dedupe_notification",
  }
);

tenantScopePlugin(NotificationSchema);

export const Notification: Model<INotificationDocument> =
  mongoose.models.Notification ||
  mongoose.model<INotificationDocument>("Notification", NotificationSchema);

export default Notification;

