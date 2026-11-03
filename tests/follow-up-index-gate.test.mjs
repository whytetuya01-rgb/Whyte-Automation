/**
 * What a production app does when the follow-up index has not been deployed yet (the controlled index procedure has not
 * been run): only a request that would CREATE a follow-up task stops, with a clear 503 and no change; everything else in the
 * CRM keeps working. Deploying the index fixes the running app without a restart.
 *
 * The server runs with the production index policy (MONGOOSE_AUTO_INDEX=0): it creates no collection and no index by itself.
 *
 *   node tests/follow-up-index-gate.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const DAY = 24 * 3600 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY);
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

try {
  server = await startIsolatedServer("fugate", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
  ], { production: true, autoIndex: false });
  const { db, login, api } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "c10", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const admin = await login("admin@example.com", "admin");

  const taskIndexNames = async () => {
    try {
      return (await db.collection("followuptasks").indexes()).map((index) => index.name);
    } catch {
      return null; // the collection does not exist
    }
  };
  const snapshot = async () => JSON.stringify({
    leads: await db.collection("leads").find({}).sort({ _id: 1 }).toArray(),
    tasks: await db.collection("followuptasks").find({}).sort({ _id: 1 }).toArray(),
    activities: (await db.collection("crmactivities").find({}).toArray()).length,
  });
  const lead = { customerName: "Gate Test", phone: "9876543210", status: "new", priority: "medium" };

  // ── nothing exists, and nothing is created by using the app ──
  assert.equal(await taskIndexNames(), null, "the follow-up collection does not exist yet");

  // ── things that create no task keep working ──
  const plain = await api(admin, "POST", "/api/crm/leads", lead);
  assert.equal(plain.status, 201, `a lead with no follow-up date is created: ${plain.text?.slice(0, 300)}`);
  const plainId = plain.data.id;
  const edited = await api(admin, "PATCH", `/api/crm/leads/${plainId}`, { priority: "high", notes: "Called back." });
  assert.equal(edited.status, 200, `an edit that leaves the follow-up alone works: ${edited.text?.slice(0, 300)}`);
  assert.equal((await db.collection("leads").findOne({ _id: plainId })).priority, "high");
  const list = await api(admin, "GET", "/api/crm/follow-ups");
  assert.equal(list.status, 200, "the follow-up list works without the collection");
  const owners = await api(admin, "GET", "/api/crm/follow-up-owners");
  assert.equal(owners.status, 200, "the owner choices work");
  const review = await api(admin, "GET", "/api/crm/follow-ups/reassignment");
  assert.equal(review.status, 200, "the reassignment review works without the collection");
  assert.deepEqual(review.data.totals, { tasks: 0, owners: 0 });
  assert.equal(await taskIndexNames(), null, "none of that created the follow-up collection or any index");
  pass("with no follow-up index deployed, leads can still be created and edited and the follow-up screens work; none of it creates a collection or an index");

  // ── things that would create a task stop, safely ──
  const before = await snapshot();
  const expectGate = (response, label) => {
    assert.equal(response.status, 503, `${label}: ${response.text?.slice(0, 300)}`);
    assert.equal(response.json?.error?.code, "SERVICE_UNAVAILABLE", label);
    assert.match(response.json?.error?.message ?? "", /index deployment/, label);
    assert.ok(JSON.stringify(response.json?.error?.details ?? {}).includes("one_open_task_per_lead"), `${label}: names the missing index`);
  };
  expectGate(await api(admin, "POST", "/api/crm/leads", { ...lead, customerName: "With Date", nextFollowUpAt: inDays(3).toISOString() }), "a new lead with a follow-up date");
  expectGate(await api(admin, "PATCH", `/api/crm/leads/${plainId}`, { nextFollowUpAt: inDays(4).toISOString() }), "setting a follow-up date on a lead");
  assert.equal(await snapshot(), before, "stopped requests changed nothing: no lead, no task, no timeline entry, no date");
  assert.equal(await taskIndexNames(), null, "and still no collection or index was created by a request");
  pass("a request that would create a follow-up task stops with a clear 503 naming the missing index, and changes nothing (the new lead is not left behind either)");

  // ── an old follow-up (no task yet) is adopted by the first change, so that is gated too ──
  await db.collection("leads").insertOne({
    _id: "ld_legacy", companyId: 10, referenceNumber: "LD-2026-9001", customerName: "Old Follow-up", phone: "9876500001", status: "contacted", priority: "medium",
    createdBy: 2, createdAt: new Date(now - 30 * DAY), updatedAt: new Date(now - DAY), nextFollowUpAt: inDays(2),
  });
  const legacyBefore = await snapshot();
  expectGate(await api(admin, "POST", "/api/crm/leads/ld_legacy/follow-up", { action: "reschedule", nextFollowUpAt: inDays(5).toISOString() }), "rescheduling an old follow-up");
  assert.equal(await snapshot(), legacyBefore, "the old follow-up is exactly as it was");
  // removing it needs no task to be created, so it is allowed
  const cleared = await api(admin, "POST", "/api/crm/leads/ld_legacy/follow-up", { action: "cancel" });
  assert.equal(cleared.status, 200, `cancelling an old follow-up creates no task: ${cleared.text?.slice(0, 300)}`);
  assert.equal((await db.collection("leads").findOne({ _id: "ld_legacy" })).nextFollowUpAt, null);
  pass("changing an old follow-up (it becomes a task) is gated; cancelling it creates nothing and is not");

  // ── deploying the index fixes the running app without a restart ──
  await db.collection("followuptasks").createIndex(
    { companyId: 1, leadId: 1 },
    { name: "one_open_task_per_lead", unique: true, partialFilterExpression: { status: "open" } }
  );
  let created;
  for (let attempt = 0; attempt < 12 && !created; attempt += 1) {
    const response = await api(admin, "POST", "/api/crm/leads", { ...lead, customerName: "After Deploy", nextFollowUpAt: inDays(3).toISOString() });
    if (response.status === 201) created = response;
    else {
      assert.equal(response.status, 503, `still gated while the earlier failure is remembered: ${response.text?.slice(0, 200)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  assert.ok(created, "within about 25 seconds of the index being deployed the same request works, with no restart");
  const task = await db.collection("followuptasks").findOne({ leadId: created.data.id });
  assert.ok(task && task.status === "open" && task.ownerId === 2, "and its follow-up task exists");
  pass("once the index is deployed the same request succeeds without restarting the app, and creates the task");

  console.log(`\nALL ${count} FOLLOW-UP INDEX GATE TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
