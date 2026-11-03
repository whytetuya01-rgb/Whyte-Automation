import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, FollowUpReminderDigest, FollowUpTask, Lead } from "@/models";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { canOwnFollowUps, displayName } from "@/lib/followUpService";
import { businessDayKey, followUpBucket, resolveFollowUpTimeZone } from "@/lib/followUps";
import { sendEmail } from "@/lib/email/service";

/**
 * The morning follow-up email. Once a day a scheduler calls `/api/cron/follow-up-reminders`; every person who owns open
 * follow-ups that are overdue or due today (in their own time zone) gets ONE email listing them, with a link to the
 * follow-ups page. Nobody gets the same day's email twice (see `FollowUpReminderDigest`), people who turned it off in My
 * account get nothing, and follow-ups of won, lost or deleted leads are left out, exactly like the follow-ups page.
 *
 * In-app notices (the bell) are separate and keep working without this.
 */

const HORIZON_MS = 36 * 3600 * 1000; // far enough ahead to cover "today" in any time zone

export interface DigestItem {
  leadId: string;
  referenceNumber: string;
  customerName: string;
  projectType: string | null;
  dueAt: Date;
  overdue: boolean;
}

export interface DigestEmailInput {
  personName: string;
  companyName: string | null;
  timeZone: string;
  items: DigestItem[];
  appUrl: string | null;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Subject, HTML and text of one person's email. Pure, so it can be tested without sending anything. */
export function buildFollowUpDigestEmail(input: DigestEmailInput): { subject: string; html: string; text: string } {
  const overdue = input.items.filter((item) => item.overdue).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const today = input.items.filter((item) => !item.overdue).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const counts = [today.length ? `${today.length} due today` : null, overdue.length ? `${overdue.length} overdue` : null].filter(Boolean).join(", ");
  const subject = `${input.companyName ? `${input.companyName}: ` : ""}Follow-ups for today (${counts})`;

  const time = new Intl.DateTimeFormat("en-IN", { timeZone: input.timeZone, hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: input.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const line = (item: DigestItem) => `${item.overdue ? date.format(item.dueAt) : time.format(item.dueAt)} · ${item.customerName} (${item.referenceNumber})${item.projectType ? ` · ${item.projectType}` : ""}`;
  const listUrl = input.appUrl ? `${input.appUrl}/admin/crm/follow-ups` : null;
  const accountUrl = input.appUrl ? `${input.appUrl}/admin/account` : null;

  const section = (title: string, rows: DigestItem[], colour: string) =>
    rows.length === 0
      ? ""
      : `<h3 style="margin:20px 0 8px;font-size:13px;color:${colour};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(title)}</h3>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#111;">${rows.map((item) => `<li>${escapeHtml(line(item))}</li>`).join("")}</ul>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;">
<p style="margin:0 0 4px;font-size:15px;color:#111;">Hello ${escapeHtml(input.personName)},</p>
<p style="margin:0;font-size:14px;color:#444;">Here are your follow-ups for today: ${escapeHtml(counts)}.</p>
${section(`Overdue (${overdue.length})`, overdue, "#b91c1c")}
${section(`Due today (${today.length})`, today, "#b45309")}
${listUrl ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(listUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:bold;">Open follow-ups</a></p>` : ""}
<p style="margin:24px 0 0;font-size:12px;color:#888;">Times are in ${escapeHtml(input.timeZone)}. You get this email because you own these follow-ups.${accountUrl ? ` You can turn it off in <a href="${escapeHtml(accountUrl)}" style="color:#888;">My account</a>.` : " You can turn it off in My account."}</p>
</div></body></html>`;

  const text = [
    `Hello ${input.personName},`,
    "",
    `Here are your follow-ups for today: ${counts}.`,
    ...(overdue.length ? ["", `OVERDUE (${overdue.length})`, ...overdue.map((item) => `- ${line(item)}`)] : []),
    ...(today.length ? ["", `DUE TODAY (${today.length})`, ...today.map((item) => `- ${line(item)}`)] : []),
    ...(listUrl ? ["", `Open follow-ups: ${listUrl}`] : []),
    "",
    `Times are in ${input.timeZone}. You get this email because you own these follow-ups. You can turn it off in My account${accountUrl ? ` (${accountUrl})` : ""}.`,
  ].join("\n");

  return { subject, html, text };
}

export interface DigestRunResult {
  companies: number;
  people: number;
  sent: number;
  alreadySent: number;
  turnedOff: number;
  failed: number;
  failures: Array<{ companyId: number; userId: number; reason: string }>;
}

interface OwnerRow {
  _id: number;
  companyId?: number | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
  isActive?: boolean;
  permissions?: string[] | null;
  timeZone?: string | null;
  followUpReminderEmails?: boolean | null;
}

const isDuplicateKey = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;

const inCompany = <T>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 0, role: "admin", actingAsCompany: false }, fn);

/** One company: everyone in it with follow-ups overdue or due today gets their email (at most once per day). */
async function runCompany(companyId: number, now: Date, appUrl: string | null, result: DigestRunResult): Promise<void> {
  const tasks = await FollowUpTask.find({ companyId, status: "open", dueAt: { $lt: new Date(now.getTime() + HORIZON_MS) } })
    .select("leadId ownerId dueAt")
    .sort({ dueAt: 1 })
    .limit(5000)
    .lean<Array<{ _id: string; leadId: string; ownerId: number; dueAt: Date }>>();
  if (tasks.length === 0) return;

  // Closed (won / lost) and deleted leads have no follow-up to remind anyone of; the soft-delete plugin hides deleted ones.
  const leads = await Lead.find({ companyId, _id: { $in: Array.from(new Set(tasks.map((task) => task.leadId))) }, status: { $nin: ["won", "lost"] } })
    .select("referenceNumber customerName projectType")
    .lean<Array<{ _id: string; referenceNumber: string; customerName: string; projectType?: string | null }>>();
  const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));

  const owners = await AdminUser.find({ companyId, _id: { $in: Array.from(new Set(tasks.map((task) => task.ownerId))) } })
    .select("companyId name firstName lastName email role isActive permissions timeZone followUpReminderEmails")
    .lean<OwnerRow[]>();
  const company = await Company.findById(companyId).select("name").lean<{ name?: string | null }>();

  for (const owner of owners) {
    if (!owner.email || !(await canOwnFollowUps(owner, companyId))) continue;
    const timeZone = resolveFollowUpTimeZone(owner.timeZone);
    const items: DigestItem[] = [];
    for (const task of tasks) {
      if (task.ownerId !== owner._id) continue;
      const lead = leadById.get(String(task.leadId));
      if (!lead) continue;
      const bucket = followUpBucket(new Date(task.dueAt), now, timeZone);
      if (bucket === "upcoming") continue;
      items.push({ leadId: String(lead._id), referenceNumber: lead.referenceNumber, customerName: lead.customerName, projectType: lead.projectType ?? null, dueAt: new Date(task.dueAt), overdue: bucket === "overdue" });
    }
    if (items.length === 0) continue;
    result.people += 1;
    if (owner.followUpReminderEmails === false) {
      result.turnedOff += 1;
      continue;
    }

    const dayKey = businessDayKey(now, timeZone);
    const id = `${companyId}:${owner._id}:${dayKey}`;
    const overdue = items.filter((item) => item.overdue).length;
    try {
      await FollowUpReminderDigest.create([{ _id: id, companyId, userId: owner._id, dayKey, status: "sending", overdue, dueToday: items.length - overdue, createdAt: now }]);
    } catch (error) {
      if (isDuplicateKey(error)) {
        result.alreadySent += 1;
        continue;
      }
      throw error;
    }

    const email = buildFollowUpDigestEmail({ personName: displayName(owner), companyName: company?.name ?? null, timeZone, items, appUrl });
    const sent = await sendEmail({ to: owner.email, ...email });
    if (sent.sent) {
      await FollowUpReminderDigest.updateOne({ _id: id, companyId }, { $set: { status: "sent", sentAt: new Date(), providerMessageId: sent.id ?? null } });
      result.sent += 1;
    } else {
      // Not sent: release the claim so the next run tries again.
      await FollowUpReminderDigest.deleteOne({ _id: id, companyId, status: "sending" });
      result.failed += 1;
      result.failures.push({ companyId, userId: owner._id, reason: sent.reason ?? "UNKNOWN" });
    }
  }
}

/** One pass over every company that has open follow-ups due soon. Safe to run more than once a day. */
export async function runFollowUpReminderDigest(options: { now?: Date; budgetMs?: number } = {}): Promise<DigestRunResult> {
  await connectMongoDB();
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const appUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "") || null;
  const result: DigestRunResult = { companies: 0, people: 0, sent: 0, alreadySent: 0, turnedOff: 0, failed: 0, failures: [] };

  const companyIds = await runUnscoped("follow-up-reminder-worker", async () =>
    (await FollowUpTask.distinct("companyId", { status: "open", dueAt: { $lt: new Date(now.getTime() + HORIZON_MS) } })) as number[]
  );
  for (const companyId of companyIds.sort((a, b) => a - b)) {
    if (options.budgetMs && Date.now() - startedAt > options.budgetMs) break; // the rest go on the next run
    result.companies += 1;
    try {
      await inCompany(companyId, () => runCompany(companyId, now, appUrl, result));
    } catch (error) {
      console.error("[follow-up reminders] company failed", { companyId, error });
      result.failures.push({ companyId, userId: 0, reason: error instanceof Error ? error.message.slice(0, 200) : "ERROR" });
    }
  }
  return result;
}
