/**
 * Follow-ups whose owner can no longer own them (src/lib/followUpReassignment.ts), against a real, throwaway local MongoDB:
 * they are found (deactivated, lost the permission, changed role, not in the company), nothing is ever reassigned by
 * itself, the explicit reassignment keeps the previous owner and a history, and it refuses or skips everything it should.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/follow-up-reassignment.test.ts
 *
 * Never reads .env / .env.local; uses 127.0.0.1 only (see tests/helpers/localMongoOnly.ts).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { ApiError } from "../src/lib/api-response";
import { AdminUser, Company, CrmActivity, FollowUpTask, Lead } from "../src/models";
import { withRequiredTransaction } from "../src/lib/transaction";
import { rescheduleFollowUp, type FollowUpActor } from "../src/lib/followUpService";
import { MAX_REASSIGN_BATCH, canReassignFollowUps, findOrphanedFollowUps, reassignFollowUps } from "../src/lib/followUpReassignment";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const A = 9820;
const B = 9821;
const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);

const OWNER = 9901;
const ADMIN = 9902;
const CUSTOM = 9903;
const MANAGER = 9904;
const GONE = 9905;
const LOST_PERMISSION = 9906;
const DEALER_NOW = 9907;
const BOB = 9908;
const SALES = 9909;
const RUN = randomBytes(3).toString("hex");

const users = [
  { _id: OWNER, companyId: A, name: "Olivia Owner", role: "company_owner", isActive: true },
  { _id: ADMIN, companyId: A, name: "Adam Admin", role: "admin", isActive: true },
  { _id: CUSTOM, companyId: A, name: "Cara Custom", role: "configurable_admin", permissions: ["leads:manage"], isActive: true },
  { _id: MANAGER, companyId: A, name: "Maya Manager", role: "configurable_admin", permissions: ["leads:manage", "users:manage"], isActive: true },
  { _id: GONE, companyId: A, name: "Gita Gone", role: "admin", isActive: false },
  { _id: LOST_PERMISSION, companyId: A, name: "Lena Lostpermission", role: "configurable_admin", permissions: ["leads:read"], isActive: true },
  { _id: DEALER_NOW, companyId: A, name: "Dev Nowdealer", role: "dealer", isActive: true },
  { _id: BOB, companyId: B, name: "Bob Other", role: "admin", isActive: true },
  { _id: SALES, companyId: A, name: "Sam Sales", role: "sales_executive", isActive: true },
].map((user) => ({ ...user, email: `${user.name.split(" ")[0].toLowerCase()}.${RUN}@r.test` }));

const actor = (userId: number, role: string, permissions: string[] = []): FollowUpActor => ({ userId, role, permissions, companyId: A });
const owner = actor(OWNER, "company_owner");
const manager = actor(MANAGER, "configurable_admin", ["leads:manage", "users:manage"]);

interface TaskRow {
  _id: string;
  leadId: string;
  ownerId: number;
  originalOwnerId: number | null;
  ownerHistory: Array<{ fromOwnerId: number; toOwnerId: number; changedBy: number; reason: string; batchId: string | null; note: string | null; changedAt: Date }>;
  dueAt: Date;
  status: string;
  version: number;
}

const inCompany = <T>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false }, fn);
const taskOf = async (id: string) => (await FollowUpTask.collection.findOne({ _id: id as never })) as unknown as TaskRow;
const snapshotTasks = async () => JSON.stringify(await FollowUpTask.collection.find({ companyId: A }).sort({ _id: 1 }).toArray());

let sequence = 0;
async function seed(id: string, ownerId: number, opts: { lead?: Record<string, unknown>; task?: Record<string, unknown>; dueInDays?: number } = {}) {
  const now = new Date();
  const due = inDays(opts.dueInDays ?? 3);
  await Lead.collection.insertOne({
    _id: `L_${id}` as never,
    companyId: A,
    referenceNumber: `LD-R-${++sequence}`,
    customerName: `Client ${id}`,
    status: "contacted",
    priority: "medium",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
    nextFollowUpAt: due,
    ...opts.lead,
  });
  await FollowUpTask.collection.insertOne({
    _id: `T_${id}` as never,
    companyId: A,
    leadId: `L_${id}`,
    ownerId,
    originalOwnerId: ownerId,
    ownerHistory: [],
    dueAt: due,
    status: "open",
    version: 1,
    scheduleChangedAt: now,
    createdVia: "crm",
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
    ...opts.task,
  });
}

const reassign = (who: FollowUpActor, input: Parameters<typeof reassignFollowUps>[1]) =>
  inCompany(A, () => withRequiredTransaction((session) => reassignFollowUps({ actor: who, session }, input)));
const rejects = (promise: Promise<unknown>, code: string, label: string, field?: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ApiError && error.code === code && (field === undefined || error.field === field), label);

async function cleanup() {
  await Company.collection.deleteMany({ _id: { $in: [A, B] } as never });
  await AdminUser.collection.deleteMany({ _id: { $in: users.map((user) => user._id) } as never });
  for (const collection of [Lead.collection, FollowUpTask.collection, CrmActivity.collection]) await collection.deleteMany({ companyId: { $in: [A, B] } as never });
}

async function main() {
  await connectMongoDB();
  await FollowUpTask.init();
  await cleanup();
  const stamp = new Date();
  await Company.collection.insertMany([
    { _id: A as never, name: "Reassign A", slug: `reassign-a-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
    { _id: B as never, name: "Reassign B", slug: `reassign-b-${RUN}`, status: "active", createdAt: stamp, updatedAt: stamp },
  ]);
  await AdminUser.collection.insertMany(users as never);

  try {
    // ── who may review and reassign ──
    assert.deepEqual(
      [
        canReassignFollowUps("company_owner", []),
        canReassignFollowUps("admin", []),
        canReassignFollowUps("super_admin", []),
        canReassignFollowUps("configurable_admin", ["leads:manage", "users:manage"]),
        canReassignFollowUps("configurable_admin", ["leads:manage"]),
        canReassignFollowUps("configurable_admin", ["users:manage"]),
        canReassignFollowUps("dealer", []),
        canReassignFollowUps("sales_executive", ["leads:manage", "users:manage"]),
      ],
      [true, true, true, true, false, false, false, false]
    );
    pass("only people who can manage both users and leads may review and reassign (Company Owner, Admin, a role holding both); never a Dealer or Sales Executive");

    // ── finding them ──
    await seed("a1", GONE, { dueInDays: 2 });
    await seed("a2", GONE, { dueInDays: 1 });
    await seed("a3_won", GONE, { lead: { status: "won" } });
    await seed("a4_archived", GONE, { lead: { isDeleted: true } });
    await seed("a5_done", GONE, { task: { status: "completed" } });
    await seed("b1", LOST_PERMISSION);
    await seed("c1", DEALER_NOW);
    await seed("d1", BOB); // owned by someone who is not even in this company
    await seed("e1", ADMIN); // fine
    await seed("e2", CUSTOM); // fine
    const before = await snapshotTasks();

    const report = await inCompany(A, () => findOrphanedFollowUps(A));
    assert.deepEqual(report.groups.map((group) => [group.ownerId, group.problem, group.tasks]), [[GONE, "deactivated", 2], [LOST_PERMISSION, "not_allowed", 1], [DEALER_NOW, "not_allowed", 1], [BOB, "missing", 1]]);
    assert.deepEqual(report.totals, { tasks: 5, owners: 4 }, "won, archived and finished follow-ups are not counted, and neither are follow-ups of people who can still own them");
    assert.deepEqual(report.tasks.map((task) => task.leadId), ["L_a2", "L_a1", "L_b1", "L_c1", "L_d1"].sort((x, y) => report.tasks.findIndex((t) => t.leadId === x) - report.tasks.findIndex((t) => t.leadId === y)), "listed earliest first");
    assert.equal(report.tasks[0].leadId, "L_a2", "earliest due first");
    assert.deepEqual([report.tasks[0].ownerName, report.tasks[0].problem, report.tasks[0].referenceNumber.startsWith("LD-R-")], ["Gita Gone", "deactivated", true]);
    const summary = await inCompany(A, () => findOrphanedFollowUps(A, { listTasks: false }));
    assert.deepEqual([summary.totals, summary.tasks.length], [{ tasks: 5, owners: 4 }, 0], "the summary for the notice counts without listing");
    assert.equal(await snapshotTasks(), before, "looking changes nothing: nothing is ever reassigned by itself");
    await AdminUser.collection.updateOne({ _id: GONE as never }, { $set: { isActive: true } });
    assert.deepEqual((await inCompany(A, () => findOrphanedFollowUps(A))).groups.map((group) => group.ownerId), [LOST_PERMISSION, DEALER_NOW, BOB], "the flag is worked out each time: reactivating the person removes it");
    await AdminUser.collection.updateOne({ _id: GONE as never }, { $set: { isActive: false } });
    pass("follow-ups of a deactivated person, one who lost the permission or changed role, or who is not in the company are found; closed, archived and finished ones are not; looking changes nothing");

    // ── reassigning ──
    const result = await reassign(owner, { tasks: [{ id: "T_a1", version: 1 }, { id: "T_a2" }], toOwnerId: ADMIN, note: "Taking over from Gita, who left." });
    assert.deepEqual(result.reassigned.map((entry) => entry.taskId).sort(), ["T_a1", "T_a2"]);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.toOwnerName, "Adam Admin");
    const moved = await taskOf("T_a1");
    assert.deepEqual([moved.ownerId, moved.originalOwnerId, moved.version], [ADMIN, GONE, 2], "the new owner; the original owner kept; the version up");
    assert.equal(moved.ownerHistory.length, 1);
    assert.deepEqual(
      [moved.ownerHistory[0].fromOwnerId, moved.ownerHistory[0].toOwnerId, moved.ownerHistory[0].changedBy, moved.ownerHistory[0].reason, moved.ownerHistory[0].batchId === result.batchId, moved.ownerHistory[0].note],
      [GONE, ADMIN, OWNER, "owner_unavailable", true, "Taking over from Gita, who left."]
    );
    assert.equal(moved.status, "open");
    const lead = (await Lead.collection.findOne({ _id: "L_a1" as never })) as unknown as { nextFollowUpAt: Date };
    assert.equal(new Date(lead.nextFollowUpAt).getTime(), new Date(moved.dueAt).getTime(), "the date and the lead are untouched");
    const timeline = (await CrmActivity.collection.find({ leadId: "L_a1", type: "follow_up" }).toArray()) as unknown as Array<{ title: string; description: string; performedBy: number; metadata: Record<string, unknown> }>;
    assert.equal(timeline.length, 1);
    assert.deepEqual([timeline[0].title, timeline[0].performedBy], ["Follow-up owner changed", OWNER]);
    assert.match(timeline[0].description, /^Owner changed from Gita Gone \(no longer active\) to Adam Admin\. Taking over from Gita, who left\.$/);
    assert.deepEqual([timeline[0].metadata.batchId, timeline[0].metadata.fromOwnerId, timeline[0].metadata.toOwnerId, timeline[0].metadata.reason], [result.batchId, GONE, ADMIN, "owner_unavailable"]);
    assert.deepEqual((await inCompany(A, () => findOrphanedFollowUps(A))).groups.map((group) => group.ownerId), [LOST_PERMISSION, DEALER_NOW, BOB], "and they are no longer flagged");
    pass("reassigning gives the follow-ups to the new owner and keeps the original owner and a history entry (who, when, from whom, why, which batch) plus a timeline entry; the date and the lead are untouched");

    // ── a second hand-over keeps the whole history ──
    await AdminUser.collection.updateOne({ _id: ADMIN as never }, { $set: { isActive: false } });
    const again = await reassign(manager, { tasks: [{ id: "T_a1" }], toOwnerId: OWNER });
    assert.equal(again.reassigned.length, 1);
    const twice = await taskOf("T_a1");
    assert.deepEqual([twice.ownerId, twice.originalOwnerId, twice.version, twice.ownerHistory.map((entry) => [entry.fromOwnerId, entry.toOwnerId])], [OWNER, GONE, 3, [[GONE, ADMIN], [ADMIN, OWNER]]], "the original owner is still the first owner, and both hand-overs are listed");
    await AdminUser.collection.updateOne({ _id: ADMIN as never }, { $set: { isActive: true } });
    pass("a follow-up handed over twice keeps its original owner and both hand-overs, in order");

    // ── what it refuses and what it skips ──
    const refusedBefore = await snapshotTasks();
    for (const [label, toOwnerId] of [["a deactivated person", GONE], ["a read-only role", LOST_PERMISSION], ["a Dealer", DEALER_NOW], ["a Sales Executive", SALES], ["another company's person", BOB], ["nobody", 424242]] as const) {
      await rejects(reassign(owner, { tasks: [{ id: "T_b1" }], toOwnerId }), "VALIDATION_ERROR", `${label} cannot be the new owner`, "followUpOwnerId");
    }
    await rejects(reassign(owner, { tasks: [], toOwnerId: ADMIN }), "VALIDATION_ERROR", "nothing chosen", "tasks");
    await rejects(reassign(owner, { tasks: Array.from({ length: MAX_REASSIGN_BATCH + 1 }, (_, i) => ({ id: `T_${i}` })), toOwnerId: ADMIN }), "VALIDATION_ERROR", "too many at once", "tasks");
    assert.equal(await snapshotTasks(), refusedBefore, "refused requests change nothing");

    await seed("f_stale", GONE);
    await seed("g_closed", GONE);
    await Lead.collection.updateOne({ _id: "L_g_closed" as never }, { $set: { status: "lost" } });
    await seed("h_active", ADMIN);
    const mixed = await reassign(owner, {
      tasks: [{ id: "T_b1", version: 1 }, { id: "T_f_stale", version: 99 }, { id: "T_g_closed" }, { id: "T_h_active" }, { id: "T_a5_done" }, { id: "T_nope" }, { id: "T_a2" }],
      toOwnerId: CUSTOM,
    });
    assert.deepEqual(mixed.reassigned.map((entry) => entry.taskId), ["T_b1"], "the one that qualified went through");
    assert.deepEqual(Object.fromEntries(mixed.skipped.map((entry) => [entry.taskId, entry.reason])), {
      T_f_stale: "changed",
      T_g_closed: "lead_closed",
      T_h_active: "owner_still_allowed",
      T_a5_done: "not_open",
      T_nope: "not_found",
      T_a2: "owner_still_allowed",
    }, "each skip says why: it moved on, its lead is closed, its owner can still own it (it cannot be used to take work from an active person), it is finished, it does not exist");
    assert.equal((await taskOf("T_h_active")).ownerId, ADMIN, "an active person's follow-up was not touched");
    assert.equal((await taskOf("T_f_stale")).ownerId, GONE);

    // company isolation: another company's task id is simply not found
    await FollowUpTask.collection.insertOne({ _id: "T_other_company" as never, companyId: B, leadId: "L_x", ownerId: BOB, originalOwnerId: BOB, ownerHistory: [], dueAt: inDays(1), status: "open", version: 1, scheduleChangedAt: new Date(), createdVia: "crm", createdBy: BOB, createdAt: new Date(), updatedAt: new Date() } as never);
    const foreign = await reassign(owner, { tasks: [{ id: "T_other_company" }], toOwnerId: CUSTOM });
    assert.deepEqual([foreign.reassigned.length, foreign.skipped[0]?.reason], [0, "not_found"]);
    assert.equal(((await FollowUpTask.collection.findOne({ _id: "T_other_company" as never })) as unknown as TaskRow).ownerId, BOB, "another company's follow-up is untouched");

    const repeat = await reassign(owner, { tasks: [{ id: "T_b1" }], toOwnerId: CUSTOM });
    assert.deepEqual([repeat.reassigned.length, repeat.skipped[0]?.reason], [0, "owner_still_allowed"], "doing it again changes nothing");
    pass("it refuses an unfit new owner, an empty or oversized batch; skips (and says why) what changed, is closed, finished, missing, in another company or whose owner can still own it; and is safe to repeat");

    // ── all or nothing ──
    await seed("i1", GONE);
    await seed("i2", GONE);
    const atomicBefore = await snapshotTasks();
    const timelineBefore = await CrmActivity.collection.countDocuments({ companyId: A });
    await assert.rejects(
      inCompany(A, () =>
        withRequiredTransaction(async (session) => {
          await reassignFollowUps({ actor: owner, session }, { tasks: [{ id: "T_i1" }, { id: "T_i2" }], toOwnerId: CUSTOM });
          throw new Error("boom: a failure after the reassignment was written");
        })
      ),
      /boom/
    );
    assert.equal(await snapshotTasks(), atomicBefore, "no owner changed, no history written");
    assert.equal(await CrmActivity.collection.countDocuments({ companyId: A }), timelineBefore, "and no timeline entry was left behind");
    pass("the owner changes, their history and the timeline entries are saved together: a failure part-way undoes all of it");

    // ── an ordinary hand-over also keeps the history ──
    await seed("j1", ADMIN, { dueInDays: 5 });
    await inCompany(A, () =>
      withRequiredTransaction(async (session) => {
        const leadDoc = await Lead.findOne({ _id: "L_j1", companyId: A }).session(session ?? null);
        await rescheduleFollowUp({ actor: owner, session }, leadDoc!, { to: inDays(6), ownerId: CUSTOM });
        await leadDoc!.save({ session });
      })
    );
    const handed = await taskOf("T_j1");
    assert.deepEqual([handed.ownerId, handed.originalOwnerId, handed.ownerHistory.map((entry) => [entry.fromOwnerId, entry.toOwnerId, entry.reason, entry.batchId])], [CUSTOM, ADMIN, [[ADMIN, CUSTOM, "manual", null]]]);
    pass("a hand-over made from the lead form or the Reschedule dialog is recorded in the same history (reason: manual), with the original owner kept");

    console.log(`\nALL ${count} REASSIGNMENT TESTS PASSED!`);
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
