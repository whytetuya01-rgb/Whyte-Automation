import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Shared persistent login attempt and rate-limit tracking for NextAuth credentials.
 * Works across all Vercel serverless functions via MongoDB.
 *
 * Tracks failed attempts per account (normalized email) and per client IP.
 * Uses a TTL index on `expiresAt` so MongoDB Atlas automatically purges
 * expired records without cron jobs or manual table sweeps.
 */
export interface IAuthRateLimit {
  key: string;               // e.g. "account:sales@whyte.co.in" or "ip:203.0.113.195"
  type: "account" | "ip";
  identifier: string;        // Normalized email or IP
  failures: number;          // Count of consecutive failed attempts within window
  firstFailureAt: Date;
  lastFailureAt: Date;
  blockedUntil?: Date | null;
  expiresAt: Date;           // Automatically deleted by MongoDB TTL index
}

export interface IAuthRateLimitDocument extends IAuthRateLimit, Document<string> {}

const AuthRateLimitSchema = new Schema<IAuthRateLimitDocument>(
  {
    key: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, enum: ["account", "ip"], index: true },
    identifier: { type: String, required: true, index: true },
    failures: { type: Number, required: true, default: 0 },
    firstFailureAt: { type: Date, required: true, default: Date.now },
    lastFailureAt: { type: Date, required: true, default: Date.now },
    blockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: "auth_rate_limits",
  }
);

// Explicit compound index for fast lookups
AuthRateLimitSchema.index({ type: 1, identifier: 1 });

export const AuthRateLimit: Model<IAuthRateLimitDocument> =
  mongoose.models.AuthRateLimit ||
  mongoose.model<IAuthRateLimitDocument>("AuthRateLimit", AuthRateLimitSchema);

