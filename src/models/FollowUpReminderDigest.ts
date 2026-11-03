import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One morning email per person per day listing their follow-ups due today and overdue. The `_id` is
 * `<companyId>:<userId>:<YYYY-MM-DD in their time zone>`, so the scheduler can run as often as it likes and nobody gets the
 * same day's email twice. A row is claimed ("sending") before the email goes out and removed again if sending fails, so
 * the next run tries again.
 */
export const FOLLOW_UP_DIGEST_STATUSES = ["sending", "sent"] as const;
export type FollowUpDigestStatus = (typeof FOLLOW_UP_DIGEST_STATUSES)[number];

export interface IFollowUpReminderDigest {
  _id: string;
  companyId: number;
  userId: number;
  dayKey: string;
  status: FollowUpDigestStatus;
  overdue: number;
  dueToday: number;
  providerMessageId: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface IFollowUpReminderDigestDocument extends Omit<IFollowUpReminderDigest, "_id">, Document<string> {}

const FollowUpReminderDigestSchema = new Schema<IFollowUpReminderDigestDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: Number, required: true },
    dayKey: { type: String, required: true },
    status: { type: String, enum: FOLLOW_UP_DIGEST_STATUSES, default: "sending", required: true },
    overdue: { type: Number, default: 0 },
    dueToday: { type: Number, default: 0 },
    providerMessageId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false, timestamps: false }
);

tenantScopePlugin(FollowUpReminderDigestSchema);

export const FollowUpReminderDigest: Model<IFollowUpReminderDigestDocument> =
  mongoose.models.FollowUpReminderDigest || mongoose.model<IFollowUpReminderDigestDocument>("FollowUpReminderDigest", FollowUpReminderDigestSchema);
