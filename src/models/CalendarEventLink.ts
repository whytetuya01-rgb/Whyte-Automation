import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * The link between one follow-up task and its event in one person's Google calendar, and the queue entry that keeps them
 * in step. It is written in the SAME transaction as the follow-up change (a transactional outbox), so a follow-up can never
 * change without the change being queued, and a failed Google call never loses it.
 *
 *   want:    what Google should show: "upsert" (open), "complete" (done: kept, ticked), "remove" (cancelled, reassigned away,
 *            lead closed, owner left)
 *   status:  pending (waiting to be sent) | synced | error (permanent, needs a person) | removed_in_google (the event was
 *            deleted in Google: the CRM follow-up is NOT touched and we do not recreate it unless asked)
 *
 * `eventId` is derived from the connection and task (see eventMapper.eventIdFor), never random.
 */
export const CALENDAR_LINK_STATUSES = ["pending", "synced", "error", "removed_in_google"] as const;
export const CALENDAR_LINK_WANTS = ["upsert", "complete", "remove"] as const;
export type CalendarLinkStatus = (typeof CALENDAR_LINK_STATUSES)[number];
export type CalendarLinkWant = (typeof CALENDAR_LINK_WANTS)[number];

export interface ICalendarEventLink {
  _id: string;
  companyId: number;
  userId: number;
  connectionId: string;
  taskId: string;
  leadId: string;
  eventId: string;
  want: CalendarLinkWant;
  status: CalendarLinkStatus;
  /** True once an event exists in Google for this link (so "remove" knows there is something to delete). */
  existsInGoogle: boolean;
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSyncedAt: Date | null;
  /** Bumped on every change to what Google should show; a send only marks the link synced if this did not move meanwhile. */
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICalendarEventLinkDocument extends Omit<ICalendarEventLink, "_id">, Document<string> {}

const CalendarEventLinkSchema = new Schema<ICalendarEventLinkDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: Number, required: true },
    connectionId: { type: String, required: true },
    taskId: { type: String, required: true },
    leadId: { type: String, required: true },
    eventId: { type: String, required: true },
    want: { type: String, enum: CALENDAR_LINK_WANTS, default: "upsert", required: true },
    status: { type: String, enum: CALENDAR_LINK_STATUSES, default: "pending", required: true },
    existsInGoogle: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    lastErrorAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    revision: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false, timestamps: false }
);

CalendarEventLinkSchema.index({ connectionId: 1, taskId: 1 }, { unique: true, name: "one_link_per_task_and_connection" });
CalendarEventLinkSchema.index({ status: 1, nextAttemptAt: 1 }, { name: "link_queue" });
CalendarEventLinkSchema.index({ companyId: 1, userId: 1, status: 1 }, { name: "links_by_user_and_status" });
CalendarEventLinkSchema.index({ companyId: 1, taskId: 1 }, { name: "links_by_task" });

tenantScopePlugin(CalendarEventLinkSchema);

export const CalendarEventLink: Model<ICalendarEventLinkDocument> =
  mongoose.models.CalendarEventLink || mongoose.model<ICalendarEventLinkDocument>("CalendarEventLink", CalendarEventLinkSchema);
