/**
 * Lead follow-ups through the real API (production-mode server + throwaway local MongoDB):
 *   - the follow-up list: overdue (the due time has passed) / today (still ahead before the Indian day ends) / upcoming,
 *     only open leads the caller may see, company isolation, search, 10 per page by default, who owns each follow-up;
 *   - marking a follow-up done, rescheduling or cancelling it (timeline entry, validation, permissions, owners, the
 *     stale-view guard, all-or-nothing writes), and old follow-ups that have no task yet;
 *   - each person's private calendar link: create / show again / replace / turn off, and the public calendar file it
 *     serves (what is in it, what is not, and the cases where it must stop working).
 *
 *   node tests/follow-ups.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const DAY = 24 * 3600 * 1000;
/** An instant on the Indian business calendar: `days` from today at `hour`:00 IST. */
const istDay = (days, hour = 10) => {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${key}T${String(hour).padStart(2, "0")}:00:00+05:30`);
};

// Permission changes normally apply within 30 seconds (the app's session cache); here they apply at once.
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

// "Later today" must stay today, and "earlier today" must stay on the same Indian day, while this test runs: if the Indian
// day is about to turn over (or has only just turned), wait for it.
const msSinceIstMidnight = () => Date.now() - istDay(0, 0).getTime();
const msUntilIstMidnight = () => DAY - msSinceIstMidnight();
if (msUntilIstMidnight() < 3 * 60_000 || msSinceIstMidnight() < 3 * 60_000) {
  const wait = (msUntilIstMidnight() < 3 * 60_000 ? msUntilIstMidnight() : 0) + 3 * 60_000 + 1000;
  console.log(`  (waiting ${Math.ceil(wait / 1000)}s: the Indian day is turning over)`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}
/** The last second of the Indian day: always "later today" while the test runs. */
const laterToday = () => new Date(istDay(0, 0).getTime() + DAY - 1000);
const earlierToday = () => new Date(Date.now() - 2 * 60_000);

try {
  server = await startIsolatedServer("followups", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 7, email: "viewer@example.com", role: "configurable_admin", name: "Viewer", permissions: ["leads:read"], companyId: 10 },
    { _id: 9, email: "nocrm@example.com", role: "configurable_admin", name: "No CRM", permissions: ["quotations:read_all"], companyId: 10 },
    { _id: 11, email: "manager@example.com", role: "configurable_admin", name: "Manager M", permissions: ["leads:manage"], companyId: 10 },
    { _id: 8, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [cid, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = {
    admin: await login("admin@example.com", "admin"),
    adminB: await login("adminb@example.com", "admin"),
    viewer: await login("viewer@example.com", "admin"),
    nocrm: await login("nocrm@example.com", "admin"),
    manager: await login("manager@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
  };

  let refNo = 0;
  const lead = (id, companyId, due, extra = {}) => ({
    _id: id, companyId, referenceNumber: `LD-2026-${String(++refNo).padStart(4, "0")}`, customerName: `Client ${id}`, phone: "9876500000",
    projectType: "3 BHK", location: "Surat", status: "contacted", priority: "medium", createdBy: 2, createdAt: new Date(now - 90 * DAY), updatedAt: new Date(now - DAY),
    nextFollowUpAt: due, ...extra,
  });
  await db.collection("leads").insertMany([
    lead("ld_overdue_3d", 10, istDay(-3), { customerName: "Overdue Three", priority: "urgent" }),
    lead("ld_overdue_1d", 10, istDay(-1, 18), { customerName: "Overdue One" }),
    lead("ld_overdue_45d", 10, istDay(-45), { customerName: "Overdue Old" }),
    lead("ld_earlier_today", 10, earlierToday(), { customerName: "Earlier Today" }),
    lead("ld_today", 10, laterToday(), { customerName: "Due Today" }),
    lead("ld_up_2d", 10, istDay(2), { customerName: "Upcoming Two" }),
    lead("ld_up_10d", 10, istDay(10), { customerName: "Upcoming Ten", notes: "Private price talk: customer will pay 4,50,000 if we give 12% off." }),
    lead("ld_far", 10, istDay(400), { customerName: "Far Future" }),
    lead("ld_won", 10, istDay(-2), { status: "won", customerName: "Already Won" }),
    lead("ld_lost", 10, istDay(1), { status: "lost", customerName: "Already Lost" }),
    lead("ld_nodate", 10, null, { customerName: "No Date" }),
    lead("ld_deleted", 10, istDay(-2), { isDeleted: true, customerName: "Archived Lead" }),
    lead("ld_other_company", 20, istDay(-2), { customerName: "Other Company Lead" }),
  ]);

  const list = async (cookie, query = "") => {
    const res = await api(cookie, "GET", `/api/crm/follow-ups${query}`);
    return { status: res.status, rows: res.data?.data ?? [], summary: res.data?.summary, pagination: res.data?.pagination, text: res.text };
  };
  const ids = (rows) => rows.map((r) => r.id);

  // ═══ the list ═══
  const all = await list(c.admin);
  assert.equal(all.status, 200, all.text?.slice(0, 200));
  assert.deepEqual(all.summary, { overdue: 4, today: 1, upcoming: 3 }, "counts: 4 overdue (45d, 3d, 1d and earlier today), 1 today (later), 3 upcoming (2d, 10d, 400d); won / lost / no date / archived / other company are left out");
  assert.deepEqual(ids(all.rows), ["ld_overdue_45d", "ld_overdue_3d", "ld_overdue_1d", "ld_earlier_today", "ld_today", "ld_up_2d", "ld_up_10d", "ld_far"], "earliest first");
  assert.deepEqual(all.rows.map((r) => [r.bucket, r.dayOffset]), [["overdue", -45], ["overdue", -3], ["overdue", -1], ["overdue", 0], ["today", 0], ["upcoming", 2], ["upcoming", 10], ["upcoming", 400]]);
  assert.deepEqual(ids((await list(c.admin, "?view=overdue")).rows), ["ld_overdue_45d", "ld_overdue_3d", "ld_overdue_1d", "ld_earlier_today"], "a follow-up whose time earlier today has passed is overdue");
  assert.deepEqual(ids((await list(c.admin, "?view=today")).rows), ["ld_today"], "today holds only what is still ahead before the day ends");
  assert.equal(all.summary.overdue + all.summary.today + all.summary.upcoming, all.rows.length, "the three tabs split the follow-ups with nothing missing and nothing counted twice");
  assert.ok(all.rows.every((r) => r.followUpOwnerId === null && r.followUpOwnerName === null), "old follow-ups have no owner yet (they get one the first time they are changed)");
  assert.deepEqual(ids((await list(c.admin, "?view=upcoming")).rows), ["ld_up_2d", "ld_up_10d", "ld_far"]);
  assert.deepEqual(ids((await list(c.admin, "?view=overdue&priority=urgent")).rows), ["ld_overdue_3d"], "priority filter");
  assert.deepEqual(ids((await list(c.admin, "?search=upcoming ten")).rows), ["ld_up_10d"], "search by name");
  assert.deepEqual((await list(c.admin, "?search=upcoming ten")).summary, all.summary, "the tab counts ignore the search");
  assert.equal((await list(c.admin, "?view=soon")).status, 400, "unknown view");
  assert.equal((await list(c.admin, "?priority=huge")).status, 400);
  const other = await list(c.adminB);
  assert.deepEqual(ids(other.rows), ["ld_other_company"], "another company sees only its own");
  pass("the list: overdue once the due time has passed, today = still ahead before the Indian day ends, upcoming = a later day; earliest first, only open leads with a date, filters and search work, other companies are separate");

  // 10 per page by default
  await db.collection("leads").insertMany(Array.from({ length: 12 }, (_, i) => lead(`ld_page_${i}`, 10, istDay(20 + i), { customerName: `Paged ${i}` })));
  const page1 = await list(c.admin);
  assert.equal(page1.rows.length, 10, "10 per page by default");
  assert.equal(page1.pagination.total, 20);
  assert.equal(page1.pagination.totalPages, 2);
  assert.equal((await list(c.admin, "?page=2")).rows.length, 10);
  assert.equal((await list(c.admin, "?pageSize=25")).rows.length, 20);
  pass("follow-ups are 10 per page by default, with paging and a page-size choice");

  // permissions
  assert.equal((await list(c.dealer)).status, 403, "dealers have no CRM follow-ups");
  assert.equal((await list(c.nocrm)).status, 403, "a custom role without leads:read");
  assert.equal((await list(c.viewer)).status, 200, "a custom role with leads:read can view");
  assert.equal((await fetch(`${baseUrl}/api/crm/follow-ups`)).status, 401);

  // ═══ marking done / rescheduling ═══
  const act = (cookie, id, body) => api(cookie, "POST", `/api/crm/leads/${id}/follow-up`, body);
  const timeline = async (id) => db.collection("crmactivities").find({ leadId: id, type: "follow_up" }).sort({ performedAt: 1 }).toArray();
  const tomorrow = istDay(1, 11).toISOString();

  const done = await act(c.admin, "ld_overdue_3d", { action: "done", note: "Spoke to the client; waiting for the architect.", nextFollowUpAt: tomorrow });
  assert.equal(done.status, 200, done.text?.slice(0, 200));
  const afterDone = await db.collection("leads").findOne({ _id: "ld_overdue_3d" });
  assert.equal(new Date(afterDone.nextFollowUpAt).toISOString(), tomorrow);
  assert.ok(afterDone.lastContactedAt && Date.now() - new Date(afterDone.lastContactedAt).getTime() < 60_000, "the last contact is now");
  const entries = await timeline("ld_overdue_3d");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Follow-up done");
  assert.match(entries[0].description, /Spoke to the client; waiting for the architect\./);
  assert.match(entries[0].description, /Next follow-up:/);
  assert.equal(entries[0].performedBy, 2);
  assert.deepEqual((await list(c.admin)).summary, { overdue: 3, today: 1, upcoming: 16 }, "the lead moved from overdue to upcoming (3 earlier + the 12 paging leads + this one)");
  const doneTasks = await db.collection("followuptasks").find({ leadId: "ld_overdue_3d" }).toArray();
  const completedTask = doneTasks.find((t) => t.status === "completed");
  const nextTask = doneTasks.find((t) => t.status === "open");
  assert.equal(doneTasks.length, 2, "exactly two tasks: the old follow-up, adopted and completed, and the next one");
  assert.deepEqual([completedTask.createdVia, completedTask.ownerId, completedTask.completedBy, nextTask.createdVia, nextTask.ownerId, nextTask.version], ["backfill", 2, 2, "crm", 2, 1], "both have an owner");
  const owned = (await list(c.admin, "?search=Overdue Three")).rows[0];
  assert.deepEqual([owned.followUpOwnerId, owned.followUpOwnerName], [2, "Admin A"], "the list shows who owns it");

  assert.equal((await act(c.admin, "ld_overdue_1d", { action: "done", nextFollowUpAt: null })).status, 200);
  const cleared = await db.collection("leads").findOne({ _id: "ld_overdue_1d" });
  assert.equal(cleared.nextFollowUpAt, null, "done with no next follow-up clears the date");
  assert.match((await timeline("ld_overdue_1d"))[0].description, /No next follow-up planned/);
  assert.equal(ids((await list(c.admin)).rows).includes("ld_overdue_1d"), false, "and it leaves the list");

  const moved = await act(c.admin, "ld_today", { action: "reschedule", note: "Client asked for Friday.", nextFollowUpAt: istDay(3, 15).toISOString() });
  assert.equal(moved.status, 200);
  const movedDoc = await db.collection("leads").findOne({ _id: "ld_today" });
  assert.equal(movedDoc.lastContactedAt ?? null, null, "rescheduling is not a contact");
  const movedEntry = (await timeline("ld_today"))[0];
  assert.equal(movedEntry.title, "Follow-up rescheduled");
  assert.match(movedEntry.description, /Moved from .* to .*Client asked for Friday\./);

  for (const [label, body, status] of [
    ["reschedule without a date", { action: "reschedule" }, 400],
    ["done without saying what is next", { action: "done" }, 400],
    ["a date in the past", { action: "reschedule", nextFollowUpAt: istDay(-1, 10).toISOString() }, 400],
    ["a time earlier today that has passed", { action: "reschedule", nextFollowUpAt: new Date(Date.now() - 60_000).toISOString() }, 400],
    ["done with a next time that has passed", { action: "done", nextFollowUpAt: new Date(Date.now() - 60_000).toISOString() }, 400],
    ["an owner that is not a number", { action: "reschedule", nextFollowUpAt: tomorrow, ownerId: "me" }, 400],
    ["a date that is not a string", { action: "reschedule", nextFollowUpAt: 12345 }, 400],
    ["not a date", { action: "reschedule", nextFollowUpAt: "next friday" }, 400],
    ["more than two years ahead", { action: "reschedule", nextFollowUpAt: istDay(900).toISOString() }, 400],
    ["unknown action", { action: "snooze", nextFollowUpAt: tomorrow }, 400],
    ["an extra field", { action: "done", nextFollowUpAt: tomorrow, status: "won" }, 400],
  ]) {
    const res = await act(c.admin, "ld_up_2d", body);
    assert.equal(res.status, status, `${label}: ${res.status} ${res.text?.slice(0, 120)}`);
  }
  assert.equal(new Date((await db.collection("leads").findOne({ _id: "ld_up_2d" })).nextFollowUpAt).toISOString(), istDay(2).toISOString(), "refused requests change nothing");
  assert.equal((await timeline("ld_up_2d")).length, 0);
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "ld_up_2d" }), 0, "and no task was created for any refused request");
  const pastTime = await act(c.admin, "ld_up_2d", { action: "reschedule", nextFollowUpAt: new Date(Date.now() - 60_000).toISOString() });
  assert.match(pastTime.text, /not passed yet/, "the message says what to do");
  // Like every text field in the app, an over-long note is cut to its limit rather than refused.
  assert.equal((await act(c.admin, "ld_page_0", { action: "done", nextFollowUpAt: tomorrow, note: "x".repeat(5000) })).status, 200);
  const longNote = (await timeline("ld_page_0"))[0];
  assert.ok(longNote.description.length < 1100 && longNote.description.includes("x".repeat(1000)) && !longNote.description.includes("x".repeat(1001)), "the note is kept to 1000 characters");
  assert.equal((await act(c.admin, "ld_won", { action: "done", nextFollowUpAt: tomorrow })).status, 409, "a won lead has no follow-up");
  assert.equal((await act(c.admin, "ld_other_company", { action: "done", nextFollowUpAt: tomorrow })).status, 404, "another company's lead");
  assert.equal((await act(c.admin, "ld_missing", { action: "done", nextFollowUpAt: tomorrow })).status, 404);
  assert.equal((await act(c.viewer, "ld_up_2d", { action: "done", nextFollowUpAt: tomorrow })).status, 403, "viewing is not enough to change follow-ups");
  assert.equal((await act(c.dealer, "ld_up_2d", { action: "done", nextFollowUpAt: tomorrow })).status, 403);
  assert.equal((await act(null, "ld_up_2d", { action: "done", nextFollowUpAt: tomorrow })).status, 401);
  pass("marking done or rescheduling: recorded in the timeline, last contact updated for done only, clearing works, bad dates / fields / won leads / other companies / missing permission are refused and change nothing");

  // ═══ owners ═══
  const openTask = (leadId) => db.collection("followuptasks").find({ leadId, status: "open" }).toArray();
  const owners = await api(c.admin, "GET", "/api/crm/follow-up-owners");
  assert.equal(owners.status, 200);
  assert.deepEqual(owners.data.map((o) => o.id).sort((a, b) => a - b), [2, 11], "the people a follow-up can be given to: active members who can manage leads (not the read-only Viewer, a role without CRM, the Dealer, or another company's admin)");
  assert.deepEqual((await api(c.adminB, "GET", "/api/crm/follow-up-owners")).data.map((o) => o.id), [8], "each company sees its own people only");
  assert.equal((await api(c.viewer, "GET", "/api/crm/follow-up-owners")).status, 403, "assigning needs leads:manage");
  assert.equal((await api(c.dealer, "GET", "/api/crm/follow-up-owners")).status, 403);
  assert.equal((await api(null, "GET", "/api/crm/follow-up-owners")).status, 401);

  const handed = await act(c.admin, "ld_up_10d", { action: "reschedule", nextFollowUpAt: istDay(11, 10).toISOString(), ownerId: 11, expectedNextFollowUpAt: istDay(10).toISOString() });
  assert.equal(handed.status, 200, handed.text?.slice(0, 200));
  assert.deepEqual((await openTask("ld_up_10d")).map((t) => t.ownerId), [11], "an old follow-up handed to someone is adopted straight to them");
  assert.deepEqual((await timeline("ld_up_10d")).map((e) => e.title), ["Follow-up rescheduled"], "that is not a hand-over");
  assert.equal((await act(c.manager, "ld_up_10d", { action: "reschedule", nextFollowUpAt: istDay(12, 10).toISOString(), ownerId: 2 })).status, 200, "a person who can manage leads can hand it back");
  assert.deepEqual([(await openTask("ld_up_10d"))[0].ownerId, (await openTask("ld_up_10d"))[0].version], [2, 3]);
  assert.deepEqual((await timeline("ld_up_10d")).map((e) => e.title).sort(), ["Follow-up owner changed", "Follow-up rescheduled", "Follow-up rescheduled"]);
  const looked = await api(c.admin, "GET", "/api/crm/leads/ld_up_10d/follow-up");
  assert.deepEqual([looked.status, looked.data.task.ownerId, looked.data.task.ownerName, looked.data.legacy], [200, 2, "Admin A", false], "a screen can ask who owns a lead's follow-up");
  assert.deepEqual([(await api(c.admin, "GET", "/api/crm/leads/ld_up_2d/follow-up")).data.legacy, (await api(c.adminB, "GET", "/api/crm/leads/ld_up_2d/follow-up")).status, (await api(c.dealer, "GET", "/api/crm/leads/ld_up_2d/follow-up")).status], [true, 404, 403], "an old follow-up says so; another company's lead is not found; a Dealer has no access");

  for (const [label, ownerId] of [["a Dealer", 4], ["a read-only role", 7], ["a role without CRM", 9], ["another company's admin", 8], ["nobody", 99999]]) {
    const res = await act(c.admin, "ld_up_2d", { action: "reschedule", nextFollowUpAt: tomorrow, ownerId });
    assert.equal(res.status, 400, `${label} cannot own a follow-up: ${res.status} ${res.text?.slice(0, 120)}`);
  }
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "ld_up_2d" }), 0, "a refused hand-over adopts nothing");
  assert.equal(new Date((await db.collection("leads").findOne({ _id: "ld_up_2d" })).nextFollowUpAt).toISOString(), istDay(2).toISOString(), "and changes nothing");
  pass("owners: only active members who can manage leads can own a follow-up; handing over works from Done / Reschedule; a screen can ask who owns it; refused hand-overs change nothing");

  // ═══ the stale-view guard, cancel ═══
  const stale = await act(c.admin, "ld_page_1", { action: "done", nextFollowUpAt: tomorrow, expectedNextFollowUpAt: istDay(5).toISOString() });
  assert.equal(stale.status, 409, "someone changed it since the person looked");
  assert.match(stale.text, /changed by someone else/);
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "ld_page_1" }), 0, "a refused request adopts nothing");
  assert.equal((await act(c.admin, "ld_page_1", { action: "done", nextFollowUpAt: tomorrow, expectedNextFollowUpAt: istDay(21).toISOString() })).status, 200, "with the date the person saw, it goes through");
  assert.equal((await act(c.admin, "ld_page_1", { action: "done", nextFollowUpAt: tomorrow, expectedNextFollowUpAt: istDay(21).toISOString() })).status, 409, "a second person acting on the same, old view is told");

  const cancelled = await act(c.admin, "ld_page_2", { action: "cancel", note: "Customer went elsewhere." });
  assert.equal(cancelled.status, 200, cancelled.text?.slice(0, 200));
  assert.equal((await db.collection("leads").findOne({ _id: "ld_page_2" })).nextFollowUpAt, null);
  assert.deepEqual((await timeline("ld_page_2")).map((e) => e.title), ["Follow-up cancelled"]);
  assert.match((await timeline("ld_page_2"))[0].description, /Customer went elsewhere\./);
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "ld_page_2" }), 0, "cancelling an old follow-up needs no task");
  assert.equal((await act(c.admin, "ld_page_2", { action: "cancel" })).status, 409, "nothing left to cancel");
  assert.equal((await act(c.viewer, "ld_page_3", { action: "cancel" })).status, 403, "viewing is not enough");
  const cancelTask = await act(c.admin, "ld_overdue_3d", { action: "cancel" });
  assert.equal(cancelTask.status, 200);
  assert.deepEqual((await db.collection("followuptasks").find({ leadId: "ld_overdue_3d" }).toArray()).map((t) => t.status).sort(), ["cancelled", "completed"], "a follow-up that has a task is closed as cancelled, and its history stays");
  pass("a request from an out-of-date view is refused (409) without changing anything; Cancel clears an old or a tracked follow-up, with history");

  // lead create / edit sets and clears the date
  const created = await api(c.admin, "POST", "/api/crm/leads", { customerName: "With Follow-up", phone: "9000000123", nextFollowUpAt: istDay(5, 12).toISOString() });
  assert.equal(created.status, 201, created.text?.slice(0, 160));
  assert.equal(new Date((await db.collection("leads").findOne({ _id: created.data.id })).nextFollowUpAt).toISOString(), istDay(5, 12).toISOString());
  const createdTasks = await openTask(created.data.id);
  assert.deepEqual(createdTasks.map((t) => [t.ownerId, t.createdVia, t.version]), [[2, "crm", 1]], "a lead created with a follow-up gets its task, owned by whoever created it");
  const owned2 = await api(c.admin, "POST", "/api/crm/leads", { customerName: "Owned By Manager", phone: "9000000124", nextFollowUpAt: istDay(6, 12).toISOString(), followUpOwnerId: 11 });
  assert.equal(owned2.status, 201);
  assert.equal((await openTask(owned2.data.id))[0].ownerId, 11, "or whoever is chosen");
  const leadCount = () => db.collection("leads").countDocuments({});
  const leadsBefore = await leadCount();
  assert.equal((await api(c.admin, "POST", "/api/crm/leads", { customerName: "Rollback Probe", phone: "9000000125", nextFollowUpAt: istDay(6).toISOString(), followUpOwnerId: 4 })).status, 400, "a Dealer cannot own it");
  assert.equal((await api(c.admin, "POST", "/api/crm/leads", { customerName: "Rollback Probe", phone: "9000000125", followUpOwnerId: 11 })).status, 400, "an owner needs a date");
  assert.equal(await leadCount(), leadsBefore, "a refused lead is not created at all (the lead, its task and its timeline are written together)");
  assert.equal(await db.collection("crmactivities").countDocuments({ title: "Lead Created", description: /Rollback Probe/ }), 0, "and leaves no timeline entry behind");

  // a request that does not mention the follow-up leaves it alone
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { priority: "high" })).status, 200);
  const untouched = await db.collection("leads").findOne({ _id: created.data.id });
  assert.equal(new Date(untouched.nextFollowUpAt).toISOString(), istDay(5, 12).toISOString(), "a partial edit does not clear the follow-up");
  assert.deepEqual(await openTask(created.data.id).then((t) => t.map((x) => x.version)), [1], "nor touch its task");
  // moving, handing over, clearing
  const taskBefore = (await openTask(created.data.id))[0];
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { nextFollowUpAt: istDay(7, 12).toISOString() })).status, 200);
  const taskMoved = (await openTask(created.data.id))[0];
  assert.deepEqual([taskMoved._id, taskMoved.version, new Date(taskMoved.dueAt).toISOString()], [taskBefore._id, 2, istDay(7, 12).toISOString()], "editing the date moves the same task");
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { followUpOwnerId: 11 })).status, 200);
  assert.deepEqual([(await openTask(created.data.id))[0].ownerId, (await timeline(created.data.id)).at(-1).title], [11, "Follow-up owner changed"]);
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { followUpOwnerId: 4 })).status, 400, "a Dealer cannot be handed a follow-up");
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { nextFollowUpAt: null })).status, 200);
  assert.equal((await db.collection("leads").findOne({ _id: created.data.id })).nextFollowUpAt, null, "an edit can clear it");
  assert.equal((await openTask(created.data.id)).length, 0, "and its task is closed (kept as history)");
  assert.equal((await api(c.admin, "PATCH", `/api/crm/leads/${created.data.id}`, { nextFollowUpAt: "soon" })).status, 400);
  pass("a follow-up date can be set when creating a lead (with its owner, atomically), changed, handed over and cleared when editing; a request that does not mention it leaves it alone");

  // the invariants that make the lead's date and its task safe to rely on
  const duplicates = await db.collection("followuptasks").aggregate([{ $match: { status: "open" } }, { $group: { _id: { companyId: "$companyId", leadId: "$leadId" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
  assert.deepEqual(duplicates, [], "no lead has two open follow-ups");
  for (const task of await db.collection("followuptasks").find({ status: "open" }).toArray()) {
    const owner = await db.collection("adminusers").findOne({ _id: task.ownerId });
    assert.ok(owner && owner.isActive !== false && owner.companyId === task.companyId, `${task.leadId}: the owner is an active member of the same company`);
    assert.equal(new Date((await db.collection("leads").findOne({ _id: task.leadId })).nextFollowUpAt).getTime(), new Date(task.dueAt).getTime(), `${task.leadId}: the lead's date equals its open task's date`);
  }
  pass("whatever was done above, no lead has two open follow-ups, every open task has an active owner of the same company, and each lead's date equals its task's");

  // ═══ the private calendar link ═══
  const feedApi = (cookie, method = "GET") => fetch(`${baseUrl}/api/crm/follow-ups/calendar-feed`, { method, headers: cookie ? { Cookie: cookie } : {} }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
  const off = await feedApi(c.admin);
  assert.deepEqual([off.status, off.json.data.enabled, off.json.data.url], [200, false, null], "off until the person creates it");
  assert.equal(off.json.data.publiclyReachable, false, "a plain-http local address cannot be read by Google, and the person is told");
  assert.equal((await feedApi(c.dealer, "POST")).status, 403, "a dealer cannot have one");
  assert.equal((await feedApi(c.nocrm, "POST")).status, 403);
  assert.equal((await feedApi(null, "POST")).status, 401);

  const first = await feedApi(c.admin, "POST");
  assert.equal(first.status, 201);
  const url1 = first.json.data.url;
  assert.match(url1, new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/calendar/follow-ups/[A-Za-z0-9_-]{43}\\.ics$`));
  assert.equal((await feedApi(c.admin)).json.data.url, url1, "the person can see the same link again");
  const token1 = url1.split("/").pop().replace(".ics", "");
  const stored = await db.collection("calendarfeeds").findOne({ userId: 2 });
  assert.equal(stored.tokenHash, createHash("sha256").update(token1).digest("hex"), "the database holds only the hash for lookups");
  assert.ok(stored.tokenSealed && !stored.tokenSealed.includes(token1) && !JSON.stringify(stored).includes(token1), "and an encrypted copy, never the secret itself");
  assert.notEqual((await feedApi(c.viewer, "POST")).json.data.url, url1, "everyone has their own link");
  assert.equal((await feedApi(c.admin)).json.data.url, url1, "and cannot see or change anyone else's");

  const fetchFeed = (url, init) => fetch(url, init);
  const publicFeed = await fetchFeed(url1);
  assert.equal(publicFeed.status, 200, "no sign-in needed");
  assert.match(publicFeed.headers.get("content-type"), /^text\/calendar/);
  assert.match(publicFeed.headers.get("x-robots-tag"), /noindex/);
  assert.match(publicFeed.headers.get("cache-control"), /private/);
  const body = await publicFeed.text();
  const uids = [...body.matchAll(/^UID:followup-([^@\r]+)@/gm)].map((m) => m[1]).sort();
  const expected = (await list(c.admin, "?pageSize=100")).rows.filter((r) => new Date(r.nextFollowUpAt) >= new Date(Date.now() - 30 * DAY) && new Date(r.nextFollowUpAt) <= new Date(Date.now() + 365 * DAY)).map((r) => r.id).sort();
  assert.deepEqual(uids, expected, "the calendar holds exactly the open, dated leads within the window (a month back to a year ahead)");
  for (const absent of ["ld_won", "ld_lost", "ld_nodate", "ld_deleted", "ld_other_company", "ld_far", "ld_overdue_45d", "ld_overdue_1d"]) assert.ok(!uids.includes(absent), `${absent} is not in the calendar`);
  assert.ok(body.includes("SUMMARY:Follow up: Overdue Old") === false && body.includes("SUMMARY:Follow up: Upcoming Ten"));
  assert.ok(!/estimatedBudget|budget/i.test(body), "no budget in the calendar");
  assert.ok(uids.includes("ld_up_10d") && !/Private price talk|12% off/.test(body), "a lead's notes (free text, which can hold prices) are not in the calendar, although its entry is");
  assert.match((await list(c.admin, "?search=Upcoming Ten")).rows[0].notes ?? "", /Private price talk/, "while the CRM screen itself still shows them");
  assert.equal((await fetchFeed(url1, { method: "HEAD" })).status, 200, "calendar apps may check with HEAD");
  const used = (await feedApi(c.admin)).json.data;
  assert.ok(used.lastFetchedAt && used.fetchCount >= 1, "the person can see that a calendar app read it");

  // the viewer (custom role) sees the whole company by the CRM visibility rule, the other company only its own
  const viewerFeedUrl = (await feedApi(c.viewer)).json.data.url;
  assert.equal((await fetchFeed(viewerFeedUrl)).status, 200);
  const bFeed = (await feedApi(c.adminB, "POST")).json.data.url;
  const bUids = [...(await (await fetchFeed(bFeed)).text()).matchAll(/^UID:followup-([^@\r]+)@/gm)].map((m) => m[1]);
  assert.deepEqual(bUids, ["ld_other_company"], "company B's calendar holds only company B's follow-up");
  assert.ok(!uids.includes("ld_other_company"));
  pass("the private link: created per person, shown again, stored as a hash and an encrypted copy; the public calendar file holds exactly that person's open follow-ups, with no budget, and other companies are separate");

  // the link must stop working when it should
  const bad = async (label, url, init) => {
    const res = await fetchFeed(url, init);
    assert.ok([401, 404].includes(res.status), `${label}: ${res.status}`);
    assert.ok(!(res.headers.get("content-type") ?? "").includes("calendar"), `${label}: no calendar served`);
  };
  const tamper = token1.slice(0, -1) + (token1.endsWith("A") ? "B" : "A");
  await bad("a wrong secret", url1.replace(token1, tamper));
  await bad("a valid-looking unknown secret", url1.replace(token1, "z".repeat(43)));
  await bad("a short secret", url1.replace(token1, "abc"));
  await bad("no .ics ending", url1.replace(".ics", ""));
  await bad("posting to it", url1, { method: "POST" });

  const second = await feedApi(c.admin, "POST");
  const url2 = second.json.data.url;
  assert.notEqual(url2, url1);
  await bad("the old link after a new one was generated", url1);
  assert.equal((await fetchFeed(url2)).status, 200, "the new link works");
  assert.equal((await feedApi(c.admin, "DELETE")).json.data.enabled, false);
  await bad("a link that was turned off", url2);
  assert.equal(await db.collection("calendarfeeds").countDocuments({ userId: 2, tokenHash: null, tokenSealed: null }), 1, "turning it off removes the secret");
  const third = (await feedApi(c.admin, "POST")).json.data.url;
  assert.equal((await fetchFeed(third)).status, 200, "it can be turned on again, with a new link");
  await bad("the link from before it was turned off", url2);

  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { permissions: ["quotations:read_all"] } });
  await bad("a person who lost the leads:read permission", viewerFeedUrl);
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { permissions: ["leads:read"] } });
  assert.equal((await fetchFeed(viewerFeedUrl)).status, 200, "and it works again when the permission returns");
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { isActive: false } });
  await bad("a deactivated person", viewerFeedUrl);
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { isActive: true } });
  await db.collection("companies").updateOne({ _id: 20 }, { $set: { status: "suspended" } });
  await bad("a suspended company", bFeed);
  await db.collection("companies").updateOne({ _id: 20 }, { $set: { status: "active" } });
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { role: "dealer" } });
  await bad("a person whose role no longer allows CRM", viewerFeedUrl);
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { role: "configurable_admin" } });
  pass("the link stops working when it is replaced or turned off, for a wrong or malformed secret, and for a person who was deactivated, lost the permission or changed role, or whose company is suspended");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-2500));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
