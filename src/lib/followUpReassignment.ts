import { randomBytes } from "node:crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, FollowUpTask, Lead, type IFollowUpTask } from "@/models";
import { ApiError } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { recordCrmActivity } from "@/lib/crmService";
import { canOwnFollowUps, displayName, findOwner, ownerChangeParts, requireEligibleOwner, updateOpenTaskIfCurrent, type FollowUpContext } from "@/lib/followUpService";

/**
 * Follow-ups whose owner can no longer own them (deactivated, or no longer allowed to manage leads), and the explicit
 * action that gives them to someone else.
 *
 * Nothing here ever reassigns by itself: a follow-up of a person who has left stays with them, flagged, until somebody who
 * may manage users and leads chooses the new owner. The flag is never stored; it is worked out from the owner's account
 * each time, so it cannot go stale (reactivate the person and the flag disappears).
 *
 * The previous owner is never lost: every task keeps its original owner and a history of each hand-over (who, when, from
 * whom, why), and the lead's timeline gets an entry too.
 */

export type OwnerProblem = "deactivated" | "not_allowed" | "missing";

export const OWNER_PROBLEM_TEXT: Record<OwnerProblem, string> = {
  deactivated: "no longer active",
  not_allowed: "no longer allowed to manage leads",
  missing: "no longer in this company",
};

/** At most this many follow-ups are listed on the review screen, and reassigned in one request. */
export const MAX_LISTED = 2000;
export const MAX_REASSIGN_BATCH = 200;

/** Who may review and reassign: people who can manage users (they are the ones who deactivate people) and manage leads. */
export function canReassignFollowUps(role: string, permissions: string[]): boolean {
  if (role === "dealer" || role === "sales_executive" || role === "sales") return false;
  return hasPermission(role, permissions, "users:manage") && hasPermission(role, permissions, "leads:manage");
}

interface OwnerRow {
  _id: number;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
  isActive?: boolean;
  permissions?: string[] | null;
}

async function problemOf(owner: OwnerRow | null | undefined, companyId: number): Promise<OwnerProblem | null> {
  if (!owner) return "missing";
  if (owner.isActive === false) return "deactivated";
  return (await canOwnFollowUps(owner, companyId)) ? null : "not_allowed";
}

export interface OrphanedTask {
  taskId: string;
  version: number;
  leadId: string;
  referenceNumber: string;
  customerName: string;
  priority: string;
  dueAt: string;
  ownerId: number;
  ownerName: string | null;
  problem: OwnerProblem;
}

export interface OrphanedGroup {
  ownerId: number;
  ownerName: string | null;
  problem: OwnerProblem;
  tasks: number;
}

export interface OrphanedReport {
  groups: OrphanedGroup[];
  tasks: OrphanedTask[];
  /** True when more than `MAX_LISTED` follow-ups exist and only the earliest are listed. */
  truncated: boolean;
  totals: { tasks: number; owners: number };
}

const emptyReport = (): OrphanedReport => ({ groups: [], tasks: [], truncated: false, totals: { tasks: 0, owners: 0 } });

/** The open follow-ups (of open leads) whose owner can no longer own them. Must run in the company's tenant context. */
export async function findOrphanedFollowUps(companyId: number, options: { listTasks?: boolean } = {}): Promise<OrphanedReport> {
  await connectMongoDB();
  const grouped = await FollowUpTask.aggregate<{ _id: number; n: number }>([{ $match: { companyId, status: "open" } }, { $group: { _id: "$ownerId", n: { $sum: 1 } } }]);
  if (grouped.length === 0) return emptyReport();

  const owners = await AdminUser.find({ companyId, _id: { $in: grouped.map((entry) => entry._id) } })
    .select("name firstName lastName email role isActive permissions")
    .lean<OwnerRow[]>();
  const byId = new Map(owners.map((owner) => [owner._id, owner]));
  const problems = new Map<number, OwnerProblem>();
  for (const entry of grouped) {
    const problem = await problemOf(byId.get(entry._id), companyId);
    if (problem) problems.set(entry._id, problem);
  }
  if (problems.size === 0) return emptyReport();

  const open = await FollowUpTask.find({ companyId, status: "open", ownerId: { $in: [...problems.keys()] } })
    .sort({ dueAt: 1, _id: 1 })
    .limit(MAX_LISTED + 1)
    .select("leadId ownerId version dueAt")
    .lean<Array<Pick<IFollowUpTask, "_id" | "leadId" | "ownerId" | "version" | "dueAt">>>();
  const truncated = open.length > MAX_LISTED;
  const tasks = truncated ? open.slice(0, MAX_LISTED) : open;

  // A follow-up of a lead that is won, lost or archived needs nobody: it is not shown or counted.
  const leads = await Lead.find({ companyId, _id: { $in: tasks.map((task) => task.leadId) }, status: { $nin: ["won", "lost"] } })
    .select("referenceNumber customerName priority")
    .lean<Array<{ _id: string; referenceNumber: string; customerName: string; priority: string }>>();
  const leadById = new Map(leads.map((lead) => [lead._id, lead]));

  const rows: OrphanedTask[] = [];
  for (const task of tasks) {
    const lead = leadById.get(task.leadId);
    if (!lead) continue;
    const owner = byId.get(task.ownerId);
    rows.push({
      taskId: String(task._id),
      version: task.version,
      leadId: task.leadId,
      referenceNumber: lead.referenceNumber,
      customerName: lead.customerName,
      priority: lead.priority,
      dueAt: new Date(task.dueAt).toISOString(),
      ownerId: task.ownerId,
      ownerName: owner ? displayName(owner) : null,
      problem: problems.get(task.ownerId) as OwnerProblem,
    });
  }

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.ownerId, (counts.get(row.ownerId) ?? 0) + 1);
  const groups: OrphanedGroup[] = [...counts.entries()]
    .map(([ownerId, count]) => ({ ownerId, ownerName: byId.get(ownerId) ? displayName(byId.get(ownerId) as OwnerRow) : null, problem: problems.get(ownerId) as OwnerProblem, tasks: count }))
    .sort((a, b) => b.tasks - a.tasks || a.ownerId - b.ownerId);

  return { groups, tasks: options.listTasks === false ? [] : rows, truncated, totals: { tasks: rows.length, owners: groups.length } };
}

