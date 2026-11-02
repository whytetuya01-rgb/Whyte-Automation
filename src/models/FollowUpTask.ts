import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One scheduled follow-up on a lead: who owns it, when it is due, and how it ended. A lead has at most one OPEN task;
 * finished ones (completed or cancelled) stay as history. `Lead.nextFollowUpAt` is kept equal to the open task's due time
 * by `src/lib/followUpService.ts`, so every existing screen, the follow-ups list and the private calendar link keep
 * reading the lead as before.
 *
 * `version` goes up with every change to the task, and `scheduleChangedAt` records when the due time last changed; the
 * Google Calendar sync uses both to decide, deterministically, which side wins when both changed.
 */
export const FOLLOW_UP_TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export type FollowUpTaskStatus = (typeof FOLLOW_UP_TASK_STATUSES)[number];

/** "backfill" = created from a lead's existing follow-up date (the backfill script, or the first time a legacy follow-up is touched). */
export const FOLLOW_UP_TASK_ORIGINS = ["crm", "backfill"] as const;
export type FollowUpTaskOrigin = (typeof FOLLOW_UP_TASK_ORIGINS)[number];

/** Why an owner changed. "owner_unavailable" = the previous owner was deactivated or can no longer own follow-ups. */
export const FOLLOW_UP_OWNER_CHANGE_REASONS = ["manual", "owner_unavailable"] as const;
export type FollowUpOwnerChangeReason = (typeof FOLLOW_UP_OWNER_CHANGE_REASONS)[number];

/** One hand-over of a follow-up. The list on the task is the audit history of who owned it, and why that changed. */
export interface IFollowUpOwnerChange {
  fromOwnerId: number;
  toOwnerId: number;
  changedBy: number;
  changedAt: Date;
  reason: FollowUpOwnerChangeReason;
  /** Set when several follow-ups were reassigned together (the bulk reassignment screen). */
  batchId: string | null;
  note: string | null;
}

/** The newest hand-overs kept on a task (older ones remain in the lead's timeline). */
export const FOLLOW_UP_OWNER_HISTORY_LIMIT = 100;

export interface IFollowUpTask {
  _id: string;
  companyId: number;
  leadId: string;
  /** The CRM user responsible for this follow-up. Always set. */
  ownerId: number;
  /** Who owned it first. It never changes, so the original owner stays in the audit history after any reassignment. */
  originalOwnerId: number | null;
  ownerHistory: IFollowUpOwnerChange[];
  dueAt: Date;
  status: FollowUpTaskStatus;
  version: number;
  scheduleChangedAt: Date;
  createdVia: FollowUpTaskOrigin;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  completedBy: number | null;
  cancelledAt: Date | null;
  cancelledBy: number | null;
  cancelReason: string | null;
}

export interface IFollowUpTaskDocument extends Omit<IFollowUpTask, "_id">, Document<string> {}

const OwnerChangeSchema = new Schema<IFollowUpOwnerChange>(
  {
    fromOwnerId: { type: Number, required: true },
    toOwnerId: { type: Number, required: true },
    changedBy: { type: Number, required: true },
    changedAt: { type: Date, required: true },
    reason: { type: String, enum: FOLLOW_UP_OWNER_CHANGE_REASONS, required: true },
    batchId: { type: String, default: null },
    note: { type: String, default: null, maxlength: 300 },
  },
  { _id: false }
);

const FollowUpTaskSchema = new Schema<IFollowUpTaskDocument>(
  {
    _id: { type: String, required: true },
    leadId: { type: String, ref: "Lead", required: true },
    ownerId: { type: Number, ref: "AdminUser", required: true },
    originalOwnerId: { type: Number, ref: "AdminUser", default: null },
    ownerHistory: { type: [OwnerChangeSchema], default: () => [] },
    dueAt: { type: Date, required: true },
    status: { type: String, enum: FOLLOW_UP_TASK_STATUSES, default: "open", required: true },
    version: { type: Number, default: 1, min: 1 },
    scheduleChangedAt: { type: Date, required: true },
    createdVia: { type: String, enum: FOLLOW_UP_TASK_ORIGINS, default: "crm" },
    createdBy: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    completedBy: { type: Number, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Number, default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },
  },
  { _id: false, versionKey: false, timestamps: false }
);

// A lead has at most one open follow-up; two requests creating it together cannot both succeed.
FollowUpTaskSchema.index({ companyId: 1, leadId: 1 }, { unique: true, partialFilterExpression: { status: "open" }, name: "one_open_task_per_lead" });
FollowUpTaskSchema.index({ companyId: 1, leadId: 1, createdAt: -1 });
FollowUpTaskSchema.index({ companyId: 1, ownerId: 1, status: 1, dueAt: 1 });
FollowUpTaskSchema.index({ companyId: 1, status: 1, dueAt: 1 });

tenantScopePlugin(FollowUpTaskSchema);

export const FollowUpTask: Model<IFollowUpTaskDocument> =
  mongoose.models.FollowUpTask || mongoose.model<IFollowUpTaskDocument>("FollowUpTask", FollowUpTaskSchema);
