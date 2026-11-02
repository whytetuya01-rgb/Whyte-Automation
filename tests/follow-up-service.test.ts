/**
 * Follow-up tasks (src/lib/followUpService.ts, src/lib/followUpBackfill.ts) against a real, throwaway local MongoDB:
 * who may own a follow-up, the lead form, Done / Reschedule / Cancel, old follow-ups that have no task yet, a lead whose
 * date and task disagree, the stale-view guard, all-or-nothing writes, two requests at once, the one-open-task rule, and
 * the backfill (a dry run writes nothing; a second run adds nothing).
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/follow-up-service.test.ts
 *
 * Never reads .env / .env.local; uses 127.0.0.1 only (see tests/helpers/localMongoOnly.ts).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import "./helpers/localMongoOnly";
import type { ClientSession } from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { ApiError } from "../src/lib/api-response";
import { AdminUser, Company, CrmActivity, FollowUpTask, Lead, type ILeadDocument } from "../src/models";
import { checkTransactionSupport, withTransaction } from "../src/lib/transaction";
import {
  applyLeadFormFollowUp,
  assertSchedulableDate,
  cancelFollowUp,
  canOwnFollowUps,
  completeFollowUp,
  createLeadFollowUp,
  describeFollowUp,
  listEligibleOwners,
  rescheduleFollowUp,
  type FollowUpActor,
} from "../src/lib/followUpService";
import { backfillFollowUpTasks } from "../src/lib/followUpBackfill";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const A = 9810;
const B = 9811;
/** The backfill checks use two companies of their own, so their counts are exact. */
const C = 9812;
const D = 9813;
const DAY = 86_400_000;
const inDays = (days: number, extraMs = 0) => new Date(Date.now() + days * DAY + extraMs);

const OWNER = 9801;
const ADMIN = 9802;
const CUSTOM = 9803;
const VIEWER = 9804;
const DEALER = 9805;
const SALES = 9806;
const GONE = 9807;
const BOB = 9808;
const SUE = 9809;
const C_OWNER = 9821;
const C_ADMIN = 9822;
const C_CUSTOM = 9823;
const C_DEALER = 9824;
const D_ADMIN = 9831;

const users = [
  { _id: C_OWNER, companyId: C, email: "owner@c.test", name: "Carl Owner", role: "company_owner", isActive: true },
  { _id: C_ADMIN, companyId: C, email: "admin@c.test", name: "Cleo Admin", role: "admin", isActive: true },
  { _id: C_CUSTOM, companyId: C, email: "custom@c.test", name: "Cyd Custom", role: "configurable_admin", permissions: ["leads:manage"], isActive: true },
  { _id: C_DEALER, companyId: C, email: "dealer@c.test", name: "Cal Dealer", role: "dealer", isActive: true },
  { _id: D_ADMIN, companyId: D, email: "admin@d.test", name: "Dana Admin", role: "admin", isActive: true },
  { _id: OWNER, companyId: A, email: "owner@a.test", name: "Olivia Owner", role: "company_owner", isActive: true },
  { _id: ADMIN, companyId: A, email: "admin@a.test", name: "Adam Admin", role: "admin", isActive: true },
  { _id: CUSTOM, companyId: A, email: "custom@a.test", name: "Cara Custom", role: "configurable_admin", permissions: ["leads:manage"], isActive: true },
  { _id: VIEWER, companyId: A, email: "viewer@a.test", name: "Vik Viewer", role: "configurable_admin", permissions: ["leads:read"], isActive: true },
  { _id: DEALER, companyId: A, email: "dealer@a.test", name: "Dev Dealer", role: "dealer", isActive: true },
  { _id: SALES, companyId: A, email: "sales@a.test", name: "Sam Sales", role: "sales_executive", isActive: true },
  { _id: GONE, companyId: A, email: "gone@a.test", name: "Gita Gone", role: "admin", isActive: false },
  { _id: BOB, companyId: B, email: "admin@b.test", name: "Bob Other", role: "admin", isActive: true },
  { _id: SUE, companyId: null, email: "super@x.test", name: "Sue Super", role: "super_admin", isActive: true },
];
// The throwaway database is shared with other tests, which may keep users with the same emails or companies with the same slugs.
const RUN = randomBytes(3).toString("hex");
for (const user of users) user.email = user.email.replace("@", `.${RUN}@`);
const actor = (userId: number, role: string, permissions: string[] = [], companyId = A): FollowUpActor => ({ userId, role, permissions, companyId });
const admin = actor(ADMIN, "admin");
const custom = actor(CUSTOM, "configurable_admin", ["leads:manage"]);
const superAdmin = actor(SUE, "super_admin"); // a platform admin acting for company A: not a team member, so never a default owner

