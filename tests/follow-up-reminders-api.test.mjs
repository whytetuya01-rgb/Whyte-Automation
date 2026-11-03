/**
 * Follow-up reminders through the real API (production-mode server + throwaway local MongoDB + a fake email provider):
 *   - giving someone else a follow-up (new, or handed over) puts a notice in their bell; giving yourself one does not;
 *   - the daily job (/api/cron/follow-up-reminders) emails each owner ONE list of their follow-ups overdue and due today,
 *     in their own time zone, leaving out later ones, won leads, people who turned it off and deactivated people;
 *   - it never sends the same day twice, retries after a provider failure, keeps companies apart, and needs CRON_SECRET;
 *   - My account turns the email off and on.
 *
 *   node tests/follow-up-reminders-api.test.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let fake;
let exitCode = 0;

const emails = [];
let mode = "ok"; // ok | http500
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/emails") { res.statusCode = 404; res.end("{}"); return; }
      if (mode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ message: "provider down" })); return; }
      emails.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const CRON_SECRET = randomBytes(24).toString("base64url");
const istDay = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

try {
  fake = await startFake();
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "CRM <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
    CRON_SECRET,
    SESSION_ACTOR_CACHE_TTL_MS: "0",
  });
  server = await startIsolatedServer("fureminders", [
    { _id: 2, email: "owner@example.com", role: "company_owner", name: "Olivia Owner", companyId: 10 },
    { _id: 3, email: "admin@example.com", role: "admin", name: "Adam Admin", companyId: 10 },
    { _id: 5, email: "quiet@example.com", role: "configurable_admin", name: "Quinn Quiet", permissions: ["leads:manage"], companyId: 10 },
    { _id: 6, email: "nyc@example.com", role: "configurable_admin", name: "Nina NewYork", permissions: ["leads:manage"], companyId: 10, timeZone: "America/New_York" },
    { _id: 7, email: "leaver@example.com", role: "configurable_admin", name: "Leo Leaver", permissions: ["leads:manage"], companyId: 10 },
    { _id: 12, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [cid, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  const c = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    quiet: await login("quiet@example.com", "admin"),
    nyc: await login("nyc@example.com", "admin"),
    ownerB: await login("ownerb@example.com", "admin"),
  };

  const createLead = async (cookie, name, dueInMs, ownerId) => {
    const body = { customerName: name, phone: "9876543210", status: "contacted", priority: "medium", projectType: "Villa", nextFollowUpAt: new Date(Date.now() + dueInMs).toISOString() };
    if (ownerId != null) body.followUpOwnerId = ownerId;
    const response = await api(cookie, "POST", "/api/crm/leads", body);
    assert.equal(response.status, 201, `create ${name}: ${response.text?.slice(0, 300)}`);
    return response.data.id;
  };
  /** Moves a follow-up's due time (the lead's date and its task together), as if time had passed. */
  const setDue = async (leadId, at) => {
    await db.collection("leads").updateOne({ _id: leadId }, { $set: { nextFollowUpAt: at } });
    await db.collection("followuptasks").updateOne({ leadId, status: "open" }, { $set: { dueAt: at } });
  };
  const bell = (userId) => db.collection("notifications").find({ userId, type: "follow_up_assigned" }).sort({ createdAt: 1 }).toArray();
  const runJob = (auth = `Bearer ${CRON_SECRET}`) => fetch(`${baseUrl}/api/cron/follow-up-reminders`, { headers: auth ? { Authorization: auth } : {} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // ═══ the bell: someone else gives you a follow-up ═══
  const own = await createLead(c.admin, "Self Set", 2 * DAY);
  assert.equal((await bell(3)).length, 0, "setting your own follow-up sends you nothing");
  const given = await createLead(c.admin, "Given To Quinn", 2 * DAY, 5);
  const [toQuinn] = await bell(5);
  assert.ok(toQuinn, "Quinn was told");
  assert.equal(toQuinn.title, "New follow-up for you");
  assert.match(toQuinn.body, /Adam Admin set a follow-up for you on Given To Quinn \(LD-\d{4}-\d{4}\)\. It is due/);
  assert.equal(toQuinn.link, "/admin/crm/follow-ups");
  const handed = await api(c.admin, "PATCH", `/api/crm/leads/${own}`, { followUpOwnerId: 6 });
  assert.equal(handed.status, 200, handed.text?.slice(0, 300));
  const [toNina] = await bell(6);
  assert.ok(toNina, "Nina was told when Adam handed his follow-up over");
  assert.equal(toNina.title, "Follow-up handed to you");
  assert.match(toNina.body, /Adam Admin handed you the follow-up on Self Set/);
  const bellApi = await api(c.nyc, "GET", "/api/notifications");
  assert.equal(bellApi.status, 200, bellApi.text?.slice(0, 200));
  assert.ok(JSON.stringify(bellApi.data).includes("Follow-up handed to you"), "and it is in her bell through the API");
  assert.equal((await bell(3)).length, 0, "Adam, who made both changes, got no notice");
  pass("giving someone else a follow-up, new or handed over, puts a notice in their bell; giving yourself one does not");

  // ═══ the morning email ═══
  // Adam: one overdue, one due later today (when today has time left in India), one next week, one on a won lead.
  const overdue = await createLead(c.admin, "Overdue Ravi", 2 * DAY);
  await setDue(overdue, new Date(Date.now() - 3 * HOUR));
  const later = await createLead(c.admin, "Later Today Sita", 2 * DAY);
  const laterAt = new Date(Date.now() + 5 * 60 * 1000);
  const todayHasRoom = istDay(laterAt) === istDay(new Date());
  await setDue(later, laterAt);
  await createLead(c.admin, "Next Week Arjun", 7 * DAY);
  const won = await createLead(c.admin, "Won Already", 2 * DAY);
  await setDue(won, new Date(Date.now() - 2 * HOUR));
  await db.collection("leads").updateOne({ _id: won }, { $set: { status: "won" } });
  // Quinn: overdue, but turns the email off. Nina (New York): overdue. Leo: overdue, then deactivated. Company B: overdue.
  await setDue(given, new Date(Date.now() - HOUR));
  await setDue(own, new Date(Date.now() - 2 * HOUR));
  const leos = await createLead(c.admin, "Leo Lead", 2 * DAY, 7);
  await setDue(leos, new Date(Date.now() - HOUR));
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { isActive: false } });
  const otherCo = await createLead(c.ownerB, "Other Company Lead", 2 * DAY);
  await setDue(otherCo, new Date(Date.now() - HOUR));

  const settings = await api(c.quiet, "GET", "/api/account/settings");
  assert.equal(settings.status, 200, settings.text?.slice(0, 200));
  assert.equal(settings.data.reminders.followUpEmails, true, "on unless turned off");
  const offRes = await api(c.quiet, "PATCH", "/api/account/settings", { followUpReminderEmails: false });
  assert.equal(offRes.status, 200, offRes.text?.slice(0, 200));
  assert.equal(offRes.data.reminders.followUpEmails, false);
  assert.equal(offRes.data.timeZone.effective, "Asia/Kolkata", "turning the email off leaves the time zone alone");
  assert.equal((await api(c.quiet, "PATCH", "/api/account/settings", {})).status, 400, "an empty change is refused");
  pass("My account shows the morning email as on, and the person can turn it off (the time zone is untouched)");

  assert.equal((await runJob(null)).status, 401, "no secret");
  assert.equal((await runJob("Bearer wrong")).status, 401, "wrong secret");
  assert.equal(emails.length, 0, "and nothing was sent");

  const first = await runJob();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const to = (address) => emails.filter((email) => email.to === address);
  assert.equal(to("admin@example.com").length, 1, "Adam gets one email");
  const adam = to("admin@example.com")[0];
  assert.match(adam.subject, /^Acme Homes: Follow-ups for today \(/);
  assert.match(adam.text, /OVERDUE \(1\)\n- .*Overdue Ravi \(LD-/);
  if (todayHasRoom) assert.match(adam.text, /DUE TODAY \(1\)\n- .*Later Today Sita/);
  assert.ok(!adam.text.includes("Next Week Arjun"), "a later follow-up is not listed");
  assert.ok(!adam.text.includes("Won Already"), "nor one on a won lead");
  assert.ok(!adam.text.includes("Self Set"), "nor one he handed to Nina");
  assert.match(adam.text, /Open follow-ups: http:\/\/127\.0\.0\.1:\d+\/admin\/crm\/follow-ups/);
  assert.match(adam.html, /<a href="http:\/\/127\.0\.0\.1:\d+\/admin\/crm\/follow-ups"/);
  assert.equal(to("quiet@example.com").length, 0, "Quinn turned it off");
  assert.equal(to("leaver@example.com").length, 0, "a deactivated person gets nothing");
  assert.equal(to("nyc@example.com").length, 1);
  assert.match(to("nyc@example.com")[0].text, /Self Set[\s\S]*Times are in America\/New_York/, "Nina's list is in her own time zone");
  assert.equal(to("ownerb@example.com").length, 1);
  assert.ok(to("ownerb@example.com")[0].text.includes("Other Company Lead") && !to("ownerb@example.com")[0].text.includes("Acme") && !to("ownerb@example.com")[0].text.includes("Ravi"), "the other company's owner sees only their own");
  assert.ok(!to("owner@example.com").length, "Olivia owns no follow-ups, so no email");
  assert.equal(first.body.data.turnedOff, 1);
  pass("the morning email lists each owner's overdue and due-today follow-ups (not later ones, won leads or handed-over ones), in their own time zone, with a link; nobody who turned it off or was deactivated gets one; companies stay apart");

  const sentSoFar = emails.length;
  const second = await runJob();
  assert.equal(second.status, 200);
  assert.equal(emails.length, sentSoFar, "running again the same day sends nothing new");
  assert.equal(second.body.data.alreadySent, first.body.data.sent);
  pass("the job can run again the same day without sending anyone a second email");

  // A provider failure: the claim is released and the next run sends it.
  await db.collection("followupreminderdigests").deleteMany({ userId: 6 });
  mode = "http500";
  const failed = await runJob();
  assert.equal(failed.body.data.failed, 1, JSON.stringify(failed.body));
  assert.equal(await db.collection("followupreminderdigests").countDocuments({ userId: 6 }), 0, "nothing is recorded as sent");
  mode = "ok";
  const retried = await runJob();
  assert.equal(retried.body.data.sent, 1);
  assert.equal(to("nyc@example.com").length, 2, "the next run sent it");
  assert.equal((await db.collection("followupreminderdigests").findOne({ userId: 6 })).status, "sent");
  pass("when the email service fails, nothing is marked sent and the next run sends it");

  const onRes = await api(c.quiet, "PATCH", "/api/account/settings", { followUpReminderEmails: true });
  assert.equal(onRes.data.reminders.followUpEmails, true);
  assert.equal((await db.collection("adminusers").findOne({ _id: 5 })).followUpReminderEmails, undefined, "back on = the default, nothing stored");
  await runJob();
  assert.equal(to("quiet@example.com").length, 1, "once turned back on, Quinn gets hers");
  assert.match(to("quiet@example.com")[0].text, /Given To Quinn/);
  pass("turning the email back on stores nothing (on is the default) and the next run includes the person");

  console.log(`\nALL ${count} FOLLOW-UP REMINDER API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  fake?.close();
  process.exit(exitCode);
}
