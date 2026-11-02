/**
 * Numbers and groupings shown on a CRM customer profile, worked out from what GET /api/crm/customers/[id] returns.
 * Pure (no server imports) so the profile and its tests share one definition of "approved value", "open pipeline" etc.
 */
import type { CrmActivity, CrmActivityType, CustomerProfile } from "@/types/crm";
import { followUpStatus, isFollowUpOverdue } from "@/lib/followUps";

/** Quotation statuses that count as the customer having said yes. */
export const APPROVED_QUOTATION_STATUSES = ["approved", "delivered"] as const;

const isApproved = (status: string) => (APPROVED_QUOTATION_STATUSES as readonly string[]).includes(status);
const isOpenLead = (status: string) => status !== "won" && status !== "lost";

export type CustomerSegment = "repeat" | "customer" | "prospect" | "new";

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  repeat: "Repeat customer",
  customer: "Customer",
  prospect: "Prospect",
  new: "New contact",
};

export interface CustomerStats {
  quotationCount: number;
  quotationValue: number;
  approvedCount: number;
  approvedValue: number;
  averageOrderValue: number;
  /** Approved ÷ decided (approved + rejected) quotations; null until one has been decided. */
  approvalRate: number | null;
  statusCounts: Record<string, number>;
  leadCount: number;
  openLeadCount: number;
  openPipelineValue: number;
  wonLeadCount: number;
  lostLeadCount: number;
  lastActivityAt: string | null;
  /** The earliest follow-up date among open enquiries (overdue ones included). */
  nextFollowUp: { at: string; leadId: string; referenceNumber: string; overdue: boolean } | null;
  segment: CustomerSegment;
}

export function computeCustomerStats(profile: Pick<CustomerProfile, "quotations" | "leads" | "activities">, now: number = Date.now()): CustomerStats {
  const quotations = profile.quotations ?? [];
  const leads = profile.leads ?? [];
  const activities = profile.activities ?? [];

  const approved = quotations.filter((q) => isApproved(q.status));
  const rejected = quotations.filter((q) => q.status === "rejected");
  const approvedValue = approved.reduce((sum, q) => sum + (q.grandTotal || 0), 0);
  const statusCounts: Record<string, number> = {};
  for (const q of quotations) statusCounts[q.status] = (statusCounts[q.status] ?? 0) + 1;

  const openLeads = leads.filter((l) => isOpenLead(l.status));
  const followUps = openLeads
    .filter((l) => l.nextFollowUpAt && !Number.isNaN(new Date(l.nextFollowUpAt).getTime()))
    .map((l) => ({ at: l.nextFollowUpAt as string, leadId: l.id, referenceNumber: l.referenceNumber }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const next = followUps[0];

  const decided = approved.length + rejected.length;
  const lastActivityAt = activities.reduce<string | null>((latest, a) => (!latest || new Date(a.performedAt) > new Date(latest) ? a.performedAt : latest), null);

  const segment: CustomerSegment = approved.length >= 2 ? "repeat" : approved.length === 1 ? "customer" : quotations.length > 0 || leads.length > 0 ? "prospect" : "new";

  return {
    quotationCount: quotations.length,
    quotationValue: quotations.reduce((sum, q) => sum + (q.grandTotal || 0), 0),
    approvedCount: approved.length,
    approvedValue,
    averageOrderValue: approved.length > 0 ? approvedValue / approved.length : 0,
    approvalRate: decided > 0 ? approved.length / decided : null,
    statusCounts,
    leadCount: leads.length,
    openLeadCount: openLeads.length,
    openPipelineValue: openLeads.reduce((sum, l) => sum + (l.estimatedBudget || 0), 0),
    wonLeadCount: leads.filter((l) => l.status === "won").length,
    lostLeadCount: leads.filter((l) => l.status === "lost").length,
    lastActivityAt,
    nextFollowUp: next ? { ...next, overdue: isFollowUpOverdue(next.at, now) } : null,
    segment,
  };
}

export type ActivityFilterId = "all" | "contact" | "visits" | "quotations" | "updates";

export const ACTIVITY_FILTERS: Array<{ id: ActivityFilterId; label: string; types: CrmActivityType[] | null }> = [
  { id: "all", label: "All", types: null },
  { id: "contact", label: "Calls & messages", types: ["call", "whatsapp", "email"] },
  { id: "visits", label: "Visits & meetings", types: ["site_visit", "meeting"] },
  { id: "quotations", label: "Quotations", types: ["quotation_sent", "quotation_viewed"] },
  { id: "updates", label: "Notes & updates", types: ["note", "follow_up", "status_change"] },
];

export function filterActivities(activities: ReadonlyArray<CrmActivity>, filter: ActivityFilterId): CrmActivity[] {
  const types = ACTIVITY_FILTERS.find((f) => f.id === filter)?.types;
  return types ? activities.filter((a) => types.includes(a.type)) : [...activities];
}

export type QuotationSort = "newest" | "oldest" | "value_desc" | "value_asc";

/** Quotations narrowed by status and a search on the number, sorted. Never mutates the input. */
export function filterQuotations<T extends { quotationNumber: string; status: string; grandTotal: number; createdAt: string }>(
  quotations: ReadonlyArray<T>,
  options: { status: string; search: string; sort: QuotationSort }
): T[] {
  const needle = options.search.trim().toLowerCase();
  const rows = quotations.filter((q) => (options.status === "all" || q.status === options.status) && (!needle || q.quotationNumber.toLowerCase().includes(needle)));
  const byDate = (a: T, b: T) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return rows.sort((a, b) => {
    switch (options.sort) {
      case "oldest":
        return byDate(a, b);
      case "value_desc":
        return (b.grandTotal || 0) - (a.grandTotal || 0) || byDate(b, a);
      case "value_asc":
        return (a.grandTotal || 0) - (b.grandTotal || 0) || byDate(b, a);
      default:
        return byDate(b, a);
    }
  });
}

/** "Just now" / "5m ago" / "3d ago" / a date, for a past instant. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "—";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "Today" / "Tomorrow" / "In 3 days" / "2 days overdue" for a follow-up date. */
export function followUpLabel(iso: string, now: number = Date.now(), timeZone?: string): { text: string; overdue: boolean; today: boolean } {
  const status = followUpStatus(iso, now, timeZone);
  if (!status) return { text: "—", overdue: false, today: false };
  const days = status.dayOffset;
  if (status.bucket === "overdue") {
    return { text: days === 0 ? "Overdue today" : `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true, today: false };
  }
  if (status.bucket === "today") return { text: "Today", overdue: false, today: true };
  if (days === 1) return { text: "Tomorrow", overdue: false, today: false };
  return { text: `In ${days} days`, overdue: false, today: false };
}
