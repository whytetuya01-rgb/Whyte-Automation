/**
 * Follow-ups left behind by a deactivated person, through the real API (production-mode server + throwaway local MongoDB):
 *   - deactivating someone through the real user-management route flags their open follow-ups for the Company Owner,
 *     and NOTHING is moved by itself;
 *   - who may see and reassign them, company isolation, the summary the Follow-ups screen uses;
 *   - the explicit bulk reassignment: the previous owner and a history are kept, the date and the lead are untouched,
 *     the timeline records it, stale and ineligible requests are refused or skipped, two people doing it at once is safe,
 *     a full batch of 200 goes through, and reactivating the person clears the flag.
 *
 *   node tests/follow-up-reassignment-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const DAY = 24 * 3600 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();
// Permission and activity changes normally apply within 30 seconds (the app's session cache); here they apply at once.
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

try {
  server = await startIsolatedServer("fureassign", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner@example.com", role: "company_owner", name: "Olivia Owner", companyId: 10 },
    { _id: 3, email: "admin@example.com", role: "admin", name: "Adam Admin", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "gone@example.com", role: "configurable_admin", name: "Gita Gone", permissions: ["leads:manage"], companyId: 10 },
    { _id: 6, email: "manager@example.com", role: "configurable_admin", name: "Maya Manager", permissions: ["leads:manage", "users:manage"], companyId: 10 },
    { _id: 7, email: "leadsonly@example.com", role: "configurable_admin", name: "Lena Leads", permissions: ["leads:manage"], companyId: 10 },
    { _id: 8, email: "viewer@example.com", role: "configurable_admin", name: "Vic Viewer", permissions: ["leads:read"], companyId: 10 },
    { _id: 9, email: "salesexec@example.com", role: "sales_executive", name: "Sam Sales", companyId: 10 },
    { _id: 12, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 13, email: "goneb@example.com", role: "configurable_admin", name: "Gone B", permissions: ["leads:manage"], companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [cid, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const c = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    gone: await login("gone@example.com", "admin"),
    manager: await login("manager@example.com", "admin"),
    leadsOnly: await login("leadsonly@example.com", "admin"),
    viewer: await login("viewer@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    super: await login("super@example.com", "admin"),
    ownerB: await login("ownerb@example.com", "admin"),
    goneB: await login("goneb@example.com", "admin"),
  };

  const createLead = async (cookie, name, due) => {
    const response = await api(cookie, "POST", "/api/crm/leads", { customerName: name, phone: "9876543210", status: "contacted", priority: "medium", nextFollowUpAt: due });
    assert.equal(response.status, 201, `create ${name}: ${response.text?.slice(0, 300)}`);
    return response.data.id;
  };
  const taskOf = (leadId) => db.collection("followuptasks").findOne({ leadId, status: "open" });
  const review = (cookie, query = "") => api(cookie, "GET", `/api/crm/follow-ups/reassignment${query}`);
  const reassign = (cookie, body) => api(cookie, "POST", "/api/crm/follow-ups/reassign", body);

  // Gita owns three follow-ups; Adam owns one; company B's Gone B owns one.
  const g1 = await createLead(c.gone, "Gone One", inDays(2));
  const g2 = await createLead(c.gone, "Gone Two", inDays(1));
  const g3 = await createLead(c.gone, "Gone Three (will be won)", inDays(3));
  const a1 = await createLead(c.admin, "Adam One", inDays(2));
  const b1 = await createLead(c.goneB, "Other Company One", inDays(1));
  assert.equal((await taskOf(g1)).ownerId, 5, "created by Gita, so Gita owns it");

  // ═══ nothing is flagged while everyone is active ═══
  const quiet = await review(c.owner);
  assert.equal(quiet.status, 200, quiet.text?.slice(0, 200));
  assert.deepEqual([quiet.data.canReassign, quiet.data.groups, quiet.data.totals], [true, [], { tasks: 0, owners: 0 }]);
  pass("while everyone is active nothing is flagged");

  // ═══ deactivating through the real route flags the follow-ups, and moves nothing ═══
  const off = await api(c.owner, "PATCH", "/api/admin/users/5", { isActive: false });
  assert.equal(off.status, 200, off.text?.slice(0, 200));
  await db.collection("leads").updateOne({ _id: g3 }, { $set: { status: "won" } });
  const offB = await api(c.ownerB, "PATCH", "/api/admin/users/13", { isActive: false });
  assert.equal(offB.status, 200, offB.text?.slice(0, 200));

  const flagged = await review(c.owner);
  assert.equal(flagged.status, 200);
  assert.deepEqual(flagged.data.groups.map((g) => [g.ownerId, g.ownerName, g.problem, g.tasks]), [[5, "Gita Gone", "deactivated", 2]], "Gita's two open follow-ups; the won lead's is not counted; Adam's and the other company's are not shown");
  assert.deepEqual(flagged.data.totals, { tasks: 2, owners: 1 });
  assert.deepEqual(flagged.data.tasks.map((t) => [t.leadId, t.customerName, t.ownerId, t.problem]).sort(), [[g1, "Gone One", 5, "deactivated"], [g2, "Gone Two", 5, "deactivated"]].sort());
  assert.ok(flagged.data.tasks.every((t) => typeof t.version === "number" && t.referenceNumber.startsWith("LD-")), "each row carries what the screen needs");
  assert.equal(flagged.data.tasks[0].leadId, g2, "earliest due first");
  const summary = await review(c.owner, "?summary=1");
  assert.deepEqual([summary.data.canReassign, summary.data.totals, summary.data.tasks], [true, { tasks: 2, owners: 1 }, undefined], "the summary counts without listing");

  assert.equal((await taskOf(g1)).ownerId, 5, "nothing was reassigned by itself: Gita still owns it");
  assert.equal((await taskOf(g2)).ownerId, 5);
  const crmList = await api(c.owner, "GET", "/api/crm/follow-ups");
  assert.equal(crmList.status, 200);
  assert.ok(crmList.data.data.some((row) => row.id === g1 && row.followUpOwnerId === 5), "and the Follow-ups list still shows the lead, still owned by Gita");
  pass("deactivating someone through the real route flags their open follow-ups (not won or lost leads), shows them to the Company Owner, and moves nothing by itself");

  // ═══ who may look ═══
  assert.equal((await review(c.admin)).status, 200, "an Admin can");
  assert.equal((await review(c.manager)).status, 200, "a custom role holding users:manage and leads:manage can");
  assert.deepEqual((await review(c.manager, "?summary=1")).data.totals, { tasks: 2, owners: 1 });
  assert.equal((await review(c.leadsOnly)).status, 403, "a manager without users:manage cannot see the list");
  const hidden = await review(c.leadsOnly, "?summary=1");
  assert.deepEqual([hidden.status, hidden.data.canReassign, hidden.data.totals], [200, false, { tasks: 0, owners: 0 }], "but the Follow-ups notice simply stays hidden for them (no names, no counts)");
  assert.equal((await review(c.viewer)).status, 403, "read-only role");
  assert.equal((await review(c.viewer, "?summary=1")).data.canReassign, false);
  assert.equal((await review(c.dealer)).status, 403, "dealers have no CRM");
  assert.equal((await fetch(`${baseUrl}/api/crm/follow-ups/reassignment`)).status, 401, "signed out");
  assert.equal((await review(c.super)).status, 403, "the platform Super Admin must act as a company first");
  const otherCompany = await review(c.ownerB);
  assert.deepEqual(otherCompany.data.groups.map((g) => [g.ownerId, g.tasks]), [[13, 1]], "another company sees only its own");
  assert.ok(!JSON.stringify(otherCompany.data).includes("Gita"), "and nothing of ours");
  pass("only people who can manage users and leads see the list; others get nothing (not even counts); signed out is refused; companies are separate");

  // ═══ who may reassign, and to whom ═══
  const pick = (...ids) => flagged.data.tasks.filter((t) => ids.includes(t.leadId)).map((t) => ({ id: t.taskId, version: t.version }));
  const body = (toOwnerId, tasks, extra = {}) => ({ toOwnerId, tasks, ...extra });
  for (const who of ["leadsOnly", "viewer", "dealer"]) {
    assert.equal((await reassign(c[who], body(3, pick(g1)))).status, 403, `${who} cannot reassign`);
  }
  assert.equal((await fetch(`${baseUrl}/api/crm/follow-ups/reassign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(3, pick(g1))) })).status, 401);

  const stateBefore = JSON.stringify([await taskOf(g1), await taskOf(g2)]);
  for (const [label, toOwnerId] of [["the deactivated person", 5], ["a read-only role", 8], ["a Dealer", 4], ["a Sales Executive", 9], ["another company's person", 12], ["nobody", 4242]]) {
    const response = await reassign(c.owner, body(toOwnerId, pick(g1)));
    assert.equal(response.status, 400, `${label}: ${response.text?.slice(0, 200)}`);
    assert.equal(response.json.error.field, "followUpOwnerId", label);
  }
  for (const [label, payload] of [
    ["no tasks", body(3, [])],
    ["too many tasks", body(3, Array.from({ length: 201 }, (_, i) => ({ id: `T${i}` })))],
    ["no new owner", { tasks: pick(g1) }],
    ["an unknown field", { ...body(3, pick(g1)), extra: true }],
    ["a bad version", body(3, [{ id: pick(g1)[0].id, version: 0 }])],
  ]) {
    assert.equal((await reassign(c.owner, payload)).status, 400, label);
  }
  assert.equal(JSON.stringify([await taskOf(g1), await taskOf(g2)]), stateBefore, "refused requests changed nothing");
  pass("only people who can manage users and leads may reassign; the new owner must be an active person of this company who can manage leads; malformed requests are refused; nothing changes when refused");

  // ═══ stale, foreign, already-fine: skipped with a reason, the rest still go through ═══
  const foreignId = (await db.collection("followuptasks").findOne({ leadId: b1, status: "open" }))._id;
  const adamId = (await taskOf(a1))._id;
  const staleId = pick(g1)[0].id;
  const mixed = await reassign(c.owner, body(3, [
    ...pick(g2),
    { id: staleId, version: pick(g1)[0].version + 5 },
    { id: foreignId },
    { id: adamId },
    { id: "no-such-task" },
  ], { note: "Gita has left the company." }));
  assert.equal(mixed.status, 200, mixed.text?.slice(0, 300));
  assert.deepEqual(mixed.data.reassigned.map((r) => r.leadId), [g2]);
  const label = (taskId) => (taskId === staleId ? "stale" : taskId === foreignId ? "foreign" : taskId === adamId ? "adam" : taskId);
  assert.deepEqual(Object.fromEntries(mixed.data.skipped.map((s) => [label(s.taskId), s.reason])), { stale: "changed", foreign: "not_found", adam: "owner_still_allowed", "no-such-task": "not_found" });
  assert.equal(mixed.data.toOwnerName, "Adam Admin");
  assert.equal((await taskOf(g1)).ownerId, 5, "the stale one was left alone");
  assert.equal((await taskOf(a1)).ownerId, 3, "an active person's follow-up cannot be taken this way");
  assert.equal((await db.collection("followuptasks").findOne({ _id: foreignId })).ownerId, 13, "another company's follow-up is untouched");
  pass("stale, foreign and still-fine follow-ups are skipped with a reason and left alone; the valid one still goes through");

  // ═══ the reassignment itself keeps the history ═══
  const moved = await taskOf(g2);
  assert.deepEqual([moved.ownerId, moved.originalOwnerId, moved.version, moved.status], [3, 5, 2, "open"]);
  assert.equal(moved.ownerHistory.length, 1);
  const entry = moved.ownerHistory[0];
  assert.deepEqual([entry.fromOwnerId, entry.toOwnerId, entry.changedBy, entry.reason, entry.batchId, entry.note], [5, 3, 2, "owner_unavailable", mixed.data.batchId, "Gita has left the company."], "who, from whom to whom, why, which batch, the note");
  assert.ok(Math.abs(new Date(entry.changedAt).getTime() - Date.now()) < 120_000, "when");
  const leadAfter = await db.collection("leads").findOne({ _id: g2 });
  assert.equal(new Date(leadAfter.nextFollowUpAt).toISOString(), new Date(moved.dueAt).toISOString(), "the follow-up date is unchanged");
  const timeline = await db.collection("crmactivities").find({ leadId: g2, type: "follow_up", title: "Follow-up owner changed" }).toArray();
  assert.equal(timeline.length, 1);
  assert.match(timeline[0].description, /Owner changed from Gita Gone \(no longer active\) to Adam Admin\. Gita has left the company\./);
  assert.equal(timeline[0].performedBy, 2);
  assert.deepEqual((await review(c.owner)).data.groups.map((g) => [g.ownerId, g.tasks]), [[5, 1]], "only the one still waiting is flagged");
  pass("the previous owner stays on the task (original owner + history with who, when, why, batch and note), the date and lead are untouched, and the lead's timeline records it");

  // ═══ two people doing the same thing at once ═══
  const bulk = async (prefix, total) => {
    const stamp = new Date();
    const leads = Array.from({ length: total }, (_, i) => ({
      _id: `${prefix}_${i}`, companyId: 10, referenceNumber: `LD-2026-${prefix === "ld_race" ? 7000 + i : 8000 + i}`, customerName: `Bulk ${prefix} ${i}`, status: "contacted", priority: "medium",
      createdBy: 2, createdAt: stamp, updatedAt: stamp, nextFollowUpAt: new Date(Date.now() + (3 + i) * 3600_000),
    }));
    const tasks = leads.map((lead, i) => ({
      _id: `ft_${prefix}_${i}`, companyId: 10, leadId: lead._id, ownerId: 5, originalOwnerId: 5, ownerHistory: [], dueAt: lead.nextFollowUpAt, status: "open", version: 1,
      scheduleChangedAt: stamp, createdVia: "crm", createdBy: 5, createdAt: stamp, updatedAt: stamp,
    }));
    await db.collection("leads").insertMany(leads);
    await db.collection("followuptasks").insertMany(tasks);
    return tasks.map((task) => ({ id: task._id, version: 1 }));
  };
  const race = await bulk("ld_race", 6);
  const [first, second] = await Promise.all([
    reassign(c.owner, body(3, race, { note: "from the owner" })),
    reassign(c.manager, body(6, race, { note: "from the manager" })),
  ]);
  assert.deepEqual([first.status, second.status], [200, 200], `${first.text?.slice(0, 200)} / ${second.text?.slice(0, 200)}`);
  assert.equal(first.data.reassigned.length + second.data.reassigned.length, race.length, "every follow-up moved exactly once between the two requests");
  for (const skipped of [...first.data.skipped, ...second.data.skipped]) assert.ok(["changed", "owner_still_allowed"].includes(skipped.reason), skipped.reason);
  for (const { id } of race) {
    const task = await db.collection("followuptasks").findOne({ _id: id });
    assert.equal(task.ownerHistory.length, 1, "one hand-over, not two");
    assert.deepEqual([task.originalOwnerId, task.version, [3, 6].includes(task.ownerId)], [5, 2, true]);
  }
  assert.equal(await db.collection("crmactivities").countDocuments({ leadId: { $in: race.map((_, i) => `ld_race_${i}`) }, title: "Follow-up owner changed" }), race.length, "and one timeline entry each");
  pass("two people reassigning the same follow-ups at the same moment: each follow-up moves exactly once, with one history entry and one timeline entry");

  // ═══ a full batch ═══
  const full = await bulk("ld_full", 200);
  const started = Date.now();
  const big = await reassign(c.owner, body(3, full));
  assert.equal(big.status, 200, big.text?.slice(0, 300));
  assert.equal(big.data.reassigned.length, 200);
  assert.deepEqual(big.data.skipped, []);
  assert.ok(Date.now() - started < 30_000, `200 follow-ups took ${Date.now() - started} ms`);
  assert.equal(await db.collection("followuptasks").countDocuments({ _id: { $in: full.map((t) => t.id) }, ownerId: 3, originalOwnerId: 5 }), 200);
  pass(`a full batch of 200 follow-ups is reassigned in one request (${Date.now() - started} ms)`);

  // ═══ the list is capped, and says so ═══
  const stamp = new Date();
  const extraLeads = Array.from({ length: 2000 }, (_, i) => ({ _id: `ld_cap_${i}`, companyId: 10, referenceNumber: `LD-2026-${20000 + i}`, customerName: `Cap ${i}`, status: "contacted", priority: "low", createdBy: 2, createdAt: stamp, updatedAt: stamp, nextFollowUpAt: new Date(Date.now() + (10 + i) * 60_000) }));
  await db.collection("leads").insertMany(extraLeads);
  await db.collection("followuptasks").insertMany(extraLeads.map((lead, i) => ({ _id: `ft_cap_${i}`, companyId: 10, leadId: lead._id, ownerId: 5, originalOwnerId: 5, ownerHistory: [], dueAt: lead.nextFollowUpAt, status: "open", version: 1, scheduleChangedAt: stamp, createdVia: "crm", createdBy: 5, createdAt: stamp, updatedAt: stamp })));
  const capped = await review(c.owner);
  assert.equal(capped.status, 200);
  assert.deepEqual([capped.data.truncated, capped.data.tasks.length], [true, 2000], "only the earliest 2000 are listed, and the screen is told there are more");
  const cappedSummary = await review(c.owner, "?summary=1");
  assert.equal(cappedSummary.data.truncated, true, "the summary says so too, so the notice can say 'at least'");
  await db.collection("followuptasks").deleteMany({ _id: /^ft_cap_/ });
  await db.collection("leads").deleteMany({ _id: /^ld_cap_/ });
  pass("a very long list is capped at 2000 and says so (also in the summary)");

  // ═══ reactivating clears the flag ═══
  // (The existing account route saves a custom-role person with an empty permission list unless it is sent again, so it is sent.
  // Until then the person is still flagged, as "no longer allowed to manage leads": the flag follows the account, not a stored mark.)
  const stillFlagged = await review(c.owner);
  assert.ok(stillFlagged.data.totals.tasks >= 1, "Gita's remaining follow-up is still flagged");
  const on = await api(c.owner, "PATCH", "/api/admin/users/5", { isActive: true, permissions: ["leads:manage"] });
  assert.equal(on.status, 200, on.text?.slice(0, 200));
  const afterOn = await review(c.owner);
  assert.deepEqual(afterOn.data.totals, { tasks: 0, owners: 0 }, `the flag is worked out each time, so reactivating the person removes it: ${JSON.stringify(afterOn.data.groups)}`);
  assert.equal((await taskOf(g1)).ownerId, 5, "and nothing was moved");
  pass("reactivating the person clears the flag without moving anything");

  console.log(`\nALL ${count} FOLLOW-UP REASSIGNMENT API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
