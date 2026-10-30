/**
 * CRM customer profile numbers: approved value, open pipeline, approval rate, segment, next follow-up, activity and
 * quotation filters, and the relative-date wording. Pure helpers, no server.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/crm-customer-insights.test.ts
 */
import assert from "node:assert/strict";
import { ACTIVITY_FILTERS, computeCustomerStats, filterActivities, filterQuotations, followUpLabel, relativeTime } from "../src/lib/crmCustomerInsights";
import type { CrmActivity, CustomerProfile } from "../src/types/crm";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const NOW = new Date("2026-10-30T10:00:00").getTime();
const day = (offset: number) => new Date(NOW + offset * 86_400_000).toISOString();
const quotation = (id: string, status: string, grandTotal: number, offset = 0) => ({ id, quotationNumber: `QT-${id}`, clientName: "C", status, grandTotal, createdAt: day(offset) });
const lead = (id: string, status: CustomerProfile["leads"][number]["status"], budget: number | null, followUp?: number) => ({
  id, referenceNumber: `LD-${id}`, status, priority: "medium" as const, estimatedBudget: budget, createdAt: day(-5), ...(followUp === undefined ? {} : { nextFollowUpAt: day(followUp) }),
});
const activity = (id: string, type: CrmActivity["type"], offset: number): CrmActivity => ({ id, companyId: 1, type, title: id, performedBy: 1, performedByName: "A", performedAt: day(offset) });

