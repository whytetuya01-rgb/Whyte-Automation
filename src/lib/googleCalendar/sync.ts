import { randomInt } from "node:crypto";
import type { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, CalendarEventLink, FollowUpTask, GoogleCalendarConnection, Lead, type ICalendarEventLink, type IGoogleCalendarConnection, type CalendarLinkWant } from "@/models";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { resolveFollowUpTimeZone } from "@/lib/followUps";
import { googleCalendarConfig } from "./config";
import { GoogleApiError, deleteCalendar, deleteEvent, insertCalendar, insertEvent, patchEvent, revokeToken } from "./client";
import { buildEventBody, eventIdFor } from "./eventMapper";
import { ReconnectNeededError, accessTokenFor, refreshAad } from "./tokens";
import { openToken } from "./crypto";

/**
 * Keeps each person's Google calendar in step with their CRM follow-ups. One direction: CRM -> Google. The CRM is the only
 * source of truth: nothing in Google can complete, cancel, reassign or reschedule a follow-up.
 *
 *  - `queueCalendarSync` runs INSIDE the follow-up's own transaction (outbox): the change and its queue entry are saved
 *    together or not at all.
 *  - `runWorker` sends the queue to Google with retries, and `reconcile` repairs drift (closed leads, left owners, tasks
 *    that never got queued).
 */

export const CALENDAR_NAME = "Whyte CRM Follow-ups";
export const LEASE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 3600_000;
const RECONNECT_RECHECK_MS = 3600_000;

type Id = string;
const newLinkId = (connectionId: Id, taskId: Id) => `cel_${connectionId.replace(/^gcc_/, "")}_${taskId}`;

/** Exponential backoff with jitter (so a burst of failures does not retry in lock-step), honouring Google's Retry-After. */
export function backoffMs(attempts: number, retryAfterMs: number | null = null, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.round(Math.max(jittered, retryAfterMs ?? 0));
}

const wantFor = (status: string): CalendarLinkWant => (status === "open" ? "upsert" : status === "completed" ? "complete" : "remove");

// ── queueing (inside the follow-up transaction) ──────────────────────────────────────────────────────────────────

/**
 * Records that this task's calendar events must be brought up to date. Cheap when nobody has connected Google (one lookup).
 * Creates or updates the owner's link, and marks any other person's link for this task (a previous owner) for removal.
 */
export async function queueCalendarSync(session: ClientSession | undefined, companyId: number, taskId: Id, now: Date = new Date()): Promise<void> {
  const s = session ?? null;
  const links = await CalendarEventLink.find({ companyId, taskId }).session(s).lean<ICalendarEventLink[]>();
  const connections = await GoogleCalendarConnection.find({ companyId, status: { $in: ["connected", "needs_reconnect"] } }).select("userId").session(s).lean<Array<{ _id: Id; userId: number }>>();
  if (links.length === 0 && connections.length === 0) return;

  const task = await FollowUpTask.findOne({ _id: taskId, companyId }).select("leadId ownerId status").session(s).lean<{ _id: Id; leadId: string; ownerId: number; status: string }>();
  if (!task) return;
  const want = wantFor(task.status);
  const ownerConnection = connections.find((connection) => connection.userId === task.ownerId);

  for (const link of links) {
    if (ownerConnection && link.connectionId === ownerConnection._id) continue;
    await markForRemoval(link, s, now);
  }
  if (!ownerConnection) return;

  const existing = links.find((link) => link.connectionId === ownerConnection._id);
  if (existing) {
    if (existing.status === "removed_in_google" && want !== "remove") return; // deleted in Google on purpose: do not bring it back by ourselves
    if (want === "remove" && !existing.existsInGoogle) {
      await CalendarEventLink.deleteOne({ _id: existing._id }, { session: s ?? undefined });
      return;
    }
    await CalendarEventLink.updateOne(
      { _id: existing._id },
      { $set: { want, status: "pending", nextAttemptAt: now, attempts: 0, leaseUntil: null, lastError: null, lastErrorAt: null, leadId: task.leadId, updatedAt: now }, $inc: { revision: 1 } },
      { session: s ?? undefined }
    );
    return;
  }
  if (want === "remove") return;
  await CalendarEventLink.create(
    [{
      _id: newLinkId(ownerConnection._id, taskId), companyId, userId: ownerConnection.userId, connectionId: ownerConnection._id, taskId, leadId: task.leadId,
      eventId: eventIdFor(ownerConnection._id, taskId), want, status: "pending", existsInGoogle: false, attempts: 0, nextAttemptAt: now, revision: 1, createdAt: now, updatedAt: now,
    }],
    { session: s ?? undefined }
  );
}

