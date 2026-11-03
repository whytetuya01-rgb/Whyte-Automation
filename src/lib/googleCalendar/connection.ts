import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { connectMongoDB } from "@/lib/mongodb";
import { assertIndexesDeployed } from "@/lib/mongoIndexPolicy";
import { resolveFollowUpTimeZone } from "@/lib/followUps";
import { AdminUser, CalendarEventLink, GoogleCalendarConnection, type IGoogleCalendarConnection } from "@/models";
import { googleCalendarConfig } from "./config";
import { GoogleApiError, buildAuthUrl, exchangeCode, grantsCalendarAccess, insertCalendar, readIdentity, revokeToken, type TokenSet } from "./client";
import { openToken, sealToken, sha256Hex } from "./crypto";
import { chooseEventMinutes, EVENT_MINUTES_CHOICES } from "./eventMapper";
import { CALENDAR_NAME, endConnection, queueAllOpenTasksFor, summarizeSync, type SyncSummary } from "./sync";
import { accessAad, connectionIdFor, pkceAad, refreshAad } from "./tokens";

/** A person's own Google connection: connect (OAuth), disconnect, settings, status. Always about the signed-in person only. */

export interface Who {
  companyId: number;
  userId: number;
}

const PENDING_MS = 10 * 60_000;
const isDuplicateKey = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
type Row = IGoogleCalendarConnection & { _id: string };

export const requiredGoogleIndexes = async () => {
  await assertIndexesDeployed(GoogleCalendarConnection, ["one_google_connection_per_user", "one_user_per_google_account"]);
  await assertIndexesDeployed(CalendarEventLink, ["one_link_per_task_and_connection"]);
};

async function ensureRow(who: Who, now: Date): Promise<Row> {
  const id = connectionIdFor(who.companyId, who.userId);
  const found = await GoogleCalendarConnection.findOne({ _id: id }).lean<Row>();
  if (found) return found;
  try {
    await GoogleCalendarConnection.create({ _id: id, companyId: who.companyId, userId: who.userId, status: "disconnected", createdAt: now, updatedAt: now });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return (await GoogleCalendarConnection.findOne({ _id: id }).lean<Row>()) as Row;
}

/** Who may connect Google: people who own follow-ups (not dealers, Sales Executives or a platform admin outside a company). */
export function canConnectGoogle(role: string, permissions: string[]): boolean {
  if (role === "dealer" || role === "sales_executive" || role === "sales") return false;
  return hasPermission(role, permissions, "leads:manage");
}

const b64url = (buffer: Buffer) => buffer.toString("base64url");

/** Step 1: a one-time state and PKCE challenge, bound to this person, and the Google consent URL. */
export async function beginConnect(who: Who, now: Date = new Date()): Promise<{ url: string }> {
  const config = googleCalendarConfig();
  if (!config.configured) throw new ApiError("SERVICE_UNAVAILABLE", "Google Calendar is not set up on this server yet. Ask your administrator.");
  await connectMongoDB();
  await requiredGoogleIndexes();
  const row = await ensureRow(who, now);
  const state = b64url(randomBytes(32));
  const verifier = config.usePkce ? b64url(randomBytes(48)) : null;
  await GoogleCalendarConnection.updateOne(
    { _id: row._id },
    { $set: { pendingAuth: { stateHash: sha256Hex(state), verifierSealed: verifier ? sealToken(verifier, pkceAad(row._id)) : null, expiresAt: new Date(now.getTime() + PENDING_MS) }, updatedAt: now } }
  );
  const challenge = verifier ? b64url(createHash("sha256").update(verifier).digest()) : null;
  return { url: buildAuthUrl(config, { state, challenge }) };
}

export type ConnectFailure = "denied" | "state" | "scope" | "email" | "no_refresh" | "account_in_use" | "google";
export type ConnectResult = { ok: true; email: string } | { ok: false; reason: ConnectFailure };

/**
 * Step 2 (Google sends the browser back with a code): the state must be the one issued to THIS signed-in person, unused and
 * fresh; the calendar permission must really have been granted; the Google account must have a verified email. Never throws:
 * every failure is a reason the page can explain.
 */
export async function completeConnect(who: Who, input: { code: string | null; state: string | null; error: string | null }, now: Date = new Date()): Promise<ConnectResult> {
  await connectMongoDB();
  const id = connectionIdFor(who.companyId, who.userId);
  if (!input.state) return { ok: false, reason: "state" };
  // Single use: the pending state is cleared in the same step that checks it, so a replayed callback finds nothing.
  const row = await GoogleCalendarConnection.findOneAndUpdate(
    { _id: id, "pendingAuth.stateHash": sha256Hex(input.state), "pendingAuth.expiresAt": { $gt: now } },
    { $set: { pendingAuth: null, updatedAt: now } },
    { returnDocument: "before" }
  ).lean<Row>();
  if (!row?.pendingAuth) return { ok: false, reason: "state" };
  if (input.error || !input.code) return { ok: false, reason: input.error === "access_denied" || !input.error ? "denied" : "google" };

  const config = googleCalendarConfig();
  let issued: TokenSet | null = null;
  // A connection we refuse after Google issued tokens must not leave a live grant behind at Google: revoke what we were given.
  const refuse = async (reason: ConnectFailure): Promise<ConnectResult> => {
    if (issued) await revokeToken(config, issued.refreshToken ?? issued.accessToken);
    return { ok: false, reason };
  };
  try {
    const verifier = row.pendingAuth.verifierSealed ? openToken(row.pendingAuth.verifierSealed, pkceAad(id)) : null;
    const tokens = await exchangeCode(config, { code: input.code, verifier });
    issued = tokens;
    if (!grantsCalendarAccess(tokens.scopes)) return await refuse("scope");
    const identity = readIdentity(tokens.idToken, config, now);
    if (!identity.emailVerified) return await refuse("email");
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) return await refuse("no_refresh");

    const keepCalendar = row.calendarId && row.calendarOwnerSub === identity.sub;
    let calendarId = keepCalendar ? row.calendarId : null;
    let calendarSummary = keepCalendar ? row.calendarSummary : null;
    if (!keepCalendar) await CalendarEventLink.deleteMany({ connectionId: id }); // another Google account: nothing sent to the old one counts
    if (!calendarId) {
      const user = await AdminUser.findOne({ _id: who.userId }).select("timeZone").lean<{ timeZone?: string | null }>();
      const zone = resolveFollowUpTimeZone(user?.timeZone ?? null);
      const description = "Your CRM follow-ups, kept up to date by Whyte CRM. Edit follow-ups in the CRM: changes made here are not saved back.";
      let created;
      try {
        created = await insertCalendar(config, tokens.accessToken, { summary: CALENDAR_NAME, description, timeZone: zone });
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.kind !== "invalid") throw error;
        created = await insertCalendar(config, tokens.accessToken, { summary: CALENDAR_NAME, description });
      }
      calendarId = created.id;
      calendarSummary = created.summary;
    }

    try {
      await GoogleCalendarConnection.updateOne(
        { _id: id },
        {
          $set: {
            status: "connected",
            googleSub: identity.sub,
            googleEmail: identity.email,
            scopes: tokens.scopes,
            refreshTokenSealed: sealToken(refreshToken, refreshAad(id)),
            accessTokenSealed: sealToken(tokens.accessToken, accessAad(id)),
            accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSec * 1000),
            calendarId,
            calendarSummary,
            calendarOwnerSub: identity.sub,
            connectedAt: now,
            disconnectedAt: null,
            lastError: null,
            lastErrorAt: null,
            updatedAt: now,
          },
        }
      );
    } catch (error) {
      if (isDuplicateKey(error)) return await refuse("account_in_use");
      throw error;
    }
    await queueAllOpenTasksFor(who.companyId, who.userId, now);
    return { ok: true, email: identity.email };
  } catch (error) {
    console.error("[google-calendar] connect failed:", error instanceof Error ? error.message : "unknown");
    return await refuse("google");
  }
}