function main() {
  // ── stats ──
  const empty = computeCustomerStats({ quotations: [], leads: [], activities: [] }, NOW);
  assert.deepEqual([empty.segment, empty.approvedValue, empty.approvalRate, empty.nextFollowUp, empty.lastActivityAt, empty.averageOrderValue], ["new", 0, null, null, null, 0]);

  const stats = computeCustomerStats(
    {
      quotations: [quotation("1", "draft", 1000), quotation("2", "sent", 2000), quotation("3", "approved", 5000), quotation("4", "delivered", 3000), quotation("5", "rejected", 4000)],
      leads: [lead("a", "new", 100000, -2), lead("b", "quoted", 250000, 3), lead("c", "won", 900000, -9), lead("d", "lost", 50000), lead("e", "contacted", null)],
      activities: [activity("x", "call", -3), activity("y", "note", -1), activity("z", "email", -8)],
    },
    NOW
  );
  assert.deepEqual([stats.quotationCount, stats.quotationValue], [5, 15000]);
  assert.deepEqual([stats.approvedCount, stats.approvedValue, stats.averageOrderValue], [2, 8000, 4000], "approved and delivered count as approved");
  assert.equal(stats.approvalRate, 2 / 3, "approved ÷ (approved + rejected); drafts and sent ones are undecided");
  assert.deepEqual(stats.statusCounts, { draft: 1, sent: 1, approved: 1, delivered: 1, rejected: 1 });
  assert.deepEqual([stats.leadCount, stats.openLeadCount, stats.wonLeadCount, stats.lostLeadCount], [5, 3, 1, 1]);
  assert.equal(stats.openPipelineValue, 350000, "only open enquiries' budgets (a missing budget counts as 0)");
  assert.equal(stats.segment, "repeat");
  assert.equal(stats.lastActivityAt, day(-1), "the most recent activity");
  assert.deepEqual([stats.nextFollowUp?.referenceNumber, stats.nextFollowUp?.overdue], ["LD-a", true], "the earliest follow-up among OPEN enquiries (the won one's old date is ignored); overdue is flagged");
  pass("headline numbers: approved value / average, approval rate, open pipeline, enquiry counts, last activity, next follow-up");

  const segment = (q: string[], l: Array<CustomerProfile["leads"][number]["status"]>) =>
    computeCustomerStats({ quotations: q.map((s, i) => quotation(String(i), s, 100)), leads: l.map((s, i) => lead(String(i), s, 1)), activities: [] }, NOW).segment;
  assert.deepEqual([segment([], []), segment([], ["new"]), segment(["draft"], []), segment(["approved"], []), segment(["approved", "delivered"], []), segment(["rejected"], [])], ["new", "prospect", "prospect", "customer", "repeat", "prospect"]);
  const upcoming = computeCustomerStats({ quotations: [], leads: [lead("f", "new", 1, 2)], activities: [] }, NOW);
  assert.equal(upcoming.nextFollowUp?.overdue, false);
  const today = computeCustomerStats({ quotations: [], leads: [lead("g", "new", 1, 0)], activities: [] }, NOW);
  assert.equal(today.nextFollowUp?.overdue, false, "a follow-up due today is not overdue");
  pass("segments (new / prospect / customer / repeat) and the overdue rule (today is not overdue)");

  // ── filters ──
  const acts = [activity("c", "call", -1), activity("w", "whatsapp", -2), activity("v", "site_visit", -3), activity("q", "quotation_viewed", -4), activity("n", "note", -5), activity("s", "status_change", -6)];
  assert.deepEqual(ACTIVITY_FILTERS.map((f) => f.id), ["all", "contact", "visits", "quotations", "updates"]);
  assert.equal(filterActivities(acts, "all").length, 6);
  assert.deepEqual(filterActivities(acts, "contact").map((a) => a.id), ["c", "w"]);
  assert.deepEqual(filterActivities(acts, "visits").map((a) => a.id), ["v"]);
  assert.deepEqual(filterActivities(acts, "quotations").map((a) => a.id), ["q"]);
  assert.deepEqual(filterActivities(acts, "updates").map((a) => a.id), ["n", "s"]);
  const copy = filterActivities(acts, "all");
  copy.pop();
  assert.equal(acts.length, 6, "the input is never changed");

  const quotes = [quotation("1", "draft", 1000, -3), quotation("2", "approved", 5000, -2), quotation("3", "sent", 3000, -1), quotation("10", "approved", 5000, -4)];
  const ids = (rows: typeof quotes) => rows.map((q) => q.id);
  assert.deepEqual(ids(filterQuotations(quotes, { status: "all", search: "", sort: "newest" })), ["3", "2", "1", "10"]);
  assert.deepEqual(ids(filterQuotations(quotes, { status: "all", search: "", sort: "oldest" })), ["10", "1", "2", "3"]);
  assert.deepEqual(ids(filterQuotations(quotes, { status: "all", search: "", sort: "value_desc" })), ["2", "10", "3", "1"], "equal values: newest first");
  assert.deepEqual(ids(filterQuotations(quotes, { status: "all", search: "", sort: "value_asc" })), ["1", "3", "2", "10"]);
  assert.deepEqual(ids(filterQuotations(quotes, { status: "approved", search: "", sort: "newest" })), ["2", "10"]);
  assert.deepEqual(ids(filterQuotations(quotes, { status: "all", search: " qt-1 ", sort: "newest" })), ["1", "10"], "search is case-insensitive and trimmed");
  assert.deepEqual(ids(filterQuotations(quotes, { status: "draft", search: "qt-3", sort: "newest" })), [], "filters combine");
  assert.deepEqual(ids(quotes), ["1", "2", "3", "10"], "the input order is never changed");
  pass("activity filters and quotation status / search / sort work and never change their input");

  // ── wording ──
  assert.deepEqual([relativeTime(null), relativeTime("nope", NOW), relativeTime(new Date(NOW - 20_000).toISOString(), NOW), relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW), relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), relativeTime(day(-4), NOW)], ["—", "—", "Just now", "5m ago", "3h ago", "4d ago"]);
  assert.match(relativeTime(day(-90), NOW), /2026/, "older than a month: the date");
  assert.deepEqual(followUpLabel(day(0), NOW), { text: "Today", overdue: false, today: true });
  assert.deepEqual(followUpLabel(day(1), NOW), { text: "Tomorrow", overdue: false, today: false });
  assert.deepEqual(followUpLabel(day(4), NOW), { text: "In 4 days", overdue: false, today: false });
  assert.deepEqual(followUpLabel(day(-1), NOW), { text: "1 day overdue", overdue: true, today: false });
  assert.deepEqual(followUpLabel(day(-3), NOW), { text: "3 days overdue", overdue: true, today: false });
  pass("relative times and follow-up wording (today, tomorrow, in N days, N days overdue)");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