async function markForRemoval(link: ICalendarEventLink, session: ClientSession | null, now: Date): Promise<void> {
  if (!link.existsInGoogle) {
    await CalendarEventLink.deleteOne({ _id: link._id }, { session: session ?? undefined });
    return;
  }
  if (link.want === "remove" && link.status === "pending") return;
  await CalendarEventLink.updateOne(
    { _id: link._id },
    { $set: { want: "remove", status: "pending", nextAttemptAt: now, attempts: 0, leaseUntil: null, lastError: null, lastErrorAt: null, updatedAt: now }, $inc: { revision: 1 } },
    { session: session ?? undefined }
  );
}

/** After a person connects (or reconnects): queue every open follow-up they own. Idempotent. */
export async function queueAllOpenTasksFor(companyId: number, userId: number, now: Date = new Date()): Promise<number> {
  const tasks = await FollowUpTask.find({ companyId, ownerId: userId, status: "open" }).select("_id").lean<Array<{ _id: Id }>>();
  for (const task of tasks) await queueCalendarSync(undefined, companyId, String(task._id), now);
  return tasks.length;
}

// ── sending one link ─────────────────────────────────────────────────────────────────────────────────────────────

type ConnectionRow = IGoogleCalendarConnection & { _id: Id };

interface Outcome {
  kind: "synced" | "deleted" | "removed_in_google" | "retry" | "error" | "reconnect" | "paused";
  message?: string;
  retryAfterMs?: number | null;
  existsInGoogle?: boolean;
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Unknown error").slice(0, 300);

async function ensureCalendar(connection: ConnectionRow, token: string, now: Date): Promise<string> {
  if (connection.calendarId) return connection.calendarId;
  const user = await AdminUser.findOne({ _id: connection.userId }).select("timeZone").lean<{ timeZone?: string | null }>();
  const zone = resolveFollowUpTimeZone(user?.timeZone ?? null);
  const config = googleCalendarConfig();
  const description = "Your CRM follow-ups, kept up to date by Whyte CRM. Edit follow-ups in the CRM: changes made here are not saved back.";
  let created;
  try {
    created = await insertCalendar(config, token, { summary: CALENDAR_NAME, description, timeZone: zone });
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.kind !== "invalid") throw error;
    created = await insertCalendar(config, token, { summary: CALENDAR_NAME, description }); // Google did not like the zone name: let it use its own
  }
  await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { calendarId: created.id, calendarSummary: created.summary, updatedAt: now } });
  connection.calendarId = created.id;
  return created.id;
}

