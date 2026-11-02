import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One person's private calendar link for their lead follow-ups. The link contains a random secret: only its SHA-256 is
 * stored for lookup, plus an encrypted copy (keyed from the server secret) so the person can see their own link again.
 * Turning the link off or generating a new one removes the old secret, so the old link stops working at once.
 */
export interface ICalendarFeed {
  _id: string;
  companyId: number;
  userId: number;
  tokenHash: string | null;
  tokenSealed: string | null;
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  lastFetchedAt: Date | null;
  fetchCount: number;
}

export interface ICalendarFeedDocument extends Omit<ICalendarFeed, "_id">, Document<string> {}

const CalendarFeedSchema = new Schema<ICalendarFeedDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: Number, required: true },
    tokenHash: { type: String, default: null },
    tokenSealed: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastFetchedAt: { type: Date, default: null },
    fetchCount: { type: Number, default: 0 },
  },
  { _id: false, versionKey: false, timestamps: false }
);

// A secret identifies exactly one feed; a person has one feed.
CalendarFeedSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } });
CalendarFeedSchema.index({ companyId: 1, userId: 1 }, { unique: true });

tenantScopePlugin(CalendarFeedSchema);

export const CalendarFeed: Model<ICalendarFeedDocument> =
  mongoose.models.CalendarFeed || mongoose.model<ICalendarFeedDocument>("CalendarFeed", CalendarFeedSchema);
