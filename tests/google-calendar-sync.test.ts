/**
 * The Google Calendar integration end to end below the HTTP layer: a real throwaway local MongoDB, the real follow-up service
 * and sync engine, and the mock Google server on loopback. No real Google, no real credentials.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/google-calendar-sync.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { AdminUser, CalendarEventLink, Company, CrmActivity, FollowUpTask, GoogleCalendarConnection, Lead } from "../src/models";
import { withRequiredTransaction } from "../src/lib/transaction";
import { applyLeadFormFollowUp, completeFollowUp, type FollowUpActor, type FollowUpContext } from "../src/lib/followUpService";
import { beginConnect, completeConnect, disconnect, getStatus, updateSettings } from "../src/lib/googleCalendar/connection";
import { MAX_ATTEMPTS, reconcile, retryLinks, runWorker } from "../src/lib/googleCalendar/sync";
import { openToken } from "../src/lib/googleCalendar/crypto";
import { eventIdFor } from "../src/lib/googleCalendar/eventMapper";
import { connectionIdFor, refreshAad } from "../src/lib/googleCalendar/tokens";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMockGoogle } = require("./helpers/mockGoogle.cjs");

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const A = 9840;
const B = 9841;
const U1 = 9921;
const U2 = 9922;
const U3 = 9923; // never connects Google
const UB = 9924;
const RUN = randomBytes(3).toString("hex");
const MIN = 60_000;
const SECRETS = { phone: "9876543210", note: "customer will pay 4,50,000 if we give 12% off", place: "Surat Vesu", project: "4 BHK duplex" };

const accounts = {
  u1: { email: "user.one@gmail.test", sub: "sub-one" },
  u2: { email: "user.two@gmail.test", sub: "sub-two" },
  ub: { email: "user.b@gmail.test", sub: "sub-b" },
};

const inCompany = <T>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false }, async () => await fn());
const actorOf = (userId: number, companyId = A): FollowUpActor => ({ userId, role: "admin", permissions: [], companyId });
const in2 = (days: number) => new Date(Date.now() + days * 86_400_000);

async function main() {
  const mock = createMockGoogle();
  await mock.start();
  Object.assign(process.env, mock.env(), { GOOGLE_CALENDAR_TOKEN_KEY: randomBytes(32).toString("base64") });
  delete process.env.APP_BASE_URL;

  await connectMongoDB();
  await Promise.all([CalendarEventLink.init(), GoogleCalendarConnection.init(), FollowUpTask.init()]);

  const userIds = [U1, U2, U3, UB];
  const cleanup = async () => {
    await Company.collection.deleteMany({ _id: { $in: [A, B] } as never });
    await AdminUser.collection.deleteMany({ _id: { $in: userIds } as never });
    for (const collection of [Lead.collection, FollowUpTask.collection, CrmActivity.collection, CalendarEventLink.collection, GoogleCalendarConnection.collection]) {
      await collection.deleteMany({ companyId: { $in: [A, B] } as never });
    }
  };
  await cleanup();
  const stamp = new Date();
  await Company.collection.insertMany([
    { _id: A as never, name: "Sync A", slug: `sync-a-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
    { _id: B as never, name: "Sync B", slug: `sync-b-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
  ]);
  await AdminUser.collection.insertMany(
    [
      { _id: U1, companyId: A, name: "User One", timeZone: undefined },
      { _id: U2, companyId: A, name: "User Two", timeZone: "America/New_York" },
      { _id: U3, companyId: A, name: "User Three" },
      { _id: UB, companyId: B, name: "User B" },
    ].map((user) => ({ ...user, email: `u${user._id}.${RUN}@s.test`, role: "admin", isActive: true, createdAt: stamp, updatedAt: stamp })) as never
  );

  let sequence = 0;
  const newLead = async (id: string, companyId = A, extra: Record<string, unknown> = {}) => {
    await Lead.collection.insertOne({
      _id: `L_${id}` as never, companyId, referenceNumber: `LD-S-${RUN}-${++sequence}`, customerName: `Customer ${id}`, phone: SECRETS.phone, notes: SECRETS.note,
      location: SECRETS.place, projectType: SECRETS.project, estimatedBudget: 450000, status: "contacted", priority: "high", createdBy: U1, createdAt: stamp, updatedAt: stamp, nextFollowUpAt: null, ...extra,
    });
    return `L_${id}`;
  };
  const mutate = (companyId: number, userId: number, leadId: string, fn: (ctx: FollowUpContext, lead: InstanceType<typeof Lead>) => Promise<void>) =>
    inCompany(companyId, () =>
      withRequiredTransaction(async (session) => {
        const lead = await Lead.findOne({ _id: leadId, companyId }).session(session ?? null);
        await fn({ actor: actorOf(userId, companyId), session }, lead as InstanceType<typeof Lead>);
        await (lead as InstanceType<typeof Lead>).save({ session });
      })
    );
  const schedule = (leadId: string, ownerId: number, due: Date, companyId = A) => mutate(companyId, ownerId, leadId, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: due, ownerId }));
  const link = (leadId: string) => CalendarEventLink.collection.findOne({ leadId }) as Promise<Record<string, unknown> | null>;
  const task = (leadId: string) => FollowUpTask.collection.findOne({ leadId, status: "open" }) as Promise<Record<string, unknown> | null>;
  const connectionOf = (userId: number, companyId = A) => GoogleCalendarConnection.collection.findOne({ _id: connectionIdFor(companyId, userId) as never }) as Promise<Record<string, unknown> | null>;
  const calendarOf = async (userId: number, companyId = A) => (await connectionOf(userId, companyId))?.calendarId as string;
  const work = (now?: Date) => runWorker({ now, skipReconcile: true });
  // The event a person's calendar holds for a lead's latest follow-up (found by its derived id, so it works after the queue entry is gone).
  const eventFor = async (userId: number, leadId: string, companyId = A) => {
    const tasks = (await FollowUpTask.collection.find({ leadId }).sort({ createdAt: -1, _id: -1 }).toArray()) as unknown as Array<{ _id: string }>;
    const events = mock.allEvents(await calendarOf(userId, companyId));
    for (const t of tasks) {
      const found = events.find((event: { id: string }) => event.id === eventIdFor(connectionIdFor(companyId, userId), String(t._id)));
      if (found) return found;
    }
    return undefined;
  };

  const connect = async (userId: number, account: { email: string; sub: string }, companyId = A, options: Record<string, unknown> = {}) => {
    const { url } = await inCompany(companyId, () => beginConnect({ companyId, userId }));
    const approved = mock.authorize(url, account, options);
    const result = await inCompany(companyId, () => completeConnect({ companyId, userId }, { code: approved.code, state: approved.state, error: null }));
    return { url, approved, result };
  };

  try {
    // ═══ connecting ═══
    const begun = await inCompany(A, () => beginConnect({ companyId: A, userId: U1 }));
    const params = new URL(begun.url).searchParams;
    assert.equal(params.get("scope"), "openid email https://www.googleapis.com/auth/calendar.app.created");
    assert.deepEqual(["access_type", "prompt", "code_challenge_method", "response_type"].map((k) => params.get(k)), ["offline", "consent", "S256", "code"]);
    const pending = ((await connectionOf(U1))?.pendingAuth ?? {}) as { stateHash: string; verifierSealed: string; expiresAt: Date };
    assert.ok(pending.stateHash && pending.stateHash !== params.get("state") && /^[0-9a-f]{64}$/.test(pending.stateHash), "only a hash of the state is stored");
    assert.ok(pending.verifierSealed.startsWith("v1."), "the PKCE verifier is stored sealed");
    assert.ok(pending.expiresAt.getTime() - Date.now() <= 10 * MIN + 1000);

    const first = mock.authorize(begun.url, accounts.u1);
    // a callback for a different person (no pending connect of their own) is refused
    assert.deepEqual(await inCompany(A, () => completeConnect({ companyId: A, userId: U2 }, { code: first.code, state: first.state, error: null })), { ok: false, reason: "state" }, "the state is bound to the person who started");
    assert.deepEqual(await inCompany(B, () => completeConnect({ companyId: B, userId: UB }, { code: first.code, state: first.state, error: null })), { ok: false, reason: "state" }, "and to their company");
    assert.deepEqual(await inCompany(A, () => completeConnect({ companyId: A, userId: U1 }, { code: first.code, state: "forged", error: null })), { ok: false, reason: "state" });
    assert.equal((await connectionOf(U1))?.status, "disconnected", "nothing was connected by any of that");
    const ok = await inCompany(A, () => completeConnect({ companyId: A, userId: U1 }, { code: first.code, state: first.state, error: null }));
    assert.deepEqual(ok, { ok: true, email: accounts.u1.email });
    assert.deepEqual(await inCompany(A, () => completeConnect({ companyId: A, userId: U1 }, { code: first.code, state: first.state, error: null })), { ok: false, reason: "state" }, "a callback works once: a replay finds nothing");

    const stored = await connectionOf(U1);
    assert.equal(stored?.status, "connected");
    assert.equal(stored?.googleEmail, accounts.u1.email);
    assert.equal(stored?.pendingAuth, null);
    const rawDoc = JSON.stringify(stored);
    for (const plain of [...mock.state.refreshTokens.keys(), ...mock.state.accessTokens.keys()]) assert.ok(!rawDoc.includes(plain), "no Google token is stored in the clear");
    assert.ok([...mock.state.refreshTokens.keys()].includes(openToken(stored?.refreshTokenSealed as string, refreshAad(connectionIdFor(A, U1)))), "the stored refresh token decrypts to the real one");
    const calendars = mock.calendarsNamed("Whyte CRM Follow-ups");
    assert.equal(calendars.length, 1);
    assert.equal(stored?.calendarId, calendars[0]);
    assert.equal(mock.state.calendars.get(calendars[0]).timeZone, "Asia/Kolkata", "the calendar uses the person's time zone (India until they choose)");
    pass("connecting: one-time state bound to the person and company, PKCE, tokens stored only encrypted, a dedicated calendar created in their time zone");

    for (const [label, options, expected] of [
      ["the calendar box unticked on Google's screen", { scopes: ["openid", "email"] }, "scope"],
      ["no refresh token issued", { refresh: false }, "no_refresh"],
    ] as const) {
      const attempt = await connect(U2, accounts.u2, A, options);
      assert.deepEqual(attempt.result, { ok: false, reason: expected }, label);
      assert.equal((await connectionOf(U2))?.status, "disconnected", `${label}: not connected`);
      assert.equal((await connectionOf(U2))?.refreshTokenSealed, null, `${label}: nothing stored`);
    }
    const unverified = await connect(U2, { ...accounts.u2, emailVerified: false } as never);
    assert.deepEqual(unverified.result, { ok: false, reason: "email" });
    const forgedIssuer = await connect(U2, accounts.u2, A, { iss: "https://evil.example.com" });
    assert.deepEqual(forgedIssuer.result, { ok: false, reason: "google" }, "an identity from the wrong issuer is refused");
    const denied = await inCompany(A, async () => {
      const { url } = await beginConnect({ companyId: A, userId: U2 });
      const state = new URL(url).searchParams.get("state");
      return completeConnect({ companyId: A, userId: U2 }, { code: null, state, error: "access_denied" });
    });
    assert.deepEqual(denied, { ok: false, reason: "denied" }, "pressing Cancel on Google's screen");
    await inCompany(A, () => beginConnect({ companyId: A, userId: U2 }));
    await GoogleCalendarConnection.collection.updateOne({ _id: connectionIdFor(A, U2) as never }, { $set: { "pendingAuth.expiresAt": new Date(Date.now() - 1000) } });
    const expiredState = new URL((await inCompany(A, () => beginConnect({ companyId: A, userId: U2 }))).url).searchParams.get("state");
    await GoogleCalendarConnection.collection.updateOne({ _id: connectionIdFor(A, U2) as never }, { $set: { "pendingAuth.expiresAt": new Date(Date.now() - 1000) } });
    assert.deepEqual(await inCompany(A, () => completeConnect({ companyId: A, userId: U2 }, { code: "x", state: expiredState, error: null })), { ok: false, reason: "state" }, "an old state expires");
    const taken = await connect(U2, accounts.u1);
    assert.deepEqual(taken.result, { ok: false, reason: "account_in_use" }, "one Google account cannot serve two CRM people");
    assert.equal((await connectionOf(U2))?.status, "disconnected");
    pass("connecting is refused, cleanly and without storing anything, for: missing calendar permission, no refresh token, unverified email, wrong issuer, cancel, expired state, a Google account already used by someone else");

    // U2 connects properly (New York time zone), UB in the other company
    assert.equal((await connect(U2, accounts.u2)).result.ok, true);
    assert.equal(mock.state.calendars.get(await calendarOf(U2)).timeZone, "America/New_York");
    assert.equal((await connect(UB, accounts.ub, B)).result.ok, true);

    // ═══ the follow-up lifecycle reaches Google ═══
    const l1 = await newLead("l1");
    await schedule(l1, U1, in2(2));
    const queued = await link(l1);
    assert.deepEqual([queued?.status, queued?.want, queued?.existsInGoogle, queued?.userId], ["pending", "upsert", false, U1], "the change and its queue entry are saved together");
    assert.equal(mock.liveEvents(await calendarOf(U1)).length, 0, "nothing is sent while the CRM request is still being saved");
    const run1 = await work();
    assert.equal(run1.byOutcome.synced, 1);
    const synced = await link(l1);
    assert.deepEqual([synced?.status, synced?.existsInGoogle, synced?.attempts], ["synced", true, 0]);
    const event = await eventFor(U1, l1);
    assert.deepEqual([event.summary, event.status, event.transparency], ["Follow-up: Customer l1", "confirmed", "opaque"]);
    assert.equal(event.start.dateTime, new Date((await task(l1))?.dueAt as Date).toISOString());
    assert.ok((await connectionOf(U1))?.lastSyncAt, "last successful sync is recorded");
    const status = await inCompany(A, () => getStatus({ companyId: A, userId: U1 }));
    assert.deepEqual([status.status, status.email, status.calendarName, status.sync.counts.synced], ["connected", accounts.u1.email, "Whyte CRM Follow-ups", 1]);
    pass("a follow-up becomes a Google event after the CRM change is saved, with the sync state and last successful sync recorded");

    // reschedule moves the same event
    const newDue = in2(5);
    await mutate(A, U1, l1, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: newDue }));
    await work();
    assert.equal(mock.liveEvents(await calendarOf(U1)).length, 1, "still one event");
    assert.equal((await eventFor(U1, l1)).start.dateTime, newDue.toISOString(), "the same event moved");

    // done keeps a ticked event; the next follow-up is a separate event
    await mutate(A, U1, l1, (ctx, lead) => completeFollowUp(ctx, lead, { next: in2(9), note: "Called." }));
    await work();
    const events = mock.liveEvents(await calendarOf(U1));
    assert.deepEqual(events.map((e: { summary: string }) => e.summary).sort(), ["Follow-up: Customer l1", "✓ Follow-up: Customer l1"].sort(), "the done one is kept and ticked; the next is new");
    assert.equal(events.find((e: { summary: string }) => e.summary.startsWith("✓")).transparency, "transparent");

    // cancelling removes it
    await mutate(A, U1, l1, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: null }));
    await work();
    assert.deepEqual(mock.liveEvents(await calendarOf(U1)).map((e: { summary: string }) => e.summary), ["✓ Follow-up: Customer l1"], "a cancelled follow-up leaves the calendar");
    pass("rescheduling moves the same event; done keeps a ticked event; cancelling removes it");

    // an aborted CRM change leaves no queue entry behind
    const l2 = await newLead("l2");
    await assert.rejects(
      inCompany(A, () =>
        withRequiredTransaction(async (session) => {
          const lead = await Lead.findOne({ _id: l2, companyId: A }).session(session ?? null);
          await applyLeadFormFollowUp({ actor: actorOf(U1), session }, lead as InstanceType<typeof Lead>, { nextFollowUpAt: in2(3), ownerId: U1 });
          throw new Error("boom after scheduling");
        })
      ),
      /boom/
    );
    assert.equal(await link(l2), null, "the CRM change was rolled back, and so was its queue entry");
    assert.equal(await task(l2), null);
    pass("the queue entry is part of the CRM transaction: if the change is undone, so is the entry");

    // ═══ owner changes ═══
    const l3 = await newLead("l3");
    await schedule(l3, U1, in2(4));
    await work();
    assert.ok(await eventFor(U1, l3));
    await mutate(A, U1, l3, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { ownerId: U2 }));
    await work();
    assert.equal((await eventFor(U1, l3))?.status, "cancelled", "the previous owner's calendar no longer shows it");
    assert.equal(await CalendarEventLink.collection.countDocuments({ leadId: l3, userId: U1 }), 0);
    assert.equal((await eventFor(U2, l3))?.status, "confirmed", "the new owner's calendar does");
    await mutate(A, U1, l3, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { ownerId: U3 }));
    await work();
    assert.equal((await eventFor(U2, l3))?.status, "cancelled", "handed to someone without Google: the previous owner's event is removed, nothing is created");
    assert.equal(await CalendarEventLink.collection.countDocuments({ leadId: l3 }), 0);
    pass("changing the owner moves the event between calendars, and a person who has not connected Google gets none");

    // ═══ duplicate prevention ═══
    const l4 = await newLead("l4");
    await schedule(l4, U1, in2(6));
    await work();
    const sent = await link(l4);
    // pretend the process died after Google accepted the insert but before the link was saved
    await CalendarEventLink.collection.updateOne({ _id: sent?._id as never }, { $set: { status: "pending", existsInGoogle: false, nextAttemptAt: new Date(), leaseUntil: null } });
    const liveBefore = mock.liveEvents(await calendarOf(U1)).length;
    await work();
    assert.equal(mock.liveEvents(await calendarOf(U1)).length, liveBefore, "no second event: the same id is found (409) and adopted");
    assert.equal((await link(l4))?.status, "synced");
    // many at once, two workers at the same moment: each event is created exactly once
    const bulkLeads = await Promise.all(Array.from({ length: 8 }, async (_, i) => newLead(`bulk${i}`)));
    for (const id of bulkLeads) await schedule(id, U1, in2(7));
    mock.resetLog();
    await Promise.all([work(), work(), work()]);
    const inserts = mock.requests((r: { method: string; path: string }) => r.method === "POST" && r.path.endsWith("/events"));
    assert.equal(inserts.length, 8, "three workers, eight events, eight inserts");
    assert.equal(new Set(inserts.map((r: { body: { id: string } }) => r.body.id)).size, 8);
    pass("a crash between Google and the database cannot create a duplicate (deterministic id, 409 adopted); concurrent workers each send an item once");

    // ═══ retries ═══
    const l5 = await newLead("l5");
    await schedule(l5, U1, in2(8));
    mock.fail((r: { method: string; path: string }) => r.method === "POST" && r.path.endsWith("/events"), { status: 503 }, 2);
    const t0 = new Date();
    await work(t0);
    let row = await link(l5);
    assert.deepEqual([row?.status, row?.attempts], ["pending", 1], "a temporary failure keeps it queued");
    assert.ok((row?.nextAttemptAt as Date).getTime() >= t0.getTime() + 24_000, "and waits before retrying (backoff)");
    assert.ok(/./.test(row?.lastError as string));
    assert.equal((await work(new Date(t0.getTime() + 5_000))).processed, 0, "not retried before it is due");
    await work(new Date(t0.getTime() + 2 * MIN));
    row = await link(l5);
    assert.equal(row?.attempts, 2);
    assert.ok((row?.nextAttemptAt as Date).getTime() >= t0.getTime() + 2 * MIN + 48_000, "the wait doubles");
    await work(new Date(t0.getTime() + 10 * MIN));
    row = await link(l5);
    assert.deepEqual([row?.status, row?.attempts, row?.lastError], ["synced", 0, null], "it goes through once Google recovers");

    const l6 = await newLead("l6");
    await schedule(l6, U1, in2(8));
    mock.fail((r: { method: string; path: string }) => r.method === "POST" && r.path.endsWith("/events"), { status: 429, headers: { "Retry-After": "300" }, reason: "rateLimitExceeded" }, 1);
    const t1 = new Date();
    await work(t1);
    assert.ok(((await link(l6))?.nextAttemptAt as Date).getTime() >= t1.getTime() + 300_000, "Retry-After is respected");
    await work(new Date(t1.getTime() + 6 * MIN));

    const l7 = await newLead("l7");
    await schedule(l7, U1, in2(8));
    mock.fail((r: { method: string; path: string }) => r.method === "POST" && r.path.endsWith("/events"), { status: 400, body: { error: { code: 400, message: "Invalid value", errors: [{ reason: "invalid" }] } } }, 1);
    await work();
    row = await link(l7);
    assert.deepEqual([row?.status, row?.attempts], ["error", 0], "a refusal that cannot succeed is not retried forever");
    assert.match((await connectionOf(U1))?.lastError as string, /Invalid value/);
    const afterError = (await work()).processed;
    assert.equal(afterError, 0, "an item in error is left alone");
    const l7Link = row?._id as string;
    assert.equal(await inCompany(A, () => retryLinks(A, U1, { linkId: l7Link })), 1);
    await work();
    assert.equal((await link(l7))?.status, "synced", "'Try again' sends it");
    const failing = await inCompany(A, () => getStatus({ companyId: A, userId: U1 }));
    assert.equal(failing.sync.counts.error, 0);

    const l8 = await newLead("l8");
    await schedule(l8, U1, in2(8));
    mock.fail((r: { method: string; path: string }) => r.method === "POST" && r.path.endsWith("/events"), { status: 503 }, 999);
    let clock = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      clock += 7 * 3600_000;
      await work(new Date(clock));
    }
    row = await link(l8);
    assert.deepEqual([row?.status, row?.attempts], ["error", MAX_ATTEMPTS], "after the maximum number of attempts it stops and asks for a person");
    mock.clearFailures();
    pass("temporary failures retry with growing, jittered delays and recover; Retry-After is honoured; permanent refusals stop; failures can be retried by the person; there is a maximum");

    // ═══ token trouble ═══
    const l9 = await newLead("l9");
    await schedule(l9, U1, in2(3));
    mock.expireAccessTokens();
    mock.resetLog();
    await work();
    assert.equal((await link(l9))?.status, "synced", "a refused access token is refreshed and the call repeated within the same attempt");
    assert.equal(mock.requests((r: { path: string }) => r.path === "/token").length, 1, "exactly one refresh");

    mock.revokeGrant(accounts.u1.email);
    const l10 = await newLead("l10");
    await schedule(l10, U1, in2(3));
    mock.expireAccessTokens();
    await work();
    const lost = await connectionOf(U1);
    assert.equal(lost?.status, "needs_reconnect", "a revoked grant puts the connection in 'needs reconnect'");
    assert.equal(lost?.accessTokenSealed, null);
    assert.deepEqual([(await link(l10))?.status, await task(l10).then((t) => t?.status)], ["pending", "open"], "the follow-up is untouched and its sync waits");
    assert.equal((await inCompany(A, () => getStatus({ companyId: A, userId: U1 }))).status, "needs_reconnect");
    await schedule(await newLead("l11"), U1, in2(3));
    assert.equal(await CalendarEventLink.collection.countDocuments({ connectionId: connectionIdFor(A, U1), status: "pending" }) >= 2, true, "new follow-ups keep queueing while disconnected from Google");
    assert.equal((await connect(U1, accounts.u1)).result.ok, true, "reconnecting is the same flow");
    await work();
    assert.equal(await CalendarEventLink.collection.countDocuments({ connectionId: connectionIdFor(A, U1), status: "pending" }), 0, "everything that waited is sent");
    assert.equal((await eventFor(U1, l10))?.status, "confirmed");
    pass("a refused access token is refreshed and retried once; a revoked grant moves to 'needs reconnect' without losing anything, and reconnecting sends what waited");

    // ═══ Google-side deletions never touch the CRM ═══
    const l12 = await newLead("l12");
    await schedule(l12, U1, in2(3));
    await work();
    const cal1 = await calendarOf(U1);
    const doomed = await link(l12);
    mock.deleteEventAsUser(cal1, doomed?.eventId as string);
    await mutate(A, U1, l12, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: in2(4) }));
    await work();
    assert.equal((await link(l12))?.status, "removed_in_google", "we notice, and say so");
    assert.equal((await task(l12))?.status, "open", "the CRM follow-up is NOT completed or cancelled because the event was deleted");
    const dueBefore = (await task(l12))?.dueAt;
    mock.resetLog();
    await mutate(A, U1, l12, (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: in2(5) }));
    await work();
    assert.equal(mock.requests((r: { path: string }) => r.path.includes("/events")).length, 0, "and we do not keep recreating an event the person deleted");
    assert.notEqual((await task(l12))?.dueAt, dueBefore);
    const l12Link = (await link(l12))?._id as string;
    assert.equal(await inCompany(A, () => retryLinks(A, U1, { linkId: l12Link })), 1);
    await work();
    assert.equal((await eventFor(U1, l12))?.status, "confirmed", "'Add it back' restores the same event");
    assert.equal(mock.liveEvents(cal1).filter((e: { id: string }) => e.id === doomed?.eventId).length, 1);

    mock.deleteCalendarAsUser(cal1);
    const l13 = await newLead("l13");
    await schedule(l13, U1, in2(3));
    await work();
    const cal2 = await calendarOf(U1);
    assert.notEqual(cal2, cal1, "if the whole calendar was deleted a new one is created, once");
    assert.equal((await eventFor(U1, l13))?.status, "confirmed");
    assert.equal(mock.calendarsNamed("Whyte CRM Follow-ups").filter((id: string) => id === cal2).length, 1);
    pass("deleting an event or the calendar in Google never completes or cancels a CRM follow-up; a deleted event is not recreated until the person asks; a deleted calendar is replaced");

    // ═══ settings ═══
    await inCompany(A, () => updateSettings({ companyId: A, userId: U1 }, { eventMinutes: 90 }));
    await work();
    const long = await eventFor(U1, l13);
    assert.equal(new Date(long.end.dateTime).getTime() - new Date(long.start.dateTime).getTime(), 90 * MIN, "existing events get the new length");
    await assert.rejects(inCompany(A, () => updateSettings({ companyId: A, userId: U1 }, { eventMinutes: 7 })), /Choose one of/);
    pass("the event length setting applies to existing events and only accepts the offered choices");

    // ═══ reconcile ═══
    const l14 = await newLead("l14");
    await schedule(l14, U1, in2(3));
    await work();
    await Lead.collection.updateOne({ _id: l14 as never }, { $set: { status: "won" } });
    const lost2 = await newLead("l15");
    await schedule(lost2, U1, in2(3));
    await work();
    await Lead.collection.updateOne({ _id: lost2 as never }, { $set: { isDeleted: true } });
    const orphan = await newLead("l16");
    const now = new Date();
    await FollowUpTask.collection.insertOne({ _id: "ft_unqueued" as never, companyId: A, leadId: orphan, ownerId: U1, originalOwnerId: U1, ownerHistory: [], dueAt: in2(2), status: "open", version: 1, scheduleChangedAt: now, createdVia: "crm", createdBy: U1, createdAt: now, updatedAt: now } as never);
    await Lead.collection.updateOne({ _id: orphan as never }, { $set: { nextFollowUpAt: in2(2) } });
    const stats = await reconcile();
    assert.ok(stats.removed >= 2 && stats.queued >= 1, JSON.stringify(stats));
    await work();
    assert.equal((await eventFor(U1, l14))?.status, "cancelled", "a won lead's event is removed");
    assert.equal((await eventFor(U1, lost2))?.status, "cancelled", "an archived lead's event is removed");
    assert.equal((await eventFor(U1, orphan))?.status, "confirmed", "a follow-up that was never queued is found and sent");
    pass("reconcile removes events of closed or archived leads and sends follow-ups that were never queued");

    // ═══ company isolation ═══
    const lb = await newLead("lb", B);
    await schedule(lb, UB, in2(3), B);
    await work();
    assert.equal((await eventFor(UB, lb, B))?.status, "confirmed");
    const calB = await calendarOf(UB, B);
    assert.ok(mock.liveEvents(calB).every((e: { summary: string }) => e.summary === "Follow-up: Customer lb"), "company B's calendar holds only company B's follow-up");
    assert.ok(mock.liveEvents(await calendarOf(U1)).every((e: { summary: string }) => !e.summary.includes("Customer lb")), "and company A's calendars never hold it");
    const aLinks = await inCompany(A, () => CalendarEventLink.countDocuments({}));
    const bLinks = await inCompany(B, () => CalendarEventLink.countDocuments({}));
    assert.equal(aLinks + bLinks, await CalendarEventLink.collection.countDocuments({ companyId: { $in: [A, B] } as never }));
    assert.equal(await inCompany(B, () => CalendarEventLink.countDocuments({ userId: U1 })), 0, "company B cannot see company A's queue");
    assert.equal((await inCompany(B, () => getStatus({ companyId: B, userId: U1 }))).status, "not_connected", "nor A's connections");
    pass("each company's follow-ups reach only its own people's calendars, and queue and connections are invisible across companies");

    // ═══ deactivated people ═══
    await AdminUser.collection.updateOne({ _id: U2 as never }, { $set: { isActive: false } });
    const calU2 = await calendarOf(U2);
    const beforeTear = mock.liveEvents(calU2).length;
    assert.ok(beforeTear >= 0);
    const l17 = await newLead("l17");
    await AdminUser.collection.updateOne({ _id: U2 as never }, { $set: { isActive: true } });
    await schedule(l17, U2, in2(3));
    await work();
    assert.equal((await eventFor(U2, l17))?.status, "confirmed");
    await AdminUser.collection.updateOne({ _id: U2 as never }, { $set: { isActive: false } });
    const teardown1 = await reconcile();
    await work();
    assert.equal((await eventFor(U2, l17))?.status, "cancelled", "a deactivated person's events leave their calendar");
    const teardown2 = await reconcile();
    assert.ok(teardown1.tornDown + teardown2.tornDown >= 1);
    const ended = await connectionOf(U2);
    assert.deepEqual([ended?.status, ended?.refreshTokenSealed, ended?.accessTokenSealed], ["disconnected", null, null], "then the connection ends and the tokens are erased");
    assert.ok([...mock.state.refreshTokens.values()].filter((r: { email: string }) => r.email === accounts.u2.email).every((r: { revoked: boolean }) => r.revoked), "and Google is told to forget the grant");
    assert.equal((await task(l17))?.status, "open", "the follow-up itself stays in the CRM for reassignment");
    pass("when a person is deactivated their events are removed, the grant is revoked and tokens erased, and their CRM follow-ups stay for reassignment");

    // ═══ disconnect / reconnect ═══
    const openBefore = await FollowUpTask.collection.countDocuments({ companyId: A, ownerId: U1, status: "open" });
    mock.resetLog();
    mock.fail((r: { path: string }) => r.path === "/revoke", { status: 500 }, 1);
    const calU1 = await calendarOf(U1);
    const liveAtDisconnect = mock.liveEvents(calU1).length;
    const off = await inCompany(A, () => disconnect({ companyId: A, userId: U1 }, { deleteCalendar: false }));
    assert.deepEqual([off.wasConnected, off.revoked, off.calendarDeleted], [true, false, false], "Google being down does not stop disconnecting");
    const gone = await connectionOf(U1);
    assert.deepEqual([gone?.status, gone?.refreshTokenSealed, gone?.accessTokenSealed, gone?.googleSub], ["disconnected", null, null, null], "tokens are erased locally regardless");
    assert.equal(await CalendarEventLink.collection.countDocuments({ connectionId: connectionIdFor(A, U1) }), 0, "the queue is cleared");
    assert.equal(await FollowUpTask.collection.countDocuments({ companyId: A, ownerId: U1, status: "open" }), openBefore, "CRM follow-ups are untouched");
    assert.equal(mock.liveEvents(calU1).length, liveAtDisconnect, "the calendar and its events are kept unless asked");
    assert.equal((await inCompany(A, () => disconnect({ companyId: A, userId: U1 }, { deleteCalendar: false }))).wasConnected, false, "disconnecting twice is harmless");
    const newTask = await newLead("l18");
    await schedule(newTask, U1, in2(3));
    assert.equal(await link(newTask), null, "while disconnected nothing is queued");

    assert.equal((await connect(U1, accounts.u1)).result.ok, true, "reconnecting the same Google account");
    assert.equal(await calendarOf(U1), calU1, "reuses the same calendar");
    await work();
    assert.equal(mock.calendarsNamed("Whyte CRM Follow-ups").filter((id: string) => id === calU1).length, 1);
    const ids = mock.liveEvents(calU1).map((e: { id: string }) => e.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate events after reconnecting: the old ones are adopted by id");
    assert.equal((await eventFor(U1, newTask))?.status, "confirmed");

    const other = await connect(U3, { email: "user.three@gmail.test", sub: "sub-three" });
    assert.equal(other.result.ok, true);
    const withDelete = await inCompany(A, () => disconnect({ companyId: A, userId: U3 }, { deleteCalendar: true }));
    assert.deepEqual([withDelete.revoked, withDelete.calendarDeleted], [true, true]);
    assert.equal(mock.calendarsNamed("Whyte CRM Follow-ups").length >= 1, true);
    assert.equal((await connectionOf(U3))?.calendarId, null);
    pass("disconnecting erases tokens and the queue even if Google is down, keeps the calendar unless asked, leaves CRM follow-ups alone; reconnecting re-adopts events without duplicates");

    // ═══ what Google was ever sent ═══
    const sentBodies = JSON.stringify(mock.state.log.filter((r: { path: string }) => r.path.includes("/events") || r.path === "/calendar/v3/calendars").map((r: { body: unknown }) => r.body));
    assert.ok(sentBodies.length > 100);
    for (const [label, secret] of Object.entries(SECRETS)) assert.ok(!sentBodies.includes(secret), `${label} was sent to Google`);
    for (const word of ["4,50,000", "450000", "12% off"]) assert.ok(!sentBodies.includes(word), word);
    pass("across the whole run, no phone number, note, place, project or money figure was ever sent to Google");

    console.log(`\nALL ${count} GOOGLE CALENDAR SYNC TESTS PASSED!`);
  } finally {
    await cleanup();
    await mock.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