interface TaskRow {
  _id: string;
  leadId: string;
  ownerId: number;
  dueAt: Date;
  status: "open" | "completed" | "cancelled";
  version: number;
  scheduleChangedAt: Date;
  createdVia: string;
  createdBy: number;
  completedAt: Date | null;
  completedBy: number | null;
  cancelledAt: Date | null;
  cancelledBy: number | null;
  cancelReason: string | null;
}
interface LeadRow {
  nextFollowUpAt: Date | null;
  lastContactedAt?: Date | null;
}
interface ActivityRow {
  title: string;
  description: string | null;
  performedBy: number;
}

const inCompany = <T>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false }, fn);
const tasksOf = async (leadId: string) => (await FollowUpTask.collection.find({ leadId }).sort({ createdAt: 1, _id: 1 }).toArray()) as unknown as TaskRow[];
const openTasksOf = async (leadId: string) => (await tasksOf(leadId)).filter((task) => task.status === "open");
const leadOf = async (leadId: string) => (await Lead.collection.findOne({ _id: leadId as never })) as unknown as LeadRow;
const timelineOf = async (leadId: string) => (await CrmActivity.collection.find({ leadId, type: "follow_up" }).sort({ performedAt: 1, _id: 1 }).toArray()) as unknown as ActivityRow[];
const titlesOf = async (leadId: string) => (await timelineOf(leadId)).map((entry) => entry.title);
const sameTime = (a: Date | null | undefined, b: Date | null | undefined) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

let sequence = 0;
async function seedLead(id: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  await Lead.collection.insertOne({
    _id: id as never,
    companyId: A,
    referenceNumber: `LD-T-${++sequence}`,
    customerName: `Client ${id}`,
    status: "contacted",
    priority: "medium",
    createdBy: ADMIN,
    createdAt: now,
    updatedAt: new Date(now.getTime() - 60_000),
    nextFollowUpAt: null,
    ...extra,
  });
}

type Context = { actor: FollowUpActor; session?: ClientSession; now?: Date };
/** What a route does: load the lead in a transaction, call the service, save the lead with the same session. */
async function change<T>(who: FollowUpActor, leadId: string, work: (ctx: Context, lead: ILeadDocument) => Promise<T>, now?: Date): Promise<T> {
  return inCompany(who.companyId, () =>
    withTransaction(async (session) => {
      const lead = await Lead.findOne({ _id: leadId, companyId: who.companyId }).session(session ?? null);
      if (!lead) throw new Error(`test lead ${leadId} is missing`);
      const result = await work({ actor: who, session, now }, lead);
      await lead.save({ session });
      return result;
    })
  );
}
const rejects = (promise: Promise<unknown>, code: string, label: string, field?: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ApiError && error.code === code && (field === undefined || error.field === field), label);

async function cleanup() {
  await Company.collection.deleteMany({ _id: { $in: [A, B, C, D] } as never });
  await AdminUser.collection.deleteMany({ _id: { $in: users.map((user) => user._id) } as never });
  for (const collection of [Lead.collection, FollowUpTask.collection, CrmActivity.collection]) await collection.deleteMany({ companyId: { $in: [A, B, C, D] } as never });
}

