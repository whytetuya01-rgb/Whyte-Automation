import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * "Act as company" sessions for the platform Super Admin — both the
 * short-lived grant itself AND its permanent audit record are the same row.
 *
 * By design, Super Admin does not see company business data by default
 * (Phase 1 decision #4). To look at one company's data, they start an
 * act-as session (`POST /api/platform/act-as`), which creates a row here
 * with `endedAt: null` and sets an httpOnly cookie holding nothing but this
 * row's own `_id` — a random, unguessable token that grants access to
 * exactly one company only because a live, matching, unexpired row exists
 * server-side for that exact super admin user. The cookie value alone proves
 * nothing; tampering with it to claim a different company's id simply fails
 * to match any row (or matches a row belonging to someone else's session,
 * which `src/lib/api-auth.ts`'s lookup also checks the `superAdminUserId`
 * against). Ending the session (`DELETE /api/platform/act-as`) sets
 * `endedAt`, which is also what disables an expired/ended cookie: every read
 * checks `endedAt: null` explicitly, never just "the row exists".
 *
 * Never modified after `endedAt` is set — an ended session is history, not a
 * record to be reopened or reused.
 */

export interface IPlatformAccessLog {
  _id: string;
  id?: string;
  superAdminUserId: number;
  companyId: number;
  reason: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface IPlatformAccessLogDocument extends Omit<IPlatformAccessLog, "id">, Document<string> {
  id: string;
}

const PlatformAccessLogSchema = new Schema<IPlatformAccessLogDocument>(
  {
    _id: { type: String, required: true },
    superAdminUserId: { type: Number, ref: "AdminUser", required: true, index: true },
    companyId: { type: Number, ref: "Company", required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date, default: null },
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
  }
);

PlatformAccessLogSchema.virtual("id").get(function () {
  return this._id;
});

// The one query the cookie-resolution path runs on every request while a
// super admin is acting-as: find my own live (unended) session by its id.
PlatformAccessLogSchema.index({ _id: 1, superAdminUserId: 1, endedAt: 1 });
PlatformAccessLogSchema.index({ superAdminUserId: 1, startedAt: -1 });
PlatformAccessLogSchema.index({ companyId: 1, startedAt: -1 });

const IMMUTABLE_MESSAGE = "Platform access log rows cannot be deleted, and can only be modified to set endedAt once.";

PlatformAccessLogSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"], function () {
  throw new Error(IMMUTABLE_MESSAGE);
});
PlatformAccessLogSchema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error(IMMUTABLE_MESSAGE);
});
PlatformAccessLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function (this: mongoose.Query<unknown, unknown>) {
  const update = this.getUpdate();
  const paths = update && typeof update === "object" ? Object.keys((update as Record<string, unknown>).$set ?? update) : [];
  const illegal = paths.filter((p) => p !== "endedAt");
  if (illegal.length > 0) {
    throw new Error(`${IMMUTABLE_MESSAGE} Attempted to also change: ${illegal.join(", ")}.`);
  }
});

export const PlatformAccessLog: Model<IPlatformAccessLogDocument> =
  (mongoose.models.PlatformAccessLog as Model<IPlatformAccessLogDocument> | undefined) ??
  mongoose.model<IPlatformAccessLogDocument>("PlatformAccessLog", PlatformAccessLogSchema);

export default PlatformAccessLog;
