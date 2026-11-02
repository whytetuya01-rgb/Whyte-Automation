import { randomBytes } from "node:crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, FollowUpTask, Lead } from "@/models";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { canOwnFollowUps } from "@/lib/followUpService";

/**
 * Gives every lead that already has a follow-up date a follow-up task (see models/FollowUpTask.ts). Safe to run twice.
 *
 * It is never needed for the app to work: an old follow-up is adopted automatically the first time it is changed. Running
 * it just makes every follow-up carry its owner from the start, which the Google Calendar sync will rely on.
 *
 * Owner of each task: the person who created the lead if they can still own follow-ups, otherwise the company's first
 * active Company Owner. A lead with neither is listed in `needsOwner` and left alone; nothing is guessed.
 *
 * Nothing is written unless `apply` is true. The report lists lead reference numbers only (no names or phone numbers).
 */

export interface CompanyBackfillReport {
  companyId: number;
  companyName: string;
  leadsWithDate: number;
  alreadyHaveTask: number;
  created: number;
  /** An open task whose date differed from the lead's: the lead's date wins. */
  dateCorrected: number;
  /** Open tasks whose lead no longer has a date (reported only; they are closed the first time the lead is changed). */
  staleTasks: number;
  /** Lead reference numbers with no usable owner. */
  needsOwner: string[];
}

export interface BackfillReport {
  applied: boolean;
  companies: CompanyBackfillReport[];
  totals: { leadsWithDate: number; alreadyHaveTask: number; created: number; dateCorrected: number; staleTasks: number; needsOwner: number };
}

const SYSTEM_USER_ID = 0;

async function backfillCompany(company: { companyId: number; companyName: string }, apply: boolean, now: Date): Promise<CompanyBackfillReport> {
  const { companyId } = company;
  const report: CompanyBackfillReport = { ...company, leadsWithDate: 0, alreadyHaveTask: 0, created: 0, dateCorrected: 0, staleTasks: 0, needsOwner: [] };

  const leads = await Lead.find({ companyId, nextFollowUpAt: { $ne: null } })
    .select("referenceNumber nextFollowUpAt createdBy updatedAt")
    .sort({ _id: 1 })
    .lean<Array<{ _id: string; referenceNumber: string; nextFollowUpAt: Date; createdBy: number; updatedAt?: Date }>>();
  report.leadsWithDate = leads.length;

  const openTasks = await FollowUpTask.find({ companyId, status: "open" }).select("leadId dueAt version").lean<Array<{ _id: string; leadId: string; dueAt: Date; version: number }>>();
  const taskByLead = new Map(openTasks.map((task) => [task.leadId, task]));
  const leadIdsWithDate = new Set(leads.map((lead) => lead._id));
  report.staleTasks = openTasks.filter((task) => !leadIdsWithDate.has(task.leadId)).length;

  // Who may own follow-ups, looked up once per person.
  const eligibility = new Map<number, boolean>();
  const isEligible = async (userId: number): Promise<boolean> => {
    if (!eligibility.has(userId)) {
      const user = await AdminUser.findOne({ _id: userId, companyId }).select("role isActive permissions").lean<{ role?: string; isActive?: boolean; permissions?: string[] }>();
      eligibility.set(userId, Boolean(user) && (await canOwnFollowUps(user!, companyId)));
    }
    return eligibility.get(userId) as boolean;
  };
  let fallbackOwner: number | null | undefined;
  const companyOwner = async (): Promise<number | null> => {
    if (fallbackOwner === undefined) {
      fallbackOwner = null;
      const owners = await AdminUser.find({ companyId, role: "company_owner", isActive: { $ne: false } }).sort({ _id: 1 }).select("_id").lean<Array<{ _id: number }>>();
      for (const owner of owners) {
        if (await isEligible(owner._id)) {
          fallbackOwner = owner._id;
          break;
        }
      }
    }
    return fallbackOwner;
  };

  for (const lead of leads) {
    const dueAt = new Date(lead.nextFollowUpAt);
    const task = taskByLead.get(lead._id);

    if (task) {
      if (task.dueAt.getTime() === dueAt.getTime()) {
        report.alreadyHaveTask += 1;
        continue;
      }
      report.dateCorrected += 1;
      if (apply) {
        await FollowUpTask.updateOne({ _id: task._id, status: "open", version: task.version }, { $set: { dueAt, scheduleChangedAt: now, updatedAt: now }, $inc: { version: 1 } });
      }
      continue;
    }

    const ownerId = (lead.createdBy && (await isEligible(lead.createdBy)) ? lead.createdBy : null) ?? (await companyOwner());
    if (ownerId == null) {
      report.needsOwner.push(lead.referenceNumber);
      continue;
    }
    report.created += 1;
    if (apply) {
      try {
        await FollowUpTask.create({
          // Safe to repeat: the database allows only one OPEN task per lead, so a second run (or a request adopting the same
          // follow-up at the same moment) cannot add another.
          _id: `ft_bf_${now.getTime().toString(36)}_${randomBytes(4).toString("hex")}`,
          companyId,
          leadId: lead._id,
          ownerId,
          dueAt,
          status: "open",
          version: 1,
          scheduleChangedAt: lead.updatedAt ? new Date(lead.updatedAt) : now,
          createdVia: "backfill",
          createdBy: lead.createdBy || ownerId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        // Someone adopted this follow-up a moment ago: nothing left to do for it.
        if ((error as { code?: unknown }).code !== 11000) throw error;
        report.created -= 1;
        report.alreadyHaveTask += 1;
      }
    }
  }
  return report;
}

/** `companyIds` limits the run to those companies (default: all). */
export async function backfillFollowUpTasks(options: { apply: boolean; now?: Date; companyIds?: number[] }): Promise<BackfillReport> {
  await connectMongoDB();
  const now = options.now ?? new Date();
  const only = options.companyIds && options.companyIds.length > 0 ? { _id: { $in: options.companyIds } } : {};
  const companies = await runUnscoped("migration", async () => await Company.find(only).select("_id name").sort({ _id: 1 }).lean<Array<{ _id: number; name: string }>>());

  const reports: CompanyBackfillReport[] = [];
  for (const company of companies) {
    reports.push(
      await runWithTenantContext({ companyId: company._id, userId: SYSTEM_USER_ID, role: "system", actingAsCompany: false }, () =>
        backfillCompany({ companyId: company._id, companyName: company.name }, options.apply, now)
      )
    );
  }

  const sum = (pick: (report: CompanyBackfillReport) => number) => reports.reduce((total, report) => total + pick(report), 0);
  return {
    applied: options.apply,
    companies: reports,
    totals: {
      leadsWithDate: sum((r) => r.leadsWithDate),
      alreadyHaveTask: sum((r) => r.alreadyHaveTask),
      created: sum((r) => r.created),
      dateCorrected: sum((r) => r.dateCorrected),
      staleTasks: sum((r) => r.staleTasks),
      needsOwner: sum((r) => r.needsOwner.length),
    },
  };
}
