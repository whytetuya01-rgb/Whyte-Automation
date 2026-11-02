import { randomBytes } from "node:crypto";
import type { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, FollowUpTask, FOLLOW_UP_OWNER_HISTORY_LIMIT, type ILeadDocument, type IFollowUpTask, type IFollowUpOwnerChange, type FollowUpOwnerChangeReason } from "@/models";
import { ApiError } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { assertIndexesDeployed } from "@/lib/mongoIndexPolicy";
import { getRolePermissions } from "@/lib/roleService";
import { recordCrmActivity } from "@/lib/crmService";
import { FOLLOW_UP_TIME_ZONE } from "@/lib/followUps";

/**
 * Every change to a lead's follow-up goes through here: the lead form (create, edit), "Done", "Reschedule", cancelling.
 *
 * A follow-up is a `FollowUpTask` (who owns it, when it is due, how it ended). `Lead.nextFollowUpAt` is kept equal to the
 * open task's due time, so the follow-ups list, the pipeline, the customer profile and the private calendar link keep
 * reading the lead exactly as before.
 *
 * Each function must run inside `withTransaction` and receives the lead loaded in that same transaction. The task, the
 * timeline entry and the lead's own fields are written together, or not at all. The functions change `lead` in memory
 * (`nextFollowUpAt`, `lastContactedAt`, `updatedAt`) and the caller saves it with the same session.
 *
 * Old follow-ups have a date on the lead but no task yet (they were created before tasks existed). They are adopted the
 * first time they are touched, so nothing has to be migrated before this code runs. If the lead's date and the task ever
 * disagree (a write that bypassed this service), the lead's date is trusted and the task is corrected.
 *
 * A lead that is won, lost or archived keeps its open task untouched: the screens (and the calendar) simply stop showing
 * the follow-up of a closed lead, and it comes back by itself if the lead is reopened. Whether a follow-up counts as
 * overdue, today or upcoming is never stored; it is worked out from the due time (see `lib/followUps.ts`).
 */

const DAY_MS = 24 * 3600 * 1000;
export const MAX_FOLLOW_UP_DAYS_AHEAD = 730;

/** Roles that can never use the CRM, and so can never own a follow-up. */
const NON_CRM_ROLES = ["super_admin", "dealer", "sales_executive", "sales"] as const;

export interface FollowUpActor {
  userId: number;
  role: string;
  permissions: string[];
  companyId: number;
  /** The acting person's time zone (default Asia/Kolkata): timeline text shows times in it. */
  timeZone?: string;
}

export interface FollowUpContext {
  actor: FollowUpActor;
  /** The transaction's session (undefined on a MongoDB without transactions). */
  session?: ClientSession;
  now?: Date;
}

/** A time for the timeline, in the acting person's own zone and with the zone named, so a colleague elsewhere is not misled. */
const when = (ctx: FollowUpContext, date: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: ctx.actor.timeZone ?? FOLLOW_UP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date);

