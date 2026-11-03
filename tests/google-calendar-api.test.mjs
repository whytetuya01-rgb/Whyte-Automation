/**
 * Google Calendar through the real HTTP API (production-mode server + throwaway local MongoDB + the mock Google server):
 * connect -> Google's consent -> callback -> status; the sync that runs right after a follow-up change (Next's `after`),
 * settings, retry, disconnect; who may use it; and the scheduled worker's secret.
 *
 *   node tests/google-calendar-api.test.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const { createMockGoogle } = createRequire(import.meta.url)("./helpers/mockGoogle.cjs");

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let mock;
let exitCode = 0;
const DAY = 24 * 3600 * 1000;
const CRON_SECRET = randomBytes(24).toString("hex");
const waitFor = async (check, what, ms = 25_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
};

try {
  mock = createMockGoogle();
  await mock.start();
  Object.assign(process.env, mock.env("http://localhost:3000/api/integrations/google-calendar/callback"), { GOOGLE_CALENDAR_TOKEN_KEY: randomBytes(32).toString("base64"), CRON_SECRET });
  delete process.env.APP_BASE_URL;

  server = await startIsolatedServer("gcalapi", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "other@example.com", role: "admin", name: "Admin Two", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 7, email: "viewer@example.com", role: "configurable_admin", name: "Viewer", permissions: ["leads:read"], companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "c10", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = {
    admin: await login("admin@example.com", "admin"),
    other: await login("other@example.com", "admin"),
    viewer: await login("viewer@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
  };
  const base = "/api/integrations/google-calendar";
  const status = (cookie) => api(cookie, "GET", `${base}/status`);
  const callback = (cookie, search) => fetch(`${baseUrl}${base}/callback${search}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  const consent = async (cookie, account, options) => {
    const started = await api(cookie, "POST", `${base}/connect`);
    assert.equal(started.status, 200, started.text?.slice(0, 300));
    return { started, approved: mock.authorize(started.data.url, account, options) };
  };

  // ═══ before connecting ═══
  const first = await status(c.admin);
  assert.equal(first.status, 200, first.text?.slice(0, 300));
  assert.deepEqual([first.data.configured, first.data.status, first.data.email, first.data.eventMinutes], [true, "not_connected", null, 30]);
  assert.deepEqual(first.data.eventMinutesChoices, [15, 30, 45, 60, 90, 120]);
  pass("status before connecting: configured, not connected, 30-minute events by default");

  // ═══ who may use it ═══
  for (const [who, expected] of [["viewer", 403], ["dealer", 403]]) {
    assert.equal((await status(c[who])).status, expected, `${who} status`);
    assert.equal((await api(c[who], "POST", `${base}/connect`)).status, expected, `${who} connect`);
    assert.equal((await api(c[who], "POST", `${base}/disconnect`, {})).status, expected, `${who} disconnect`);
    assert.equal((await api(c[who], "PATCH", `${base}/settings`, { eventMinutes: 60 })).status, expected, `${who} settings`);
    assert.equal((await api(c[who], "POST", `${base}/retry`, {})).status, expected, `${who} retry`);
  }
  assert.equal((await fetch(`${baseUrl}${base}/status`)).status, 401);
  assert.equal((await fetch(`${baseUrl}${base}/connect`, { method: "POST" })).status, 401);
  assert.equal((await api(await login("super@example.com", "admin"), "GET", `${base}/status`)).status, 403, "a platform Super Admin outside a company has no connection");
  pass("only people who manage leads can use it; viewers, dealers, the platform admin and signed-out visitors are refused on every route");

  // ═══ connect ═══
  const { started, approved } = await consent(c.admin, { email: "admin.one@gmail.test", sub: "api-sub-1" });
  const consentUrl = new URL(started.data.url);
  assert.equal(consentUrl.origin, mock.baseUrl, "the consent URL points at the configured Google endpoint");
  assert.equal(consentUrl.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/calendar.app.created");

  // the callback only works for the person who started, and only once
  const wrongPerson = await callback(c.other, `?code=${approved.code}&state=${approved.state}`);
  assert.equal(wrongPerson.status, 303);
  assert.match(wrongPerson.headers.get("location"), /\/admin\/account\?google=state$/, "another signed-in person cannot finish someone else's connection");
  assert.equal((await status(c.admin)).data.status, "not_connected");
  const signedOut = await callback(null, `?code=${approved.code}&state=${approved.state}`);
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers.get("location"), /google=session$/, "signed out: back to My account, not a JSON error");
  const done = await callback(c.admin, `?code=${approved.code}&state=${approved.state}`);
  assert.equal(done.status, 303);
  assert.equal(done.headers.get("location"), "http://localhost:3000/admin/account?google=connected");
  assert.ok(!done.headers.get("location").includes(approved.code), "the code never appears in the address we send the browser to");
  const replay = await callback(c.admin, `?code=${approved.code}&state=${approved.state}`);
  assert.match(replay.headers.get("location"), /google=state$/, "a replayed callback does nothing");
  const denied = await consent(c.other, { email: "admin.two@gmail.test", sub: "api-sub-2" });
  assert.match((await callback(c.other, `?error=access_denied&state=${denied.approved.state}`)).headers.get("location"), /google=denied$/, "pressing Cancel");
  const connected = await status(c.admin);
  assert.deepEqual([connected.data.status, connected.data.email, connected.data.calendarName], ["connected", "admin.one@gmail.test", "Whyte CRM Follow-ups"]);
  const row = await db.collection("googlecalendarconnections").findOne({ userId: 2 });
  assert.ok(!JSON.stringify(row).includes([...mock.state.refreshTokens.keys()][0]), "the refresh token is not stored in the clear");
  assert.ok(row.refreshTokenSealed.startsWith("v1."));
  pass("connect: consent URL, a callback that works only for the person who started it and only once, tokens stored encrypted, status shows the Google account and calendar");

  // ═══ a follow-up change reaches Google by itself (after the response) ═══
  const created = await api(c.admin, "POST", "/api/crm/leads", { customerName: "Api Customer", phone: "9876543210", notes: "secret note 4,50,000", status: "contacted", priority: "high", nextFollowUpAt: new Date(Date.now() + 2 * DAY).toISOString() });
  assert.equal(created.status, 201, created.text?.slice(0, 300));
  const calendarId = row.calendarId;
  const event = await waitFor(() => mock.liveEvents(calendarId)[0], "the event to appear in Google");
  assert.equal(event.summary, "Follow-up: Api Customer");
  assert.ok(!JSON.stringify(event).includes("9876543210") && !JSON.stringify(event).includes("secret note"), "no phone or note in Google");
  await waitFor(async () => (await status(c.admin)).data.sync.counts.synced === 1, "the status to show it synced");
  const synced = await status(c.admin);
  assert.ok(synced.data.lastSyncAt, "last successful sync shown");
  assert.deepEqual(synced.data.sync.counts, { pending: 0, synced: 1, error: 0, removedInGoogle: 0 });

  const leadId = created.data.id;
  const moved = new Date(Date.now() + 4 * DAY).toISOString();
  assert.equal((await api(c.admin, "POST", `/api/crm/leads/${leadId}/follow-up`, { action: "reschedule", nextFollowUpAt: moved })).status, 200);
  await waitFor(() => mock.liveEvents(calendarId)[0]?.start.dateTime === moved, "the new time to reach Google");
  assert.equal(mock.liveEvents(calendarId).length, 1, "the same event moved");
  pass("creating and rescheduling a follow-up reach Google within seconds, without the scheduled worker, with no phone or note");

  // ═══ settings and retry ═══
  assert.equal((await api(c.admin, "PATCH", `${base}/settings`, { eventMinutes: 7 })).status, 400);
  assert.equal((await api(c.admin, "PATCH", `${base}/settings`, { eventMinutes: 60, extra: 1 })).status, 400, "unknown fields refused");
  assert.equal((await api(c.admin, "PATCH", `${base}/settings`, { eventMinutes: 60 })).status, 200);
  await waitFor(() => { const e = mock.liveEvents(calendarId)[0]; return e && new Date(e.end.dateTime) - new Date(e.start.dateTime) === 60 * 60_000; }, "the 60-minute length to reach Google");
  assert.equal((await status(c.admin)).data.eventMinutes, 60);
  assert.equal((await api(c.admin, "POST", `${base}/retry`, {})).data.queued, 0, "nothing failed, nothing to retry");
  assert.equal((await api(c.admin, "POST", `${base}/retry`, { linkId: "x", extra: 1 })).status, 400);
  assert.equal((await status(c.other)).data.status, "not_connected", "another person's connection is separate");
  assert.equal((await status(c.other)).data.eventMinutes, 30);
  pass("settings change event length in Google; retry has nothing to do when nothing failed; each person has their own connection");

  // ═══ the scheduled worker ═══
  const worker = (headers) => fetch(`${baseUrl}/api/cron/google-calendar-sync`, { headers });
  assert.equal((await worker({})).status, 401, "no secret");
  assert.equal((await worker({ Authorization: "Bearer wrong" })).status, 401, "wrong secret");
  assert.equal((await worker({ Authorization: CRON_SECRET })).status, 401, "the Bearer scheme is required");
  const ran = await worker({ Authorization: `Bearer ${CRON_SECRET}` });
  assert.equal(ran.status, 200);
  const ranBody = await ran.json();
  assert.deepEqual(Object.keys(ranBody.data).sort(), ["byOutcome", "processed", "reconciled"]);
  const posted = await fetch(`${baseUrl}/api/cron/google-calendar-sync`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  assert.equal(posted.status, 200, "POST works too");
  // it repairs drift: a follow-up that was never queued
  await db.collection("followuptasks").insertOne({ _id: "ft_manual", companyId: 10, leadId: "ld_manual", ownerId: 2, originalOwnerId: 2, ownerHistory: [], dueAt: new Date(Date.now() + 3 * DAY), status: "open", version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: 2, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("leads").insertOne({ _id: "ld_manual", companyId: 10, referenceNumber: "LD-2026-9100", customerName: "Never Queued", status: "contacted", priority: "low", createdBy: 2, createdAt: new Date(), updatedAt: new Date(), nextFollowUpAt: new Date(Date.now() + 3 * DAY) });
  const repaired = await (await worker({ Authorization: `Bearer ${CRON_SECRET}` })).json();
  assert.ok(repaired.data.reconciled.queued >= 1, JSON.stringify(repaired.data));
  assert.ok(mock.liveEvents(calendarId).some((e) => e.summary === "Follow-up: Never Queued"), "and the worker sent it");
  pass("the scheduled worker answers only to the secret Bearer token (GET or POST), reports what it did, and repairs a follow-up that was never queued");

  // ═══ disconnect ═══
  assert.equal((await api(c.admin, "POST", `${base}/disconnect`, { deleteCalendar: "yes" })).status, 400);
  const off = await api(c.admin, "POST", `${base}/disconnect`, { deleteCalendar: true });
  assert.equal(off.status, 200, off.text?.slice(0, 200));
  assert.deepEqual([off.data.wasConnected, off.data.revoked, off.data.calendarDeleted], [true, true, true]);
  assert.equal(mock.state.calendars.has(calendarId), false, "the calendar was deleted because that was asked");
  const after = await status(c.admin);
  assert.deepEqual([after.data.status, after.data.email, after.data.sync.counts.synced], ["not_connected", null, 0]);
  const gone = await db.collection("googlecalendarconnections").findOne({ userId: 2 });
  assert.deepEqual([gone.status, gone.refreshTokenSealed, gone.accessTokenSealed], ["disconnected", null, null]);
  assert.equal(await db.collection("calendareventlinks").countDocuments({ userId: 2 }), 0);
  assert.equal(await db.collection("followuptasks").countDocuments({ ownerId: 2, status: "open" }), 2, "the CRM follow-ups are untouched");
  assert.equal((await api(c.admin, "POST", `${base}/disconnect`, {})).data.wasConnected, false, "disconnecting again is harmless");
  pass("disconnect revokes the grant, erases tokens and the queue, deletes the calendar only when asked, and leaves CRM follow-ups alone");

  console.log(`\nALL ${count} GOOGLE CALENDAR API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  await mock?.stop();
  process.exit(exitCode);
}