export interface ReassignInput {
  tasks: Array<{ id: string; version?: number }>;
  toOwnerId: number;
  note?: string | null;
}

export type SkipReason = "not_found" | "not_open" | "owner_still_allowed" | "changed" | "lead_closed";

export interface ReassignResult {
  batchId: string;
  toOwnerId: number;
  toOwnerName: string;
  reassigned: Array<{ taskId: string; leadId: string; fromOwnerId: number }>;
  skipped: Array<{ taskId: string; reason: SkipReason }>;
}

/**
 * Gives follow-ups whose owner can no longer own them to a new owner. Run it inside `withRequiredTransaction`: the owner
 * change, its history entry and the lead's timeline entry are written together or not at all.
 *
 * It only moves a follow-up whose CURRENT owner really is unavailable (checked here, not trusted from the screen), so it
 * cannot be used to take follow-ups away from people who are still active. A follow-up that changed since the person
 * looked (its version differs), or that is no longer open, is skipped and reported; the rest still go through.
 */
export async function reassignFollowUps(ctx: FollowUpContext, input: ReassignInput): Promise<ReassignResult> {
  const requested = [...new Map(input.tasks.map((task) => [task.id, task])).values()];
  if (requested.length === 0) throw new ApiError("VALIDATION_ERROR", "Choose at least one follow-up.", { field: "tasks" });
  if (requested.length > MAX_REASSIGN_BATCH) throw new ApiError("VALIDATION_ERROR", `Reassign at most ${MAX_REASSIGN_BATCH} follow-ups at a time.`, { field: "tasks" });

  const to = await requireEligibleOwner(ctx, input.toOwnerId);
  const batchId = `rb_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  const result: ReassignResult = { batchId, toOwnerId: to.id, toOwnerName: to.name, reassigned: [], skipped: [] };

  for (const request of requested) {
    const task = await FollowUpTask.findOne({ _id: request.id, companyId: ctx.actor.companyId })
      .select("leadId ownerId originalOwnerId version status")
      .session(ctx.session ?? null)
      .lean<Pick<IFollowUpTask, "_id" | "leadId" | "ownerId" | "originalOwnerId" | "version" | "status">>();
    if (!task) {
      result.skipped.push({ taskId: request.id, reason: "not_found" });
      continue;
    }
    if (task.status !== "open") {
      result.skipped.push({ taskId: request.id, reason: "not_open" });
      continue;
    }
    if (request.version !== undefined && request.version !== task.version) {
      result.skipped.push({ taskId: request.id, reason: "changed" });
      continue;
    }
    const previous = await findOwner(ctx, task.ownerId);
    const problem = await problemOf(previous ? { _id: task.ownerId, ...previous } : null, ctx.actor.companyId);
    if (!problem) {
      result.skipped.push({ taskId: request.id, reason: "owner_still_allowed" });
      continue;
    }
    const lead = await Lead.findOne({ _id: task.leadId, companyId: ctx.actor.companyId, status: { $nin: ["won", "lost"] } })
      .select("customerId")
      .session(ctx.session ?? null)
      .lean<{ _id: string; customerId: number | null }>();
    if (!lead) {
      result.skipped.push({ taskId: request.id, reason: "lead_closed" });
      continue;
    }

    const change = ownerChangeParts(ctx, task, to.id, "owner_unavailable", { batchId, note });
    if (!(await updateOpenTaskIfCurrent(ctx, task, change.set, change.entry))) {
      result.skipped.push({ taskId: request.id, reason: "changed" });
      continue;
    }
    const previousName = previous ? displayName(previous) : "a former team member";
    await recordCrmActivity({
      companyId: ctx.actor.companyId,
      leadId: task.leadId,
      customerId: lead.customerId,
      type: "follow_up",
      title: "Follow-up owner changed",
      description: [`Owner changed from ${previousName} (${OWNER_PROBLEM_TEXT[problem]}) to ${to.name}.`, note].filter(Boolean).join(" "),
      metadata: { taskId: String(task._id), batchId, fromOwnerId: task.ownerId, toOwnerId: to.id, reason: "owner_unavailable" },
      performedBy: ctx.actor.userId,
      session: ctx.session ?? null,
    });
    result.reassigned.push({ taskId: String(task._id), leadId: task.leadId, fromOwnerId: task.ownerId });
  }
  return result;
}