export const displayName = (user: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  user.name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "a team member";

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

const newTaskId = () => `ft_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

const isDuplicateKey = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;

const conflictError = () => new ApiError("CONFLICT", "This follow-up was just changed by someone else. Refresh the page and try again.");

/**
 * Makes sure the one-open-task index exists before a follow-up is written (two requests could otherwise both create the
 * open task of the same lead). The routes call this BEFORE they open a transaction. In development and tests Mongoose has
 * built the index by then. In production nothing is ever created by a request: if the index has not been deployed yet the
 * request stops with a clear 503 and changes nothing (deploy it with `scripts/indexes.ts`, see docs/index-deployment.md).
 */
export function ensureFollowUpTaskIndexes(): Promise<void> {
  return assertIndexesDeployed(FollowUpTask, ["one_open_task_per_lead"]);
}

/** A date a person may schedule a follow-up for: a valid time that has not passed yet, within two years. */
export function assertSchedulableDate(date: Date, now: Date = new Date(), field = "nextFollowUpAt"): void {
  if (Number.isNaN(date.getTime())) throw new ApiError("VALIDATION_ERROR", "That date is not valid.", { field });
  if (date.getTime() < now.getTime()) throw new ApiError("VALIDATION_ERROR", "Pick a time that has not passed yet.", { field });
  if (date.getTime() - now.getTime() > MAX_FOLLOW_UP_DAYS_AHEAD * DAY_MS) throw new ApiError("VALIDATION_ERROR", "The next follow-up must be within two years.", { field });
}

// ── who may own a follow-up ──────────────────────────────────────────────────────────────────────────────────────

interface OwnerCandidate {
  _id?: number;
  role?: string | null;
  isActive?: boolean;
  permissions?: string[] | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/** An owner is an active member of the company who can manage leads. Dealers, Sales Executives and platform admins cannot. */
export async function canOwnFollowUps(user: OwnerCandidate, companyId: number): Promise<boolean> {
  const role = (user.role ?? "").trim().toLowerCase();
  if (!role || (NON_CRM_ROLES as readonly string[]).includes(role) || user.isActive === false) return false;
  const permissions = role === "configurable_admin" ? (Array.isArray(user.permissions) ? user.permissions : []) : await getRolePermissions(role, companyId);
  return hasPermission(role, permissions, "leads:manage");
}

const actorCanOwn = (actor: FollowUpActor) => !(NON_CRM_ROLES as readonly string[]).includes(actor.role) && hasPermission(actor.role, actor.permissions, "leads:manage");

export async function findOwner(ctx: FollowUpContext, ownerId: number) {
  return AdminUser.findOne({ _id: ownerId, companyId: ctx.actor.companyId })
    .select("name firstName lastName email role isActive permissions")
    .session(ctx.session ?? null)
    .lean<OwnerCandidate>();
}

export async function requireEligibleOwner(ctx: FollowUpContext, ownerId: number): Promise<{ id: number; name: string }> {
  const owner = await findOwner(ctx, ownerId);
  if (!owner || !(await canOwnFollowUps(owner, ctx.actor.companyId))) {
    throw new ApiError("VALIDATION_ERROR", "That person cannot own follow-ups. Choose an active team member who can manage leads.", { field: "followUpOwnerId" });
  }
  return { id: ownerId, name: displayName(owner) };
}

/** The owner of a new follow-up when nobody was chosen: whoever is setting it; failing that, whoever created the lead. */
async function defaultOwner(ctx: FollowUpContext, lead: ILeadDocument): Promise<{ id: number; name: string }> {
  if (actorCanOwn(ctx.actor)) {
    const self = await findOwner(ctx, ctx.actor.userId);
    return { id: ctx.actor.userId, name: self ? displayName(self) : "you" };
  }
  const creator = lead.createdBy ? await findOwner(ctx, lead.createdBy) : null;
  if (creator && (await canOwnFollowUps(creator, ctx.actor.companyId))) return { id: lead.createdBy, name: displayName(creator) };
  throw new ApiError("VALIDATION_ERROR", "Choose who owns this follow-up.", { field: "followUpOwnerId" });
}

async function ownerFor(ctx: FollowUpContext, lead: ILeadDocument, requested: number | null | undefined, previousOwnerId?: number) {
  if (requested != null) return requireEligibleOwner(ctx, requested);
  if (previousOwnerId != null) {
    const previous = await findOwner(ctx, previousOwnerId);
    if (previous && (await canOwnFollowUps(previous, ctx.actor.companyId))) return { id: previousOwnerId, name: displayName(previous) };
  }
  return defaultOwner(ctx, lead);
}

export async function nameOf(ctx: FollowUpContext, userId: number): Promise<string> {
  const user = await findOwner(ctx, userId);
  return user ? displayName(user) : "a former team member";
}

/** The people who can be chosen as an owner in this company. */
export async function listEligibleOwners(companyId: number): Promise<Array<{ id: number; name: string; role: string }>> {
  await connectMongoDB();
  const users = await AdminUser.find({ companyId, isActive: { $ne: false }, role: { $nin: [...NON_CRM_ROLES] } })
    .select("name firstName lastName email role isActive permissions")
    .limit(300)
    .lean<Array<OwnerCandidate & { _id: number; role: string }>>();
  const owners: Array<{ id: number; name: string; role: string }> = [];
  for (const user of users) {
    if (await canOwnFollowUps(user, companyId)) owners.push({ id: user._id, name: displayName(user), role: user.role });
  }
  return owners.sort((a, b) => a.name.localeCompare(b.name));
}

/** Names for a set of owner ids (people who have since left are simply absent). */
export async function ownerNames(companyId: number, ids: number[]): Promise<Map<number, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  await connectMongoDB();
  const users = await AdminUser.find({ companyId, _id: { $in: unique } }).select("name firstName lastName email").lean<Array<OwnerCandidate & { _id: number }>>();
  return new Map(users.map((user) => [user._id, displayName(user)]));
}

/** The open follow-up task of each lead (for screens that list leads). */
export async function openTasksByLead(companyId: number, leadIds: string[]): Promise<Map<string, Pick<IFollowUpTask, "_id" | "leadId" | "ownerId" | "version">>> {
  if (leadIds.length === 0) return new Map();
  await connectMongoDB();
  const tasks = await FollowUpTask.find({ companyId, leadId: { $in: leadIds }, status: "open" }).select("leadId ownerId version").lean<Array<Pick<IFollowUpTask, "_id" | "leadId" | "ownerId" | "version">>>();
  return new Map(tasks.map((task) => [task.leadId, task]));
}

// ── the open task of a lead ──────────────────────────────────────────────────────────────────────────────────────

export type OpenTask = Pick<IFollowUpTask, "_id" | "leadId" | "ownerId" | "originalOwnerId" | "dueAt" | "version">;

async function createTask(ctx: FollowUpContext, lead: ILeadDocument, params: { ownerId: number; dueAt: Date; createdVia: IFollowUpTask["createdVia"]; scheduleChangedAt?: Date }): Promise<OpenTask> {
  const now = ctx.now ?? new Date();
  const doc = {
    _id: newTaskId(),
    companyId: ctx.actor.companyId,
    leadId: lead._id,
    ownerId: params.ownerId,
    originalOwnerId: params.ownerId,
    ownerHistory: [],
    dueAt: params.dueAt,
    status: "open" as const,
    version: 1,
    scheduleChangedAt: params.scheduleChangedAt ?? now,
    createdVia: params.createdVia,
    createdBy: ctx.actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await FollowUpTask.create([doc], { session: ctx.session });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflictError();
    throw error;
  }
  return { _id: doc._id, leadId: doc.leadId, ownerId: doc.ownerId, originalOwnerId: doc.originalOwnerId, dueAt: doc.dueAt, version: 1 };
}

/**
 * The parts of an update that hand a task to another owner: the new owner, the original owner (kept once, never changed
 * afterwards) and the history entry. The previous owner is never lost.
 */
export function ownerChangeParts(
  ctx: FollowUpContext,
  task: Pick<OpenTask, "ownerId" | "originalOwnerId">,
  toOwnerId: number,
  reason: FollowUpOwnerChangeReason,
  extra: { batchId?: string | null; note?: string | null } = {}
): { set: Record<string, unknown>; entry: IFollowUpOwnerChange } {
  return {
    set: { ownerId: toOwnerId, ...(task.originalOwnerId == null ? { originalOwnerId: task.ownerId } : {}) },
    entry: { fromOwnerId: task.ownerId, toOwnerId, changedBy: ctx.actor.userId, changedAt: ctx.now ?? new Date(), reason, batchId: extra.batchId ?? null, note: extra.note ?? null },
  };
}

/**
 * Changes an open task if nobody else changed it since it was read (compare-and-set on `version`). Returns whether it
 * did; a caller that must not fail as a whole when one task has moved on (a bulk change) uses this directly.
 */
export async function updateOpenTaskIfCurrent(ctx: FollowUpContext, task: Pick<OpenTask, "_id" | "version">, set: Record<string, unknown>, ownerChange?: IFollowUpOwnerChange): Promise<boolean> {
  const result = await FollowUpTask.updateOne(
    { _id: task._id, status: "open", version: task.version },
    {
      $set: { ...set, updatedAt: ctx.now ?? new Date() },
      $inc: { version: 1 },
      ...(ownerChange ? { $push: { ownerHistory: { $each: [ownerChange], $slice: -FOLLOW_UP_OWNER_HISTORY_LIMIT } } } : {}),
    },
    { session: ctx.session }
  );
  return result.modifiedCount === 1;
}

/** Same, but a task that has moved on is an error (409): for a change the person asked for on one follow-up. */
export async function updateOpenTask(ctx: FollowUpContext, task: Pick<OpenTask, "_id" | "version">, set: Record<string, unknown>, ownerChange?: IFollowUpOwnerChange): Promise<void> {
  if (!(await updateOpenTaskIfCurrent(ctx, task, set, ownerChange))) throw conflictError();
}

const findOpenTask = (ctx: FollowUpContext, lead: ILeadDocument): Promise<OpenTask | null> =>
  FollowUpTask.findOne({ companyId: ctx.actor.companyId, leadId: lead._id, status: "open" })
    .select("leadId ownerId originalOwnerId dueAt version")
    .session(ctx.session ?? null)
    .lean<OpenTask>();

/**
 * The lead's open task, made consistent with the lead's own date: adopts an old follow-up that has no task, corrects a
 * task whose date differs from the lead's, and closes a task whose lead no longer has a date.
 */
async function openTaskOf(ctx: FollowUpContext, lead: ILeadDocument, requestedOwnerId?: number | null): Promise<OpenTask | null> {
  const now = ctx.now ?? new Date();
  const task = await findOpenTask(ctx, lead);
  const mirror = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;

  if (!task) {
    if (!mirror) return null;
    const owner = await ownerFor(ctx, lead, requestedOwnerId);
    return createTask(ctx, lead, { ownerId: owner.id, dueAt: mirror, createdVia: "backfill", scheduleChangedAt: lead.updatedAt ? new Date(lead.updatedAt) : now });
  }
  if (!mirror) {
    await updateOpenTask(ctx, task, { status: "cancelled", cancelledAt: now, cancelledBy: ctx.actor.userId, cancelReason: "The lead's follow-up date was cleared." });
    return null;
  }
  if (!sameInstant(task.dueAt, mirror)) {
    await updateOpenTask(ctx, task, { dueAt: mirror, scheduleChangedAt: now });
    return { ...task, dueAt: mirror, version: task.version + 1 };
  }
  return task;
}

function assertExpected(expected: Date | null | undefined, current: Date | null) {
  if (expected === undefined) return;
  if (!sameInstant(expected, current)) throw conflictError();
}

async function note(ctx: FollowUpContext, lead: ILeadDocument, title: string, description: string): Promise<void> {
  await recordCrmActivity({
    companyId: ctx.actor.companyId,
    leadId: lead._id,
    customerId: lead.customerId,
    type: "follow_up",
    title,
    description,
    performedBy: ctx.actor.userId,
    session: ctx.session ?? null,
  });
}

/** Records an owner hand-over in the timeline. */
async function noteOwnerChange(ctx: FollowUpContext, lead: ILeadDocument, fromId: number, to: { id: number; name: string }) {
  await note(ctx, lead, "Follow-up owner changed", `Owner changed from ${await nameOf(ctx, fromId)} to ${to.name}.`);
}

// ── operations ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A new lead created with a follow-up date: the task is created with the lead. */
export async function createLeadFollowUp(ctx: FollowUpContext, lead: ILeadDocument, input: { dueAt: Date; ownerId?: number | null }): Promise<void> {
  const owner = await ownerFor(ctx, lead, input.ownerId);
  await createTask(ctx, lead, { ownerId: owner.id, dueAt: input.dueAt, createdVia: "crm" });
}

/**
 * The lead form: `nextFollowUpAt` undefined = leave the date alone, null = remove the follow-up, a date = set or move it.
 * `ownerId` hands the open follow-up to someone else. Unchanged values write nothing.
 */
export async function applyLeadFormFollowUp(ctx: FollowUpContext, lead: ILeadDocument, input: { nextFollowUpAt?: Date | null; ownerId?: number | null }): Promise<void> {
  const now = ctx.now ?? new Date();
  const wantsDate = input.nextFollowUpAt !== undefined;
  const current = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const wantsOwner = input.ownerId != null;
  if ((!wantsDate || sameInstant(input.nextFollowUpAt, current)) && !wantsOwner) return;

  if (wantsDate && input.nextFollowUpAt === null) {
    // Removing a follow-up never needs an owner, so an old follow-up without a task is simply cleared.
    const open = await findOpenTask(ctx, lead);
    const was = current ?? open?.dueAt ?? null;
    if (open) await updateOpenTask(ctx, open, { status: "cancelled", cancelledAt: now, cancelledBy: ctx.actor.userId, cancelReason: "Removed on the lead form." });
    if (was) await note(ctx, lead, "Follow-up cancelled", `The follow-up that was due ${when(ctx, was)} was removed.`);
    lead.nextFollowUpAt = null;
    lead.updatedAt = now;
    return;
  }

  const task = await openTaskOf(ctx, lead, input.ownerId);
  const dueAt = wantsDate ? (input.nextFollowUpAt as Date) : (current as Date | null);
  if (!dueAt) throw new ApiError("VALIDATION_ERROR", "Set a follow-up date before choosing its owner.", { field: "followUpOwnerId" });

  if (!task) {
    const owner = await ownerFor(ctx, lead, input.ownerId);
    await createTask(ctx, lead, { ownerId: owner.id, dueAt, createdVia: "crm" });
    await note(ctx, lead, "Follow-up scheduled", `Due ${when(ctx, dueAt)}. Owner: ${owner.name}.`);
  } else {
    const set: Record<string, unknown> = {};
    const moved = !sameInstant(task.dueAt, dueAt);
    if (moved) Object.assign(set, { dueAt, scheduleChangedAt: now });
    const newOwner = wantsOwner && input.ownerId !== task.ownerId ? await requireEligibleOwner(ctx, input.ownerId as number) : null;
    const change = newOwner ? ownerChangeParts(ctx, task, newOwner.id, "manual") : null;
    if (change) Object.assign(set, change.set);
    if (Object.keys(set).length > 0) await updateOpenTask(ctx, task, set, change?.entry);
    if (moved) await note(ctx, lead, "Follow-up rescheduled", `Moved from ${when(ctx, task.dueAt)} to ${when(ctx, dueAt)}.`);
    if (newOwner) await noteOwnerChange(ctx, lead, task.ownerId, newOwner);
  }
  lead.nextFollowUpAt = dueAt;
  lead.updatedAt = now;
}

/** "Reschedule": the same follow-up moves to a new time (it keeps its identity and its owner unless one is chosen). */
export async function rescheduleFollowUp(ctx: FollowUpContext, lead: ILeadDocument, input: { to: Date; note?: string; ownerId?: number | null; expectedNextFollowUpAt?: Date | null }): Promise<void> {
  const now = ctx.now ?? new Date();
  assertSchedulableDate(input.to, now);
  const task = await openTaskOf(ctx, lead, input.ownerId);
  assertExpected(input.expectedNextFollowUpAt, task ? task.dueAt : null);

  const previous = task ? task.dueAt : null;
  let handedTo: { id: number; name: string } | null = null;
  if (task) {
    const set: Record<string, unknown> = { dueAt: input.to, scheduleChangedAt: now };
    let change: ReturnType<typeof ownerChangeParts> | null = null;
    if (input.ownerId != null && input.ownerId !== task.ownerId) {
      handedTo = await requireEligibleOwner(ctx, input.ownerId);
      change = ownerChangeParts(ctx, task, handedTo.id, "manual");
      Object.assign(set, change.set);
    }
    await updateOpenTask(ctx, task, set, change?.entry);
  } else {
    const owner = await ownerFor(ctx, lead, input.ownerId);
    await createTask(ctx, lead, { ownerId: owner.id, dueAt: input.to, createdVia: "crm" });
  }
  lead.nextFollowUpAt = input.to;
  lead.updatedAt = now;

  await note(ctx, lead, "Follow-up rescheduled", [`Moved from ${previous ? when(ctx, previous) : "no date"} to ${when(ctx, input.to)}.`, input.note?.trim()].filter(Boolean).join(" "));
  if (handedTo && task) await noteOwnerChange(ctx, lead, task.ownerId, handedTo);
}

/** "Done": the follow-up is completed (the lead's last contact is now) and the next one, if any, is scheduled. */
export async function completeFollowUp(ctx: FollowUpContext, lead: ILeadDocument, input: { next: Date | null; note?: string; ownerId?: number | null; expectedNextFollowUpAt?: Date | null }): Promise<void> {
  const now = ctx.now ?? new Date();
  if (input.next) assertSchedulableDate(input.next, now);
  const task = await openTaskOf(ctx, lead, input.ownerId);
  assertExpected(input.expectedNextFollowUpAt, task ? task.dueAt : null);

  if (task) await updateOpenTask(ctx, task, { status: "completed", completedAt: now, completedBy: ctx.actor.userId });
  if (input.next) {
    // The next follow-up stays with the person who had this one, unless someone else is chosen (or they have left).
    const owner = await ownerFor(ctx, lead, input.ownerId, task?.ownerId);
    await createTask(ctx, lead, { ownerId: owner.id, dueAt: input.next, createdVia: "crm" });
  }
  lead.nextFollowUpAt = input.next;
  lead.lastContactedAt = now;
  lead.updatedAt = now;

  const nextText = input.next ? `Next follow-up: ${when(ctx, input.next)}.` : "No next follow-up planned.";
  await note(ctx, lead, "Follow-up done", [input.note?.trim(), nextText].filter(Boolean).join(" "));
}

/** Cancels the open follow-up without marking it done. */
export async function cancelFollowUp(ctx: FollowUpContext, lead: ILeadDocument, input: { note?: string; expectedNextFollowUpAt?: Date | null }): Promise<void> {
  const now = ctx.now ?? new Date();
  const task = await findOpenTask(ctx, lead);
  const mirror = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  assertExpected(input.expectedNextFollowUpAt, mirror);
  const was = mirror ?? task?.dueAt ?? null;
  if (!was) throw new ApiError("CONFLICT", "This lead has no follow-up to cancel.");

  if (task) await updateOpenTask(ctx, task, { status: "cancelled", cancelledAt: now, cancelledBy: ctx.actor.userId, cancelReason: input.note?.trim().slice(0, 500) || "Cancelled." });
  lead.nextFollowUpAt = null;
  lead.updatedAt = now;
  await note(ctx, lead, "Follow-up cancelled", [`The follow-up that was due ${when(ctx, was)} was cancelled.`, input.note?.trim()].filter(Boolean).join(" "));
}

/** What the screens need to know about a lead's follow-up. */
export async function describeFollowUp(companyId: number, lead: Pick<ILeadDocument, "_id" | "nextFollowUpAt">): Promise<{
  nextFollowUpAt: string | null;
  task: { id: string; ownerId: number; ownerName: string | null; version: number } | null;
  /** True for an old follow-up that has no task yet (it is adopted the first time it is changed). */
  legacy: boolean;
}> {
  await connectMongoDB();
  const task = await FollowUpTask.findOne({ companyId, leadId: lead._id, status: "open" }).select("ownerId version").lean<Pick<IFollowUpTask, "_id" | "ownerId" | "version">>();
  const names = task ? await ownerNames(companyId, [task.ownerId]) : new Map<number, string>();
  return {
    nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toISOString() : null,
    task: task ? { id: task._id, ownerId: task.ownerId, ownerName: names.get(task.ownerId) ?? null, version: task.version } : null,
    legacy: !task && Boolean(lead.nextFollowUpAt),
  };
}