/** Ends the connection. Our dedicated calendar is deleted only if asked. Local data is cleared even if Google cannot be reached. */
export async function disconnect(who: Who, options: { deleteCalendar: boolean }, now: Date = new Date()): Promise<{ wasConnected: boolean; revoked: boolean; calendarDeleted: boolean }> {
  await connectMongoDB();
  const row = await GoogleCalendarConnection.findOne({ _id: connectionIdFor(who.companyId, who.userId) }).lean<Row>();
  if (!row || row.status === "disconnected") return { wasConnected: false, revoked: false, calendarDeleted: false };
  const result = await endConnection(row, { deleteCalendar: options.deleteCalendar }, now);
  return { wasConnected: true, ...result };
}

export async function updateSettings(who: Who, input: { eventMinutes: number }, now: Date = new Date()): Promise<{ eventMinutes: number }> {
  if (!(EVENT_MINUTES_CHOICES as readonly number[]).includes(input.eventMinutes)) {
    throw new ApiError("VALIDATION_ERROR", `Choose one of: ${EVENT_MINUTES_CHOICES.join(", ")} minutes.`, { field: "eventMinutes" });
  }
  await connectMongoDB();
  const id = connectionIdFor(who.companyId, who.userId);
  const row = await ensureRow(who, now);
  const minutes = chooseEventMinutes(input.eventMinutes);
  if (row.eventMinutes !== minutes) {
    await GoogleCalendarConnection.updateOne({ _id: id }, { $set: { eventMinutes: minutes, updatedAt: now } });
    // Events already in Google get the new length.
    await CalendarEventLink.updateMany({ connectionId: id, status: "synced", want: { $ne: "remove" } }, { $set: { status: "pending", nextAttemptAt: now, attempts: 0 }, $inc: { revision: 1 } });
  }
  return { eventMinutes: minutes };
}

export interface ConnectionStatus {
  configured: boolean;
  status: "not_connected" | "connected" | "needs_reconnect";
  email: string | null;
  calendarName: string | null;
  eventMinutes: number;
  eventMinutesChoices: readonly number[];
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  sync: SyncSummary;
}

export async function getStatus(who: Who): Promise<ConnectionStatus> {
  await connectMongoDB();
  const row = await GoogleCalendarConnection.findOne({ _id: connectionIdFor(who.companyId, who.userId) }).lean<Row>();
  const connected = row && row.status !== "disconnected";
  const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);
  return {
    configured: googleCalendarConfig().configured,
    status: !connected ? "not_connected" : row.status === "needs_reconnect" ? "needs_reconnect" : "connected",
    email: connected ? row.googleEmail : null,
    calendarName: connected ? row.calendarSummary : null,
    eventMinutes: row?.eventMinutes ?? 30,
    eventMinutesChoices: EVENT_MINUTES_CHOICES,
    connectedAt: connected ? iso(row.connectedAt) : null,
    lastSyncAt: connected ? iso(row.lastSyncAt) : null,
    lastError: connected ? row.lastError : null,
    sync: connected ? await summarizeSync(who.companyId, who.userId) : { counts: { pending: 0, synced: 0, error: 0, removedInGoogle: 0 }, problems: [] },
  };
}