async function main() {
  await connectMongoDB();
  await FollowUpTask.init(); // the one-open-task index must exist before the concurrency checks
  const transactional = await checkTransactionSupport();
  await cleanup();
  const stamp = new Date();
  await Company.collection.insertMany([
    { _id: A as never, name: "Test Company A", slug: `follow-up-test-a-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
    { _id: B as never, name: "Test Company B", slug: `follow-up-test-b-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
    { _id: C as never, name: "Test Company C", slug: `follow-up-test-c-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
    { _id: D as never, name: "Test Company D", slug: `follow-up-test-d-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
  ]);
  await AdminUser.collection.insertMany(users as never);

  try {
    // ── who may own a follow-up ──
    const eligible = new Map<number, boolean>();
    for (const user of users) eligible.set(user._id, await canOwnFollowUps(user, A));
    assert.deepEqual([OWNER, ADMIN, CUSTOM].map((id) => eligible.get(id)), [true, true, true], "a Company Owner, an Admin and a custom role that can manage leads");
    assert.deepEqual([VIEWER, DEALER, SALES, GONE, SUE].map((id) => eligible.get(id)), [false, false, false, false, false], "a read-only role, a Dealer, a Sales Executive, a deactivated person and a platform admin cannot");
    assert.deepEqual(await inCompany(A, () => listEligibleOwners(A)), [
      { id: ADMIN, name: "Adam Admin", role: "admin" },
      { id: CUSTOM, name: "Cara Custom", role: "configurable_admin" },
      { id: OWNER, name: "Olivia Owner", role: "company_owner" },
    ], "the picker lists exactly the eligible people of this company, by name");
    pass("only an active member of the company who can manage leads can own a follow-up (never a Dealer, Sales Executive, read-only role, deactivated person, platform admin or another company's person)");

    // ── a follow-up created with a lead ──
    const due1 = inDays(2);
    await seedLead("L_new", { nextFollowUpAt: due1 });
    await change(admin, "L_new", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
    let [task] = await tasksOf("L_new");
    assert.deepEqual([task.ownerId, task.status, task.version, task.createdVia, task.createdBy], [ADMIN, "open", 1, "crm", ADMIN], "the person creating it owns it by default");
    assert.ok(sameTime(task.dueAt, due1) && Math.abs(new Date(task.scheduleChangedAt).getTime() - Date.now()) < 60_000);

    await seedLead("L_new2", { nextFollowUpAt: due1 });
    await change(admin, "L_new2", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: CUSTOM }));
    assert.equal((await tasksOf("L_new2"))[0].ownerId, CUSTOM, "or the person they choose");

    for (const [who, id] of [["a Dealer", DEALER], ["a Sales Executive", SALES], ["a read-only role", VIEWER], ["a deactivated person", GONE], ["another company's person", BOB], ["a platform admin", SUE], ["nobody", 424242]] as const) {
      await seedLead(`L_bad_${id}`, { nextFollowUpAt: due1 });
      await rejects(change(admin, `L_bad_${id}`, (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: id })), "VALIDATION_ERROR", `${who} cannot own a follow-up`, "followUpOwnerId");
      assert.equal((await tasksOf(`L_bad_${id}`)).length, 0, `${who}: nothing was created`);
    }
    pass("a new follow-up always has an owner: the person creating it, or an eligible person they choose; anyone else is refused and nothing is created");

    // a platform admin acting for the company is not a team member: the lead's creator is the fallback, else a choice is required
    await seedLead("L_su1", { nextFollowUpAt: due1, createdBy: ADMIN });
    await change(superAdmin, "L_su1", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
    assert.equal((await tasksOf("L_su1"))[0].ownerId, ADMIN, "falls back to whoever created the lead");
    await seedLead("L_su2", { nextFollowUpAt: due1, createdBy: DEALER });
    await rejects(change(superAdmin, "L_su2", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 })), "VALIDATION_ERROR", "no eligible default", "followUpOwnerId");
    await change(superAdmin, "L_su2", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: OWNER }));
    assert.equal((await tasksOf("L_su2"))[0].ownerId, OWNER, "and choosing an owner works");
    pass("a platform admin acting for a company never becomes an owner: the lead's creator is used, or an owner must be chosen");

    // ── the lead form: set, move, hand over, clear ──
    await seedLead("L_form");
    const d1 = inDays(1);
    const d2 = inDays(3);
    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: d1 }));
    [task] = await tasksOf("L_form");
    assert.deepEqual([task.ownerId, task.version, task.status], [ADMIN, 1, "open"]);
    assert.ok(sameTime((await leadOf("L_form")).nextFollowUpAt, d1), "the lead's own date follows the task");
    assert.deepEqual(await titlesOf("L_form"), ["Follow-up scheduled"]);

    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: d2 }));
    let rows = await tasksOf("L_form");
    assert.equal(rows.length, 1, "moving a follow-up keeps the same task");
    assert.deepEqual([rows[0]._id, rows[0].version], [task._id, 2]);
    assert.ok(sameTime(rows[0].dueAt, d2) && new Date(rows[0].scheduleChangedAt).getTime() >= new Date(task.scheduleChangedAt).getTime());
    assert.ok(sameTime((await leadOf("L_form")).nextFollowUpAt, d2));
    assert.match((await timelineOf("L_form"))[1].description ?? "", /^Moved from .+ to .+\.$/);

    const before = (await timelineOf("L_form")).length;
    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: d2 }));
    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, {}));
    assert.deepEqual([(await tasksOf("L_form"))[0].version, (await timelineOf("L_form")).length], [2, before], "saving the same date, or nothing, writes nothing");

    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { ownerId: CUSTOM }));
    rows = await tasksOf("L_form");
    assert.deepEqual([rows[0].ownerId, rows[0].version], [CUSTOM, 3], "the owner can be changed on its own");
    const handover = (await timelineOf("L_form")).at(-1);
    assert.deepEqual([handover?.title, handover?.description], ["Follow-up owner changed", "Owner changed from Adam Admin to Cara Custom."]);
    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: d2, ownerId: CUSTOM }));
    assert.equal((await tasksOf("L_form"))[0].version, 3, "choosing the same owner again changes nothing");
    await rejects(change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { ownerId: DEALER })), "VALIDATION_ERROR", "an ineligible owner", "followUpOwnerId");
    assert.deepEqual([(await tasksOf("L_form"))[0].ownerId, (await tasksOf("L_form"))[0].version], [CUSTOM, 3], "a refused hand-over changes nothing");

    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: null }));
    rows = await tasksOf("L_form");
    assert.deepEqual([rows[0].status, rows[0].cancelledBy, rows[0].cancelReason], ["cancelled", ADMIN, "Removed on the lead form."]);
    assert.equal((await leadOf("L_form")).nextFollowUpAt, null);
    assert.equal((await openTasksOf("L_form")).length, 0);
    assert.equal((await titlesOf("L_form")).at(-1), "Follow-up cancelled");
    await rejects(change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { ownerId: ADMIN })), "VALIDATION_ERROR", "an owner without a date", "followUpOwnerId");

    await change(admin, "L_form", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: inDays(5), ownerId: OWNER }));
    rows = await tasksOf("L_form");
    assert.deepEqual([rows.length, rows[0].status, rows[1].status, rows[1].ownerId, rows[1]._id === rows[0]._id], [2, "cancelled", "open", OWNER, false], "after a removal a new follow-up is a new task, and the old one stays as history");
    pass("the lead form: sets, moves (same task, version up), hands over, removes (history kept), and writes nothing when nothing changed");

    // ── Reschedule ──
    await seedLead("L_res", { nextFollowUpAt: due1 });
    await change(admin, "L_res", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: CUSTOM }));
    const original = (await tasksOf("L_res"))[0];
    const moved = inDays(4);
    await change(admin, "L_res", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: moved, note: "Client asked for Friday." }));
    rows = await tasksOf("L_res");
    assert.deepEqual([rows.length, rows[0]._id, rows[0].version, rows[0].ownerId], [1, original._id, 2, CUSTOM], "the same follow-up moves and keeps its owner");
    assert.ok(sameTime(rows[0].dueAt, moved) && sameTime((await leadOf("L_res")).nextFollowUpAt, moved));
    assert.equal((await leadOf("L_res")).lastContactedAt ?? null, null, "rescheduling is not a contact");
    const resEntry = (await timelineOf("L_res"))[0];
    assert.equal(resEntry.title, "Follow-up rescheduled");
    assert.match(resEntry.description ?? "", /^Moved from .+ to .+\. Client asked for Friday\.$/);
    assert.equal(resEntry.performedBy, ADMIN);

    await change(admin, "L_res", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(6), ownerId: OWNER }));
    rows = await tasksOf("L_res");
    assert.deepEqual([rows[0].ownerId, rows[0].version], [OWNER, 3]);
    assert.deepEqual((await titlesOf("L_res")).slice(1).sort(), ["Follow-up owner changed", "Follow-up rescheduled"], "a reschedule that also hands over records both");

    const stable = (await tasksOf("L_res"))[0];
    for (const [label, to] of [["a time that has passed", new Date(Date.now() - 60_000)], ["not a date", new Date("nope")], ["more than two years ahead", inDays(731)]] as const) {
      await rejects(change(admin, "L_res", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to })), "VALIDATION_ERROR", label, "nextFollowUpAt");
    }
    assert.deepEqual([(await tasksOf("L_res"))[0].version, sameTime((await tasksOf("L_res"))[0].dueAt, stable.dueAt)], [3, true], "refused dates change nothing");
    pass("Reschedule keeps the same task, owner and history (version up), records the note, and refuses past, invalid or far-future times");

    // ── Done ──
    await seedLead("L_done", { nextFollowUpAt: due1 });
    await change(admin, "L_done", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: CUSTOM }));
    const next1 = inDays(3);
    await change(admin, "L_done", (ctx, lead) => completeFollowUp(ctx, lead, { next: next1, note: "Spoke to the client." }));
    rows = await tasksOf("L_done");
    assert.deepEqual(rows.map((row) => row.status), ["completed", "open"]);
    assert.deepEqual([rows[0].completedBy, rows[0].version, rows[1].ownerId, rows[1].version, rows[1].createdVia], [ADMIN, 2, CUSTOM, 1, "crm"], "the next follow-up stays with the person who had this one");
    assert.ok(rows[0].completedAt && sameTime(rows[1].dueAt, next1));
    const doneLead = await leadOf("L_done");
    assert.ok(sameTime(doneLead.nextFollowUpAt, next1) && doneLead.lastContactedAt && Date.now() - new Date(doneLead.lastContactedAt).getTime() < 60_000, "the lead's date and last contact follow");
    const doneEntry = (await timelineOf("L_done"))[0];
    assert.equal(doneEntry.title, "Follow-up done");
    assert.match(doneEntry.description ?? "", /^Spoke to the client\. Next follow-up: .+\.$/);

    await change(admin, "L_done", (ctx, lead) => completeFollowUp(ctx, lead, { next: null }));
    rows = await tasksOf("L_done");
    assert.deepEqual(rows.map((row) => row.status), ["completed", "completed"], "done with no next follow-up leaves no open task");
    assert.equal((await leadOf("L_done")).nextFollowUpAt, null);
    assert.equal((await timelineOf("L_done")).at(-1)?.description, "No next follow-up planned.");

    await seedLead("L_done2", { nextFollowUpAt: due1 });
    await change(admin, "L_done2", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1, ownerId: CUSTOM }));
    await FollowUpTask.collection.updateOne({ leadId: "L_done2" }, { $set: { ownerId: GONE } });
    await change(admin, "L_done2", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(2) }));
    assert.equal((await openTasksOf("L_done2"))[0].ownerId, ADMIN, "if the previous owner can no longer own it, the person completing it takes over");
    await change(admin, "L_done2", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(4), ownerId: OWNER }));
    assert.equal((await openTasksOf("L_done2"))[0].ownerId, OWNER, "or hands it to someone");
    await rejects(change(admin, "L_done2", (ctx, lead) => completeFollowUp(ctx, lead, { next: new Date(Date.now() - 1000) })), "VALIDATION_ERROR", "a next time that has passed", "nextFollowUpAt");
    assert.equal((await openTasksOf("L_done2")).length, 1, "and exactly one follow-up is open at any time");
    pass("Done completes the task (who, when), opens the next one with an owner, updates the lead and its timeline, and refuses a next time that has passed");

    // ── Cancel ──
    await seedLead("L_cancel", { nextFollowUpAt: due1 });
    await change(admin, "L_cancel", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
    await change(admin, "L_cancel", (ctx, lead) => cancelFollowUp(ctx, lead, { note: "Customer went with someone else." }));
    rows = await tasksOf("L_cancel");
    assert.deepEqual([rows[0].status, rows[0].cancelReason, rows[0].cancelledBy], ["cancelled", "Customer went with someone else.", ADMIN]);
    assert.equal((await leadOf("L_cancel")).nextFollowUpAt, null);
    assert.match((await timelineOf("L_cancel")).at(-1)?.description ?? "", /was cancelled\. Customer went with someone else\.$/);
    await rejects(change(admin, "L_cancel", (ctx, lead) => cancelFollowUp(ctx, lead, {})), "CONFLICT", "nothing left to cancel");
    pass("Cancel closes the task with a reason, clears the lead's date and records it; cancelling nothing is refused");

    // ── old follow-ups (a date on the lead, no task yet) are adopted when touched ──
    await seedLead("L_old1", { nextFollowUpAt: due1 });
    const rescheduled = inDays(5);
    await change(admin, "L_old1", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: rescheduled }));
    rows = await tasksOf("L_old1");
    assert.equal(rows.length, 1, "one task, not two");
    assert.deepEqual([rows[0].createdVia, rows[0].ownerId, rows[0].version, rows[0].status], ["backfill", ADMIN, 2, "open"]);
    assert.ok(sameTime(rows[0].dueAt, rescheduled));
    assert.match((await timelineOf("L_old1"))[0].description ?? "", /^Moved from .+ to .+\.$/);

    await seedLead("L_old2", { nextFollowUpAt: due1 });
    await change(admin, "L_old2", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(2) }));
    rows = await tasksOf("L_old2");
    assert.deepEqual(rows.map((row) => [row.status, row.createdVia]).sort(), [["completed", "backfill"], ["open", "crm"]], "the old follow-up is recorded as completed, and the next one is opened");

    await seedLead("L_old3", { nextFollowUpAt: due1 });
    await change(admin, "L_old3", (ctx, lead) => cancelFollowUp(ctx, lead, {}));
    assert.deepEqual([(await tasksOf("L_old3")).length, (await leadOf("L_old3")).nextFollowUpAt], [0, null], "cancelling an old follow-up needs no task and no owner");
    await seedLead("L_old4", { nextFollowUpAt: due1, createdBy: DEALER });
    await change(superAdmin, "L_old4", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: null }));
    assert.deepEqual([(await tasksOf("L_old4")).length, (await leadOf("L_old4")).nextFollowUpAt], [0, null], "and neither does removing it on the lead form");

    await seedLead("L_old5", { nextFollowUpAt: due1, createdBy: DEALER });
    await rejects(change(superAdmin, "L_old5", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(2) })), "VALIDATION_ERROR", "no owner can be found", "followUpOwnerId");
    assert.equal((await tasksOf("L_old5")).length, 0, "a refused change leaves the old follow-up exactly as it was");
    await change(superAdmin, "L_old5", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(2), ownerId: CUSTOM }));
    rows = await tasksOf("L_old5");
    assert.deepEqual([rows.length, rows[0].ownerId], [1, CUSTOM], "with an owner chosen it is adopted straight to them");
    assert.ok(!(await titlesOf("L_old5")).includes("Follow-up owner changed"), "choosing the owner while adopting is not a hand-over");
    pass("an old follow-up (a date on the lead, no task) is adopted the first time it is changed, so nothing has to be migrated first; clearing one needs no task");

    // ── the lead's date and the task disagree ──
    await seedLead("L_drift", { nextFollowUpAt: inDays(2) });
    const staleDue = inDays(9);
    await FollowUpTask.collection.insertOne({ _id: "ft_drift", companyId: A, leadId: "L_drift", ownerId: CUSTOM, dueAt: staleDue, status: "open", version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: ADMIN, createdAt: new Date(), updatedAt: new Date() } as never);
    const leadDate = (await leadOf("L_drift")).nextFollowUpAt as Date;
    await change(admin, "L_drift", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(7), expectedNextFollowUpAt: leadDate }));
    rows = await tasksOf("L_drift");
    assert.deepEqual([rows.length, rows[0].version, rows[0].ownerId], [1, 3, CUSTOM], "the lead's date is trusted: the task is corrected, then moved");
    assert.ok(sameTime((await leadOf("L_drift")).nextFollowUpAt, rows[0].dueAt));

    await seedLead("L_drift2");
    await FollowUpTask.collection.insertOne({ _id: "ft_drift2", companyId: A, leadId: "L_drift2", ownerId: CUSTOM, dueAt: staleDue, status: "open", version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: ADMIN, createdAt: new Date(), updatedAt: new Date() } as never);
    await change(admin, "L_drift2", (ctx, lead) => applyLeadFormFollowUp(ctx, lead, { nextFollowUpAt: inDays(3) }));
    rows = await tasksOf("L_drift2");
    assert.deepEqual(rows.map((row) => row.status), ["cancelled", "open"], "a task whose lead has no date is closed, and the new follow-up is a new task");
    assert.match(rows[0].cancelReason ?? "", /cleared/);
    pass("if a write ever bypasses the service, the lead's date wins and the task is corrected or closed the next time the follow-up is touched");

    // ── the stale-view guard ──
    await seedLead("L_guard", { nextFollowUpAt: due1 });
    await change(admin, "L_guard", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
    await rejects(change(admin, "L_guard", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(2), expectedNextFollowUpAt: inDays(8) })), "CONFLICT", "someone changed it since");
    await rejects(change(admin, "L_guard", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(2), expectedNextFollowUpAt: null })), "CONFLICT", "expected no follow-up but there is one");
    await rejects(change(admin, "L_guard", (ctx, lead) => cancelFollowUp(ctx, lead, { expectedNextFollowUpAt: inDays(8) })), "CONFLICT", "cancel of a follow-up that moved");
    assert.deepEqual([(await tasksOf("L_guard")).length, (await tasksOf("L_guard"))[0].version, (await timelineOf("L_guard")).length], [1, 1, 0], "refused requests change nothing");
    await change(admin, "L_guard", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(2), expectedNextFollowUpAt: due1 }));
    assert.equal((await tasksOf("L_guard")).length, 2, "the right date goes through");
    pass("a request made from an out-of-date view is refused (409) and changes nothing");

    // ── all or nothing ──
    if (transactional) {
      await seedLead("L_atomic", { nextFollowUpAt: due1 });
      await change(admin, "L_atomic", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
      const snapshot = JSON.stringify(await tasksOf("L_atomic"));
      await assert.rejects(
        inCompany(A, () =>
          withTransaction(async (session) => {
            const lead = await Lead.findOne({ _id: "L_atomic", companyId: A }).session(session ?? null);
            await completeFollowUp({ actor: admin, session }, lead as ILeadDocument, { next: inDays(2), note: "will be rolled back" });
            await (lead as ILeadDocument).save({ session });
            throw new Error("boom: a failure after the follow-up was written");
          })
        ),
        /boom/
      );
      assert.equal(JSON.stringify(await tasksOf("L_atomic")), snapshot, "the task is untouched, and no next task exists");
      assert.ok(sameTime((await leadOf("L_atomic")).nextFollowUpAt, due1), "the lead's date is untouched");
      assert.equal((await timelineOf("L_atomic")).length, 0, "and no timeline entry was left behind");
      pass("the task, the lead and the timeline are written together: a failure part-way undoes all of it");
    } else {
      console.log("  - SKIPPED: all-or-nothing writes (this MongoDB has no transactions; the project's own database does)");
    }

    // ── two requests at once ──
    if (transactional) {
      await seedLead("L_race", { nextFollowUpAt: due1 });
      await change(admin, "L_race", (ctx, lead) => createLeadFollowUp(ctx, lead, { dueAt: due1 }));
      const results = await Promise.allSettled([
        change(admin, "L_race", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(3), expectedNextFollowUpAt: due1 })),
        change(custom, "L_race", (ctx, lead) => completeFollowUp(ctx, lead, { next: inDays(4), expectedNextFollowUpAt: due1 })),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "exactly one of two people finishing the same follow-up succeeds");
      const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      assert.ok(failed.reason instanceof ApiError && failed.reason.code === "CONFLICT", "the other is told it changed (409)");
      rows = await tasksOf("L_race");
      assert.deepEqual(rows.map((row) => row.status), ["completed", "open"], "one completed task and one open one, not two completions");
      assert.ok(sameTime((await leadOf("L_race")).nextFollowUpAt, rows[1].dueAt), "and the lead agrees with the open task");

      await seedLead("L_race2", { nextFollowUpAt: due1 });
      const both = await Promise.allSettled([
        change(admin, "L_race2", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(3) })),
        change(custom, "L_race2", (ctx, lead) => rescheduleFollowUp(ctx, lead, { to: inDays(4) })),
      ]);
      for (const result of both) {
        if (result.status === "rejected") assert.ok(result.reason instanceof ApiError && result.reason.code === "CONFLICT", "a request that loses the race is told so, never a server error");
      }
      assert.ok(both.some((result) => result.status === "fulfilled"), "at least one succeeds");
      rows = await tasksOf("L_race2");
      assert.equal(rows.length, 1, "an old follow-up adopted by two requests at once becomes ONE task, never two");
      assert.ok(sameTime((await leadOf("L_race2")).nextFollowUpAt, rows[0].dueAt), "and the lead agrees with it");
      pass("two people acting on the same follow-up at once: one wins, the other is told (409), and an old follow-up is never adopted twice");
    }

    // ── one open task per lead ──
    const dup = { companyId: A, leadId: "L_race2", ownerId: ADMIN, dueAt: due1, version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: ADMIN, createdAt: new Date(), updatedAt: new Date() };
    await assert.rejects(FollowUpTask.collection.insertOne({ _id: "ft_dup_open", status: "open", ...dup } as never), (error: unknown) => (error as { code?: number }).code === 11000, "a second open task for a lead is refused by the database itself");
    await FollowUpTask.collection.insertOne({ _id: "ft_dup_done", status: "completed", ...dup } as never);
    await FollowUpTask.collection.insertOne({ _id: "ft_dup_cancelled", status: "cancelled", ...dup } as never);
    assert.equal((await openTasksOf("L_race2")).length, 1, "history can pile up; only one is open");
    pass("the database refuses a second open follow-up for the same lead, while finished ones accumulate as history");

    // ── what the screens ask ──
    const resLead = await leadOf("L_res");
    const info = await inCompany(A, () => describeFollowUp(A, { _id: "L_res", nextFollowUpAt: resLead.nextFollowUpAt }));
    assert.deepEqual([info.task?.ownerId, info.task?.ownerName, info.task?.version, info.legacy], [OWNER, "Olivia Owner", 3, false]);
    assert.equal(info.nextFollowUpAt, new Date(resLead.nextFollowUpAt as Date).toISOString());
    await seedLead("L_info_old", { nextFollowUpAt: due1 });
    const oldInfo = await inCompany(A, () => describeFollowUp(A, { _id: "L_info_old", nextFollowUpAt: due1 }));
    assert.deepEqual([oldInfo.task, oldInfo.legacy], [null, true], "an old follow-up is reported as such");
    pass("describeFollowUp tells a screen who owns a follow-up, its version, and whether it is an old one without a task");

    // ── scheduling rules ──
    const clock = new Date("2026-11-05T10:00:00Z");
    assert.doesNotThrow(() => assertSchedulableDate(clock, clock), "exactly now is allowed");
    assert.doesNotThrow(() => assertSchedulableDate(new Date(clock.getTime() + 730 * DAY), clock), "two years (730 days) is allowed");
    for (const bad of [new Date(clock.getTime() - 1), new Date(clock.getTime() + 730 * DAY + 1), new Date("nope")]) assert.throws(() => assertSchedulableDate(bad, clock), (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR");
    pass("a follow-up may be set from this moment up to 730 days ahead, not before and not beyond");

    // ── the backfill ──
    // Company C has leads of every kind; company D has no Company Owner. Both are separate from everything above.
    const old = inDays(-3);
    const inC = { companyId: C };
    await seedLead("BF1", { ...inC, nextFollowUpAt: inDays(1), createdBy: C_ADMIN });
    await seedLead("BF2", { ...inC, nextFollowUpAt: inDays(2), createdBy: C_DEALER });
    await seedLead("BF3", { ...inC, nextFollowUpAt: inDays(3), createdBy: C_ADMIN });
    await FollowUpTask.collection.insertOne({ _id: "ft_bf3", companyId: C, leadId: "BF3", ownerId: C_CUSTOM, dueAt: old, status: "open", version: 4, scheduleChangedAt: old, createdVia: "crm", createdBy: C_ADMIN, createdAt: old, updatedAt: old } as never);
    const bf4Due = inDays(4);
    await seedLead("BF4", { ...inC, nextFollowUpAt: bf4Due, createdBy: C_ADMIN });
    await FollowUpTask.collection.insertOne({ _id: "ft_bf4", companyId: C, leadId: "BF4", ownerId: C_ADMIN, dueAt: bf4Due, status: "open", version: 1, scheduleChangedAt: old, createdVia: "crm", createdBy: C_ADMIN, createdAt: old, updatedAt: old } as never);
    await seedLead("BF5", { ...inC, nextFollowUpAt: inDays(5), isDeleted: true });
    await seedLead("BF6", { ...inC, nextFollowUpAt: null });
    await seedLead("BF7", { ...inC, nextFollowUpAt: null });
    await FollowUpTask.collection.insertOne({ _id: "ft_bf7", companyId: C, leadId: "BF7", ownerId: C_ADMIN, dueAt: inDays(6), status: "open", version: 1, scheduleChangedAt: old, createdVia: "crm", createdBy: C_ADMIN, createdAt: old, updatedAt: old } as never);
    await seedLead("BB1", { companyId: D, referenceNumber: "LD-D-1", nextFollowUpAt: inDays(2), createdBy: D_ADMIN });
    await seedLead("BB2", { companyId: D, referenceNumber: "LD-D-2", nextFollowUpAt: inDays(2), createdBy: C_DEALER }); // a creator who is nobody in this company

    const tasksBefore = await FollowUpTask.collection.countDocuments({ companyId: { $in: [C, D] } as never });
    const dry = await backfillFollowUpTasks({ companyIds: [C, D], apply: false });
    assert.equal(dry.applied, false);
    assert.deepEqual(dry.companies.map((company) => company.companyId), [C, D], "only the companies asked for");
    assert.equal(await FollowUpTask.collection.countDocuments({ companyId: { $in: [C, D] } as never }), tasksBefore, "a dry run writes nothing");
    const reportC = dry.companies.find((company) => company.companyId === C)!;
    const reportD = dry.companies.find((company) => company.companyId === D)!;
    assert.deepEqual([reportC.leadsWithDate, reportC.alreadyHaveTask, reportC.created, reportC.dateCorrected, reportC.staleTasks, reportC.needsOwner], [4, 1, 2, 1, 1, []], "company C: BF1 and BF2 get tasks, BF3's date is corrected, BF4 is fine, BF7's task has no date (reported only), archived and dateless leads are not counted");
    assert.deepEqual([reportD.created, reportD.needsOwner], [1, ["LD-D-2"]], "company D: its admin owns BB1; BB2 has no usable owner and is listed, not guessed");

    const applied = await backfillFollowUpTasks({ companyIds: [C, D], apply: true });
    assert.equal(applied.applied, true);
    const bf1 = (await tasksOf("BF1"))[0];
    assert.match(bf1._id, /^ft_bf_/);
    assert.deepEqual([bf1.ownerId, bf1.createdVia, bf1.status, bf1.version], [C_ADMIN, "backfill", "open", 1], "owned by the person who created the lead");
    assert.equal((await tasksOf("BF2"))[0].ownerId, C_OWNER, "a creator who cannot own follow-ups falls back to the company's Company Owner");
    const bf3 = (await tasksOf("BF3"))[0];
    assert.deepEqual([bf3.version, bf3.ownerId, sameTime(bf3.dueAt, (await leadOf("BF3")).nextFollowUpAt)], [5, C_CUSTOM, true], "a task whose date differs takes the lead's date and keeps its owner");
    assert.deepEqual([(await tasksOf("BF4")).length, (await tasksOf("BF4"))[0].version], [1, 1], "a follow-up that already has a matching task is untouched");
    assert.equal((await tasksOf("BF5")).length + (await tasksOf("BF6")).length, 0, "archived leads and leads without a date get nothing");
    assert.equal((await tasksOf("BB1"))[0].ownerId, D_ADMIN);
    assert.equal((await tasksOf("BB2")).length, 0, "no owner, no task");

    const again = await backfillFollowUpTasks({ companyIds: [C, D], apply: true });
    assert.deepEqual([again.totals.created, again.totals.dateCorrected], [0, 0], "a second run adds and changes nothing");
    for (const id of ["BF1", "BF2", "BF3", "BF4", "BB1"]) assert.equal((await openTasksOf(id)).length, 1, `${id}: still exactly one open task`);
    const reportText = JSON.stringify(applied);
    assert.ok(!/Client |9876|@/.test(reportText), "the report holds reference numbers only: no names, phones or emails");
    pass("the backfill: a dry run writes nothing; owners come from the lead's creator, else the Company Owner, else the lead is listed; dates are corrected; archived and dateless leads are skipped; a second run does nothing; the report names no customer");

    console.log(`\nALL ${count} FOLLOW-UP SERVICE TESTS PASSED!${transactional ? "" : " (transaction checks skipped)"}`);
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