async function send(link: ICalendarEventLink, connection: ConnectionRow, now: Date): Promise<Outcome> {
  const config = googleCalendarConfig();
  const task = await FollowUpTask.findOne({ _id: link.taskId, companyId: link.companyId }).select("leadId ownerId status dueAt").lean<{ leadId: string; ownerId: number; status: string; dueAt: Date }>();
  const lead = task ? await Lead.findOne({ _id: task.leadId, companyId: link.companyId }).select("referenceNumber customerName priority status").lean<{ referenceNumber: string; customerName: string; priority: string; status: string }>() : null;

  // The CRM decides what Google should show, every time: a stale queue entry can never send stale data.
  let want = link.want;
  if (want !== "remove" && (!task || !lead || task.ownerId !== link.userId || task.status === "cancelled" || lead.status === "won" || lead.status === "lost")) want = "remove";

  const fromError = (error: unknown): Outcome => {
    if (error instanceof ReconnectNeededError) return { kind: "reconnect", message: error.message };
    if (error instanceof GoogleApiError) return error.retryable ? { kind: "retry", message: error.message, retryAfterMs: error.retryAfterMs } : { kind: "error", message: error.message };
    throw error;
  };
  let token: string;
  try {
    token = await accessTokenFor(connection, now);
  } catch (error) {
    return fromError(error);
  }

  const perform = async (token: string): Promise<Outcome> => {
    if (want === "remove") {
      if (link.existsInGoogle && connection.calendarId) {
        try {
          await deleteEvent(config, token, connection.calendarId, link.eventId);
        } catch (error) {
          if (!(error instanceof GoogleApiError) || error.kind !== "not_found") throw error;
        }
      }
      return { kind: "deleted" };
    }

    if (!task || !lead) return { kind: "deleted" };
    const body = buildEventBody(link.eventId, {
      taskId: link.taskId,
      referenceNumber: lead.referenceNumber,
      customerName: lead.customerName,
      priority: lead.priority,
      dueAt: new Date(task.dueAt),
      completed: want === "complete",
      minutes: connection.eventMinutes,
      timeZone: "UTC",
      appBaseUrl: config.appBaseUrl,
    });

    const insertOrAdopt = async (calendarId: string) => {
      try {
        await insertEvent(config, token, calendarId, body);
      } catch (error) {
        // The same id already exists (a retried insert, or an event that was deleted earlier): make it the current one.
        if (error instanceof GoogleApiError && error.kind === "conflict") await patchEvent(config, token, calendarId, link.eventId, { ...body, id: undefined });
        else throw error;
      }
    };

    if (link.existsInGoogle && connection.calendarId) {
      try {
        // An ordinary update never sets `status`: an event the person deleted in Google must not come back by itself.
        await patchEvent(config, token, connection.calendarId, link.eventId, { ...body, id: undefined, status: undefined });
      } catch (error) {
        if (error instanceof GoogleApiError && error.kind === "not_found") return { kind: "removed_in_google", message: "The event was deleted in Google Calendar. The CRM follow-up is unchanged." };
        throw error;
      }
      return { kind: "synced", existsInGoogle: true };
    }

    let calendarId = await ensureCalendar(connection, token, now);
    try {
      await insertOrAdopt(calendarId);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== "not_found") throw error;
      // The whole calendar is gone (deleted in Google): make a new one, once, and put the event in it.
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { calendarId: null, calendarSummary: null } });
      connection.calendarId = null;
      calendarId = await ensureCalendar(connection, token, now);
      await insertOrAdopt(calendarId);
    }
    return { kind: "synced", existsInGoogle: true };
  };

  try {
    try {
      return await perform(token);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== "auth") throw error;
      // Google refused the stored access token (revoked early, clock skew): forget it, get a fresh one, and try once more.
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { accessTokenSealed: null, accessTokenExpiresAt: null } });
      return await perform(await accessTokenFor({ ...connection, accessTokenSealed: null, accessTokenExpiresAt: null }, now));
    }
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "auth") return { kind: "retry", message: "Google refused the access token; trying again later.", retryAfterMs: 5_000 };
    return fromError(error);
  }
}

async function settle(link: ICalendarEventLink, connection: ConnectionRow, outcome: Outcome, now: Date): Promise<void> {
  const lease = { leaseUntil: null, updatedAt: now };
  const sameRevision = { _id: link._id, revision: link.revision };
  switch (outcome.kind) {
    case "synced":
      // If the follow-up changed while we were sending, the link stays pending for another pass.
      await CalendarEventLink.updateOne(sameRevision, { $set: { status: "synced", existsInGoogle: outcome.existsInGoogle ?? true, attempts: 0, lastError: null, lastErrorAt: null, lastSyncedAt: now, ...lease } });
      await CalendarEventLink.updateOne({ _id: link._id, revision: { $ne: link.revision } }, { $set: { existsInGoogle: true, nextAttemptAt: now, ...lease } });
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { lastSyncAt: now, lastError: null, lastErrorAt: null, updatedAt: now } });
      return;
    case "deleted":
      await CalendarEventLink.deleteOne(sameRevision);
      await CalendarEventLink.updateOne({ _id: link._id, revision: { $ne: link.revision } }, { $set: { existsInGoogle: false, nextAttemptAt: now, ...lease } });
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { lastSyncAt: now, updatedAt: now } });
      return;
    case "removed_in_google":
      await CalendarEventLink.updateOne({ _id: link._id }, { $set: { status: "removed_in_google", existsInGoogle: false, attempts: 0, lastError: outcome.message ?? null, lastErrorAt: now, ...lease } });
      return;
    case "reconnect":
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { status: "needs_reconnect", lastError: outcome.message ?? "Google access ended.", lastErrorAt: now, accessTokenSealed: null, accessTokenExpiresAt: null, updatedAt: now } });
      await CalendarEventLink.updateOne({ _id: link._id }, { $set: { nextAttemptAt: new Date(now.getTime() + RECONNECT_RECHECK_MS), ...lease } });
      return;
    case "paused":
      await CalendarEventLink.updateOne({ _id: link._id }, { $set: { nextAttemptAt: new Date(now.getTime() + RECONNECT_RECHECK_MS), ...lease } });
      return;
    case "retry": {
      const attempts = link.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await CalendarEventLink.updateOne({ _id: link._id }, { $set: { status: "error", attempts, lastError: outcome.message ?? "Gave up after repeated failures.", lastErrorAt: now, ...lease } });
      } else {
        await CalendarEventLink.updateOne({ _id: link._id }, { $set: { attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, outcome.retryAfterMs ?? null)), lastError: outcome.message ?? null, lastErrorAt: now, ...lease } });
      }
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { lastError: outcome.message ?? null, lastErrorAt: now, updatedAt: now } });
      return;
    }
    case "error":
      await CalendarEventLink.updateOne({ _id: link._id }, { $set: { status: "error", lastError: outcome.message ?? "Google refused this event.", lastErrorAt: now, ...lease } });
      await GoogleCalendarConnection.updateOne({ _id: connection._id }, { $set: { lastError: outcome.message ?? null, lastErrorAt: now, updatedAt: now } });
      return;
  }
}

/** Sends one leased link. Never throws: an unexpected failure becomes a retry so the item is not lost. */
export async function processLink(link: ICalendarEventLink, now: Date = new Date()): Promise<Outcome["kind"]> {
  const connection = await GoogleCalendarConnection.findOne({ _id: link.connectionId, companyId: link.companyId }).lean<ConnectionRow>();
  if (!connection || connection.status === "disconnected") {
    await CalendarEventLink.deleteOne({ _id: link._id });
    return "deleted";
  }
  let outcome: Outcome;
  if (connection.status === "needs_reconnect") outcome = { kind: "paused" };
  else {
    try {
      outcome = await send(link, connection, now);
    } catch (error) {
      outcome = { kind: "retry", message: message(error) };
    }
  }
  await settle(link, connection, outcome, now);
  return outcome.kind;
}

// ── the worker ───────────────────────────────────────────────────────────────────────────────────────────────────

async function leaseNext(now: Date): Promise<ICalendarEventLink | null> {
  // The query must run (be awaited) INSIDE the unscoped callback, or it executes after the exemption has ended.
  return runUnscoped("calendar-sync-worker", async () =>
    await CalendarEventLink.findOneAndUpdate(
      { status: "pending", nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } },
      { sort: { nextAttemptAt: 1 }, returnDocument: "after" }
    ).lean<ICalendarEventLink>()
  );
}

const inCompany = <T>(companyId: number, userId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId, role: "admin", actingAsCompany: false }, fn);

export interface WorkerResult {
  processed: number;
  byOutcome: Record<string, number>;
  reconciled: { queued: number; removed: number; tornDown: number };
}

/** One worker pass: repair drift, then send what is due (bounded by count and time). */
export async function runWorker(options: { now?: Date; maxItems?: number; budgetMs?: number; skipReconcile?: boolean } = {}): Promise<WorkerResult> {
  await connectMongoDB();
  const startedAt = Date.now();
  const maxItems = options.maxItems ?? 100;
  const budgetMs = options.budgetMs ?? 45_000;
  const reconciled = options.skipReconcile ? { queued: 0, removed: 0, tornDown: 0 } : await reconcile(options.now ?? new Date());
  const byOutcome: Record<string, number> = {};
  let processed = 0;
  while (processed < maxItems && Date.now() - startedAt < budgetMs) {
    const now = options.now ?? new Date();
    const link = await leaseNext(now);
    if (!link) break;
    const kind = await inCompany(link.companyId, link.userId, () => processLink(link, now));
    byOutcome[kind] = (byOutcome[kind] ?? 0) + 1;
    processed += 1;
  }
  return { processed, byOutcome, reconciled };
}

// ── reconcile ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Repairs what the queue alone cannot know about: a lead closed or archived, an owner who was deactivated, a follow-up that
 * was never queued (it predates the connection, or a crash). Safe to run any number of times.
 */
export async function reconcile(now: Date = new Date()): Promise<WorkerResult["reconciled"]> {
  const stats = { queued: 0, removed: 0, tornDown: 0 };
  const companyIds = await runUnscoped("calendar-sync-worker", async () => await GoogleCalendarConnection.distinct("companyId", { status: { $in: ["connected", "needs_reconnect"] } }));
  for (const companyId of companyIds as number[]) {
    await inCompany(companyId, 0, async () => {
      const connections = await GoogleCalendarConnection.find({ companyId, status: { $in: ["connected", "needs_reconnect"] } }).lean<ConnectionRow[]>();
      const users = await AdminUser.find({ _id: { $in: connections.map((connection) => connection.userId) } }).select("isActive").lean<Array<{ _id: number; isActive?: boolean }>>();
      const inactive = new Set(users.filter((user) => user.isActive === false).map((user) => user._id));
      const known = new Set(users.map((user) => user._id));

      for (const connection of connections) {
        const links = await CalendarEventLink.find({ connectionId: connection._id }).lean<ICalendarEventLink[]>();
        if (inactive.has(connection.userId) || !known.has(connection.userId)) {
          // The person was deactivated: their events leave their calendar, then the connection ends.
          for (const link of links) await markForRemoval(link, null, now);
          const remaining = await CalendarEventLink.countDocuments({ connectionId: connection._id });
          if (remaining === 0) {
            await endConnection(connection, { deleteCalendar: false, reason: "The person was deactivated." }, now);
            stats.tornDown += 1;
          }
          continue;
        }
        if (connection.status !== "connected") continue;

        const open = await FollowUpTask.find({ companyId, ownerId: connection.userId, status: "open" }).select("leadId").lean<Array<{ _id: Id; leadId: string }>>();
        const leadIds = [...new Set([...open.map((task) => task.leadId), ...links.map((link) => link.leadId)])];
        const leads = await Lead.find({ companyId, _id: { $in: leadIds } }).select("status").lean<Array<{ _id: string; status: string }>>();
        const openLeads = new Set(leads.filter((lead) => lead.status !== "won" && lead.status !== "lost").map((lead) => lead._id));
        const linked = new Set(links.map((link) => link.taskId));

        for (const task of open) {
          if (linked.has(String(task._id)) || !openLeads.has(task.leadId)) continue;
          await queueCalendarSync(undefined, companyId, String(task._id), now);
          stats.queued += 1;
        }
        for (const link of links) {
          if (link.want === "remove" || link.status === "removed_in_google") continue;
          if (!openLeads.has(link.leadId)) {
            await markForRemoval(link, null, now);
            stats.removed += 1;
          }
        }
      }
    });
  }
  return stats;
}

// ── ending a connection ──────────────────────────────────────────────────────────────────────────────────────────

/** Ends a connection: tells Google to forget the grant, optionally deletes our calendar, drops tokens and queue entries. */
export async function endConnection(connection: ConnectionRow, options: { deleteCalendar: boolean; reason?: string }, now: Date = new Date()): Promise<{ revoked: boolean; calendarDeleted: boolean }> {
  const config = googleCalendarConfig();
  let calendarDeleted = false;
  let revoked = false;
  if (options.deleteCalendar && connection.calendarId && connection.status === "connected") {
    try {
      await deleteCalendar(config, await accessTokenFor(connection, now), connection.calendarId);
      calendarDeleted = true;
    } catch {
      calendarDeleted = false;
    }
  }
  if (connection.refreshTokenSealed) {
    try {
      revoked = await revokeToken(config, openToken(connection.refreshTokenSealed, refreshAad(connection._id)));
    } catch {
      revoked = false;
    }
  }
  await CalendarEventLink.deleteMany({ connectionId: connection._id });
  await GoogleCalendarConnection.updateOne(
    { _id: connection._id },
    {
      $set: {
        status: "disconnected",
        refreshTokenSealed: null,
        accessTokenSealed: null,
        accessTokenExpiresAt: null,
        pendingAuth: null,
        googleSub: null,
        disconnectedAt: now,
        lastError: options.reason ?? null,
        lastErrorAt: options.reason ? now : null,
        ...(calendarDeleted ? { calendarId: null, calendarSummary: null } : {}),
        updatedAt: now,
      },
    }
  );
  return { revoked, calendarDeleted };
}

// ── what the screens show ────────────────────────────────────────────────────────────────────────────────────────

export interface SyncSummary {
  counts: { pending: number; synced: number; error: number; removedInGoogle: number };
  problems: Array<{ linkId: string; leadId: string; customerName: string | null; status: string; message: string | null }>;
}

export async function summarizeSync(companyId: number, userId: number): Promise<SyncSummary> {
  const grouped = await CalendarEventLink.aggregate<{ _id: string; n: number }>([{ $match: { companyId, userId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const count = (status: string) => grouped.find((entry) => entry._id === status)?.n ?? 0;
  const bad = await CalendarEventLink.find({ companyId, userId, status: { $in: ["error", "removed_in_google"] } }).sort({ updatedAt: -1 }).limit(20).lean<ICalendarEventLink[]>();
  const leads = await Lead.find({ companyId, _id: { $in: bad.map((link) => link.leadId) } }).select("customerName").lean<Array<{ _id: string; customerName: string }>>();
  const names = new Map(leads.map((lead) => [lead._id, lead.customerName]));
  return {
    counts: { pending: count("pending"), synced: count("synced"), error: count("error"), removedInGoogle: count("removed_in_google") },
    problems: bad.map((link) => ({ linkId: link._id, leadId: link.leadId, customerName: names.get(link.leadId) ?? null, status: link.status, message: link.lastError })),
  };
}

/** "Try again" / "Add it back": returns failed or deleted-in-Google items to the queue. `linkId` limits it to one. */
export async function retryLinks(companyId: number, userId: number, options: { linkId?: string } = {}, now: Date = new Date()): Promise<number> {
  const failed: Array<"error" | "removed_in_google"> = ["error", "removed_in_google"];
  const filter = { companyId, userId, status: { $in: failed }, ...(options.linkId ? { _id: options.linkId } : {}) };
  const result = await CalendarEventLink.updateMany(filter, { $set: { status: "pending", attempts: 0, nextAttemptAt: now, leaseUntil: null, lastError: null, lastErrorAt: null, existsInGoogle: false, updatedAt: now }, $inc: { revision: 1 } });
  return result.modifiedCount;
}
