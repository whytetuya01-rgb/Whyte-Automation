import { AdminUser, Category, Product, Quotation, QuotationDelivery, Lead } from "@/models";
import { attachQuotationActors } from "@/lib/quotationActors";
import { getConfirmedEarningsTotal } from "@/lib/dealerEarningsService";
import { calculateDealerEarning, resolveCustomerDiscountPercent, roundMoney, toPlainNumber } from "@/lib/dealerEarnings";
import { aggregateQuotationRoomTotals, deriveQuotationFinancials, isProtectedQuotationStatus, totalsForQuotation } from "@/lib/quotationTotals";
import { getDemoCrmAnalytics, isDemoModeAllowed, type CrmAnalyticsData } from "@/lib/dashboard/demoData";
import type { QuotationStatus } from "@/types";
import { getTenantContext } from "@/lib/tenant/context";
import { dealerTierAnalytics, reconcileCompanyDealerCategories } from "@/lib/dealerTierService";
import type { DealerTierKey } from "@/lib/dealerTiers";

export const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "approved", "rejected", "delivered"];

export type DateRangeKey = "7d" | "30d" | "90d" | "1y" | "all";

export interface MonthBucket {
  key: string;
  label: string;
  total: number;
  byStatus: Record<QuotationStatus, number>;
  approvedValue?: number;
}

export interface RecentQuotationRow {
  id: string;
  quotationNumber: string;
  clientName: string;
  ownerName: string | null;
  ownerIsDealer: boolean;
  amount: number;
  status: QuotationStatus;
  createdAt: string;
}

export interface DealerPerformanceRow {
  dealerId: number;
  name: string;
  email: string | null;
  totalQuotations: number;
  approvedQuotations: number;
  approvedValue: number;
  earnings: number;
  approvalRate: number;
}

export interface DeliveryAnalyticsSummary {
  total: number;
  byStatus: {
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  };
  successRate: number;
  retryCount: number;
  recent: Array<{
    id: string;
    quotationId: string;
    recipient: string;
    status: string;
    createdAt: string;
  }>;
}

export interface DashboardData {
  dateRange: {
    key: DateRangeKey;
    label: string;
    start: string | null;
    end: string;
  };
  quotations: {
    total: number;
    statusCounts: Record<QuotationStatus, number>;
    months: MonthBucket[];
    trend: MonthBucket[];
    thisMonth: number;
    lastMonth: number;
    thisPeriod: number;
    priorPeriod: number;
    periodChangePercent: number | null;
    approvedValueChangePercent: number | null;
    approvedValue: number;
    pendingValue: number;
    sentValue?: number;
    draftValue?: number;
    totalValue?: number;
    averageValue?: number;
    approvalRate: number;
    confirmedDealerEarnings: number;
    recent: RecentQuotationRow[];
  };
  leads?: {
    total: number;
    newLeads: number;
    thisPeriod: number;
    priorPeriod: number;
    periodChangePercent: number | null;
  };
  pipeline: Array<{
    status: QuotationStatus;
    label: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  dealers: {
    items: DealerPerformanceRow[];
    totalActiveDealers: number;
  };
  deliveries: DeliveryAnalyticsSummary;
  catalog: {
    totalProducts: number;
    activeProducts: number;
    inactiveProducts: number;
    matrixProducts: number;
    categoryCount: number;
    seriesCount: number;
    typeBreakdown: Array<{ type: string; count: number; percent: number }>;
  };
  crm: CrmAnalyticsData | null;
  /** Real dealer-category numbers for the company in view (null on the platform, which has no single company). */
  dealerTiers: { dealersByCategory: Record<DealerTierKey, number>; upgradesInPeriod: number } | null;
  isDemoMode: boolean;
}

export interface DashboardOptions {
  dateRange?: DateRangeKey;
  includeDemo?: boolean;
}

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: BUSINESS_TIME_ZONE });
const DAY_LABEL = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: BUSINESS_TIME_ZONE });

function emptyStatusMap(): Record<QuotationStatus, number> {
  return { draft: 0, sent: 0, approved: 0, rejected: 0, delivered: 0 };
}

function isStatus(value: unknown): value is QuotationStatus {
  return typeof value === "string" && (QUOTATION_STATUSES as string[]).includes(value);
}

const PIPELINE_META: Record<QuotationStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#8A8A93" },
  sent: { label: "Sent / Reviewing", color: "#3B82F6" },
  approved: { label: "Approved", color: "#10B981" },
  delivered: { label: "Delivered", color: "#059669" },
  rejected: { label: "Rejected", color: "#EF4444" },
};

/** Resolves explicit date boundaries for the given range key. */
export function resolveDateRange(key: DateRangeKey = "30d", now: Date = new Date()): {
  key: DateRangeKey;
  label: string;
  start: Date | null;
  end: Date;
  priorStart: Date | null;
  priorEnd: Date | null;
} {
  const end = new Date(now.getTime());
  switch (key) {
    case "7d": {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const priorStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { key: "7d", label: "Last 7 days", start, end, priorStart, priorEnd: start };
    }
    case "90d": {
      const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const priorStart = new Date(start.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { key: "90d", label: "Last 90 days", start, end, priorStart, priorEnd: start };
    }
    case "1y": {
      // Start of current calendar year in IST
      const year = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(now);
      const start = new Date(`${year}-01-01T00:00:00+05:30`);
      const priorYear = Number(year) - 1;
      const priorStart = new Date(`${priorYear}-01-01T00:00:00+05:30`);
      const priorEnd = start;
      return { key: "1y", label: "This year", start, end, priorStart, priorEnd };
    }
    case "all": {
      return { key: "all", label: "All time", start: null, end, priorStart: null, priorEnd: null };
    }
    case "30d":
    default: {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const priorStart = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { key: "30d", label: "Last 30 days", start, end, priorStart, priorEnd: start };
    }
  }
}

/** Generates chronological buckets across the selected date range. */
function generateTimeBuckets(rangeKey: DateRangeKey, start: Date | null, end: Date): MonthBucket[] {
  if (rangeKey === "7d" && start) {
    const buckets: MonthBucket[] = [];
    const current = new Date(start.getTime());
    while (current <= end) {
      const key = current.toISOString().slice(0, 10);
      buckets.push({ key, label: DAY_LABEL.format(current), total: 0, byStatus: emptyStatusMap(), approvedValue: 0 });
      current.setDate(current.getDate() + 1);
    }
    return buckets;
  }

  if (rangeKey === "30d" && start) {
    // 6 5-day intervals
    const buckets: MonthBucket[] = [];
    const stepMs = 5 * 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
      const bucketDate = new Date(t);
      const key = bucketDate.toISOString().slice(0, 10);
      buckets.push({ key, label: DAY_LABEL.format(bucketDate), total: 0, byStatus: emptyStatusMap(), approvedValue: 0 });
    }
    return buckets;
  }

  // 90d, 1y, or all: monthly buckets
  const monthsCount = rangeKey === "90d" ? 3 : rangeKey === "1y" ? 12 : 6;
  const buckets: MonthBucket[] = [];
  const current = new Date(end.getTime());
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(current.getFullYear(), current.getMonth() - i, 1, 12);
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: BUSINESS_TIME_ZONE }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "00";
    buckets.push({ key: `${y}-${m}`, label: MONTH_LABEL.format(d), total: 0, byStatus: emptyStatusMap(), approvedValue: 0 });
  }
  return buckets;
}

export async function getAdminDashboardData(options: DashboardOptions = {}): Promise<DashboardData> {
  const rangeKey = options.dateRange || "30d";
  const now = new Date();
  const range = resolveDateRange(rangeKey, now);

  const dateFilter = range.start ? { createdAt: { $gte: range.start, $lte: range.end } } : {};
  const priorFilter = range.priorStart && range.priorEnd ? { createdAt: { $gte: range.priorStart, $lt: range.priorEnd } } : null;

  const [
    totalQuotations,
    statusAgg,
    approvedDocs,
    pendingDocs,
    recentDocs,
    priorTotalQuotations,
    priorApprovedDocs,
    confirmedDealerEarnings,
    dealersList,
    deliveryTotal,
    deliveryStatusAgg,
    deliveryRetryCount,
    recentDeliveriesDocs,
    totalProducts,
    activeProducts,
    matrixProducts,
    categoryCount,
    seriesCount,
    productsByType,
    rejectedDocs,
    leadsInPeriod,
    priorLeadsCount,
    activeOpportunitiesDocs,
    wonLeadsDocs,
    salesPersonnel,
  ] = await Promise.all([
    // Current period counts
    Quotation.countDocuments(dateFilter),
    Quotation.aggregate<{ _id: string; n: number }>([
      ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    Quotation.find({ ...dateFilter, status: { $in: ["approved", "delivered"] } }).lean({ virtuals: true }),
    Quotation.find({ ...dateFilter, status: { $in: ["sent", "draft"] } }).lean({ virtuals: true }),
    Quotation.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(8)
      .populate({ path: "dealer", select: "id name email firstName lastName" })
      .lean({ virtuals: true }),

    // Prior period comparison
    priorFilter ? Quotation.countDocuments(priorFilter) : Promise.resolve(0),
    priorFilter ? Quotation.find({ ...priorFilter, status: { $in: ["approved", "delivered"] } }).lean({ virtuals: true }) : Promise.resolve([]),

    // Dealer confirmed earnings across the active tenant
    getConfirmedEarningsTotal(),
    AdminUser.find({ role: "dealer", isActive: true }).select("id name email").lean(),

    // Quotation delivery analytics (tenant-scoped)
    QuotationDelivery.countDocuments(dateFilter),
    QuotationDelivery.aggregate<{ _id: string; n: number }>([
      ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    QuotationDelivery.countDocuments({ ...dateFilter, attempts: { $gt: 1 } }),
    QuotationDelivery.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("_id quotationId recipient status createdAt")
      .lean(),

    // Catalog stats
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isMatrix: true }),
    Category.countDocuments(),
    Category.countDocuments({ level: 1 }),
    Product.aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // Real CRM & Sales Data (tenant-scoped)
    Quotation.find({ ...dateFilter, status: "rejected" }).lean({ virtuals: true }),
    Lead.find(dateFilter).lean(),
    priorFilter ? Lead.countDocuments(priorFilter) : Promise.resolve(0),
    Lead.find({ status: { $in: ["contacted", "site_visit", "quoted", "negotiation"] } }).lean(),
    Lead.find({ ...dateFilter, status: "won" }).lean(),
    AdminUser.find({
      role: { $in: ["sales_executive", "admin", "company_owner", "configurable_admin"] },
      isActive: true,
    }).select("id name email role").lean(),
  ]);

  // A won lead's revenue is its accepted quotation's total; without one (or before it is approved), its estimated budget.
  const wonConvertedIds = Array.from(new Set(leadsInPeriod.filter((l) => l.status === "won" && l.convertedQuotationId).map((l) => String(l.convertedQuotationId))));
  const wonConvertedDocs = wonConvertedIds.length > 0
    ? await Quotation.find({ _id: { $in: wonConvertedIds }, status: { $in: ["approved", "delivered"] } }).lean({ virtuals: true })
    : [];

  // Status counts
  const statusCounts = emptyStatusMap();
  for (const row of statusAgg) {
    if (isStatus(row._id)) statusCounts[row._id] = row.n;
  }

  // Calculate Subtotals & Financials using application's single source of truth
  const subtotalSourceIds = Array.from(
    new Set([
      ...approvedDocs.map((d) => String(d._id)),
      ...pendingDocs.map((d) => String(d._id)),
      ...rejectedDocs.map((d) => String(d._id)),
      ...recentDocs.map((d) => String(d._id)),
      ...priorApprovedDocs.map((d) => String(d._id)),
      ...wonConvertedDocs.map((d) => String(d._id)),
    ])
  );
  // Approved and delivered quotations keep their full value even if a product in them was deleted later.
  const protectedIds = [...approvedDocs, ...recentDocs, ...priorApprovedDocs, ...wonConvertedDocs]
    .filter((d) => isProtectedQuotationStatus(d.status))
    .map((d) => String(d._id));
  const aggregatedTotals = await aggregateQuotationRoomTotals(subtotalSourceIds, protectedIds);

  const grandTotalOf = (doc: {
    _id: unknown;
    discountType?: unknown;
    discountValue?: unknown;
    customerDiscountPercent?: unknown;
    allocatedDiscountPercent?: unknown;
  }): number => {
    const { subtotal } = totalsForQuotation(aggregatedTotals, String(doc._id));
    const financials = deriveQuotationFinancials({
      subtotal,
      discountType: doc.discountType as string | null | undefined,
      discountValue: doc.discountValue,
      customerDiscountPercent: doc.customerDiscountPercent,
      allocatedDiscountPercent: doc.allocatedDiscountPercent,
    });
    return financials.grandTotal;
  };

  const dealerEarningOf = (doc: {
    _id: unknown;
    allocatedDiscountPercent?: unknown;
    customerDiscountPercent?: unknown;
    discountType?: unknown;
    discountValue?: unknown;
  }): number => {
    const { subtotal } = totalsForQuotation(aggregatedTotals, String(doc._id));
    const { earningAmount } = calculateDealerEarning({
      subtotal,
      allocatedPercent: toPlainNumber(doc.allocatedDiscountPercent),
      customerPercent: resolveCustomerDiscountPercent({
        customerDiscountPercent: doc.customerDiscountPercent,
        discountType: doc.discountType as string | null | undefined,
        discountValue: doc.discountValue,
      }),
    });
    return earningAmount;
  };

  const approvedValue = roundMoney(approvedDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));
  const pendingValue = roundMoney(pendingDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));
  const priorApprovedValue = roundMoney(priorApprovedDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));

  const sentDocs = pendingDocs.filter((d) => d.status === "sent");
  const draftDocs = pendingDocs.filter((d) => d.status === "draft");
  const sentValue = roundMoney(sentDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));
  const draftValue = roundMoney(draftDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));
  const rejectedValue = roundMoney(rejectedDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0));
  const totalQuotationValue = roundMoney(approvedValue + pendingValue + rejectedValue);
  const averageValue = totalQuotations > 0 ? roundMoney(totalQuotationValue / totalQuotations) : 0;
  const allPeriodDocs = [...approvedDocs, ...pendingDocs, ...rejectedDocs];

  // Time trend buckets
  const trendBuckets = generateTimeBuckets(range.key, range.start, range.end);
  // Every quotation of the period exactly once (approved, pending and rejected cover every status).
  const allDocs = allPeriodDocs;
  for (const doc of allDocs) {
    const createdAt = new Date(doc.createdAt);
    let matchKey = "";
    if (range.key === "7d") {
      matchKey = createdAt.toISOString().slice(0, 10);
    } else if (range.key === "30d") {
      // Find nearest 5-day interval bucket
      const docTime = createdAt.getTime();
      let bestDiff = Infinity;
      for (const b of trendBuckets) {
        const bTime = new Date(b.key).getTime();
        const diff = Math.abs(docTime - bTime);
        if (diff < bestDiff) {
          bestDiff = diff;
          matchKey = b.key;
        }
      }
    } else {
      const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: BUSINESS_TIME_ZONE }).formatToParts(createdAt);
      const y = parts.find((p) => p.type === "year")?.value ?? "0000";
      const m = parts.find((p) => p.type === "month")?.value ?? "00";
      matchKey = `${y}-${m}`;
    }

    const bucket = trendBuckets.find((b) => b.key === matchKey);
    if (bucket && isStatus(doc.status)) {
      bucket.byStatus[doc.status] += 1;
      bucket.total += 1;
      if (doc.status === "approved" || doc.status === "delivered") {
        bucket.approvedValue = (bucket.approvedValue ?? 0) + grandTotalOf(doc);
      }
    }
  }

  // Pipeline array with visual percentages
  const pipeline = QUOTATION_STATUSES.map((status) => {
    const count = statusCounts[status];
    const percentage = totalQuotations > 0 ? Math.round((count / totalQuotations) * 100) : 0;
    return {
      status,
      label: PIPELINE_META[status].label,
      count,
      percentage,
      color: PIPELINE_META[status].color,
    };
  });

  // Recent quotations with actor resolution
  const recentWithActors = await attachQuotationActors(
    recentDocs.map((doc) => ({ ...doc, createdBy: doc.createdBy ?? null, assignedBy: doc.assignedBy ?? null }))
  );
  const recent: RecentQuotationRow[] = recentWithActors.map((doc) => {
    const dealerName = (doc as { dealer?: { name?: string | null } | null }).dealer?.name ?? null;
    const creatorName = doc.createdByUser?.name ?? null;
    return {
      id: String(doc._id),
      quotationNumber: doc.quotationNumber,
      clientName: doc.clientName,
      ownerName: dealerName ?? creatorName,
      ownerIsDealer: dealerName !== null,
      amount: grandTotalOf(doc),
      status: isStatus(doc.status) ? doc.status : "draft",
      createdAt: new Date(doc.createdAt).toISOString(),
    };
  });

  // Dealer performance breakdown
  const dealerMap: Record<
    number,
    {
      dealerId: number;
      name: string;
      email: string | null;
      totalQuotations: number;
      approvedQuotations: number;
      rejectedQuotations: number;
      approvedValue: number;
      earnings: number;
    }
  > = {};

  for (const dealer of dealersList) {
    const dId = Number(dealer.id ?? (dealer as any)._id);
    dealerMap[dId] = {
      dealerId: dId,
      name: dealer.name || `Dealer #${dId}`,
      email: dealer.email ?? null,
      totalQuotations: 0,
      approvedQuotations: 0,
      rejectedQuotations: 0,
      approvedValue: 0,
      earnings: 0,
    };
  }

  for (const doc of allDocs) {
    const dId = doc.dealerId ? Number(doc.dealerId) : null;
    if (dId && dealerMap[dId]) {
      dealerMap[dId].totalQuotations += 1;
      if (doc.status === "approved" || doc.status === "delivered") {
        dealerMap[dId].approvedQuotations += 1;
        dealerMap[dId].approvedValue += grandTotalOf(doc);
        dealerMap[dId].earnings += dealerEarningOf(doc);
      } else if (doc.status === "rejected") {
        dealerMap[dId].rejectedQuotations += 1;
      }
    }
  }

  const dealerRows: DealerPerformanceRow[] = Object.values(dealerMap)
    .filter((d) => d.totalQuotations > 0)
    .map((d) => {
      const decided = d.approvedQuotations + d.rejectedQuotations;
      const approvalRate = decided > 0 ? Math.round((d.approvedQuotations / decided) * 100) : 0;
      return {
        dealerId: d.dealerId,
        name: d.name,
        email: d.email,
        totalQuotations: d.totalQuotations,
        approvedQuotations: d.approvedQuotations,
        approvedValue: roundMoney(d.approvedValue),
        earnings: roundMoney(d.earnings),
        approvalRate,
      };
    })
    .sort((a, b) => b.approvedValue - a.approvedValue);

  // Delivery statistics
  const deliveryStatusCounts = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of deliveryStatusAgg) {
    if (row._id in deliveryStatusCounts) {
      deliveryStatusCounts[row._id as keyof typeof deliveryStatusCounts] = row.n;
    }
  }
  const completedDeliveries = deliveryTotal - deliveryStatusCounts.queued;
  const deliverySuccessRate = completedDeliveries > 0
    ? Math.round(((deliveryStatusCounts.delivered + deliveryStatusCounts.read) / completedDeliveries) * 100)
    : 0;

  const deliveries: DeliveryAnalyticsSummary = {
    total: deliveryTotal,
    byStatus: deliveryStatusCounts,
    successRate: deliverySuccessRate,
    retryCount: deliveryRetryCount,
    recent: recentDeliveriesDocs.map((doc) => ({
      id: String(doc._id),
      quotationId: String(doc.quotationId),
      recipient: doc.recipient,
      status: doc.status,
      createdAt: new Date(doc.createdAt).toISOString(),
    })),
  };

  // Comparative metrics
  const periodChangePercent =
    priorTotalQuotations > 0
      ? Math.round(((totalQuotations - priorTotalQuotations) / priorTotalQuotations) * 100)
      : null;

  const approvedValueChangePercent =
    priorApprovedValue > 0
      ? Math.round(((approvedValue - priorApprovedValue) / priorApprovedValue) * 100)
      : null;

  const decidedQuotations = statusCounts.approved + statusCounts.delivered + statusCounts.rejected;
  const approvalRate = decidedQuotations > 0
    ? Math.round(((statusCounts.approved + statusCounts.delivered) / decidedQuotations) * 100)
    : 0;

  const typeBreakdown = productsByType.map((row) => ({
    type: String(row._id || "other"),
    count: Number(row.count) || 0,
    percent: totalProducts > 0 ? Math.round(((Number(row.count) || 0) / totalProducts) * 100) : 0,
  }));

  // CRM Analytics computation (real tenant metrics by default, synthetic preview when demo requested)
  const isDemo = Boolean(options.includeDemo && isDemoModeAllowed());
  let crm: CrmAnalyticsData;

  if (isDemo) {
    crm = getDemoCrmAnalytics();
  } else {
    // Real CRM data calculation from MongoDB collections
    const totalLeads = leadsInPeriod.length;
    const newLeads = leadsInPeriod.filter((l) => l.status === "new").length;
    const activeOpportunities = activeOpportunitiesDocs.length;
    const pipelineValue = roundMoney(activeOpportunitiesDocs.reduce((sum, l) => sum + (Number(l.estimatedBudget) || 0), 0));
    const wonLeadsCount = wonLeadsDocs.length;
    const lostLeadsCount = leadsInPeriod.filter((l) => l.status === "lost").length;
    const decidedLeads = wonLeadsCount + lostLeadsCount;
    const leadToWonRate = decidedLeads > 0
      ? Math.round((wonLeadsCount / decidedLeads) * 100)
      : (totalLeads > 0 ? Math.round((wonLeadsCount / totalLeads) * 100) : 0);
    const leadToOpportunityRate = totalLeads > 0
      ? Math.round(((totalLeads - newLeads) / totalLeads) * 100)
      : 0;

    // Average sales cycle in days
    const wonDays = wonLeadsDocs
      .filter((l) => l.wonAt && l.createdAt)
      .map((l) => Math.max(1, Math.round((new Date(l.wonAt!).getTime() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24))));
    // 0 = no won deal to measure yet (the dashboard shows "—", never an invented figure).
    const avgSalesCycleDays = wonDays.length > 0
      ? Math.round(wonDays.reduce((a, b) => a + b, 0) / wonDays.length)
      : 0;

    // Opportunity Stages Breakdown
    const STAGE_CONFIG: Array<{ id: string; name: string; color: string }> = [
      { id: "new", name: "New Lead", color: "#3B82F6" },
      { id: "contacted", name: "Contacted", color: "#6366F1" },
      { id: "site_visit", name: "Site Visit", color: "#8B5CF6" },
      { id: "quoted", name: "Quoted", color: "#D97706" },
      { id: "negotiation", name: "Negotiation", color: "#EC4899" },
      { id: "won", name: "Closed Won", color: "#10B981" },
      { id: "lost", name: "Closed Lost", color: "#EF4444" },
    ];

    const stages = STAGE_CONFIG.map((stage) => {
      const matching = leadsInPeriod.filter((l) => l.status === stage.id);
      const count = matching.length;
      const val = roundMoney(matching.reduce((sum, l) => sum + (Number(l.estimatedBudget) || 0), 0));
      const percentage = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
      return {
        id: stage.id,
        name: stage.name,
        count,
        value: val,
        color: stage.color,
        percentage,
      };
    });

    const wonQuotationValue = new Map(wonConvertedDocs.map((d) => [String(d._id), grandTotalOf(d)]));
    const wonValueOf = (lead: { convertedQuotationId?: string | null; estimatedBudget?: number | null }): number => {
      const accepted = lead.convertedQuotationId ? wonQuotationValue.get(String(lead.convertedQuotationId)) : undefined;
      return accepted ?? (Number(lead.estimatedBudget) || 0);
    };

    // Lead Sources Breakdown
    const sourceMap = new Map<string, { count: number; wonCount: number; wonRevenue: number; opportunities: number }>();
    for (const lead of leadsInPeriod) {
      const srcName = lead.sourceName?.trim() || "Direct / Inquiries";
      const current = sourceMap.get(srcName) || { count: 0, wonCount: 0, wonRevenue: 0, opportunities: 0 };
      current.count += 1;
      if (lead.status === "won") {
        current.wonCount += 1;
        current.wonRevenue += wonValueOf(lead);
      } else if (["contacted", "site_visit", "quoted", "negotiation"].includes(lead.status)) {
        current.opportunities += 1;
      }
      sourceMap.set(srcName, current);
    }

    const sources = Array.from(sourceMap.entries()).map(([source, data]) => {
      const pct = totalLeads > 0 ? Math.round((data.count / totalLeads) * 100) : 0;
      const conv = data.count > 0 ? Math.round((data.wonCount / data.count) * 100) : 0;
      return {
        source,
        count: data.count,
        percentage: pct,
        wonRevenue: roundMoney(data.wonRevenue),
        opportunities: data.opportunities,
        wonCount: data.wonCount,
        conversionRate: conv,
      };
    }).sort((a, b) => b.count - a.count);

    // Salesperson Performance
    const salespeople = salesPersonnel.map((user) => {
      const uId = Number(user.id ?? (user as any)._id);
      const assignedLeads = leadsInPeriod.filter((l) => Number(l.assignedSalesId) === uId);
      const activeDeals = activeOpportunitiesDocs.filter((l) => Number(l.assignedSalesId) === uId);
      const quotesCreated = allPeriodDocs.filter((q) => Number(q.assignedSalesId) === uId || String(q.createdBy) === String(uId));
      const wonQuotes = approvedDocs.filter((q) => Number(q.assignedSalesId) === uId || String(q.createdBy) === String(uId));
      const wonRev = roundMoney(wonQuotes.reduce((sum, q) => sum + grandTotalOf(q), 0));
      const decidedCount = assignedLeads.filter((l) => l.status === "won" || l.status === "lost").length;
      const wonLeadsUser = assignedLeads.filter((l) => l.status === "won").length;
      const convRate = decidedCount > 0 ? Math.round((wonLeadsUser / decidedCount) * 100) : 0;

      const roleLabel =
        user.role === "company_owner"
          ? "Owner"
          : user.role === "sales_executive"
          ? "Sales Executive"
          : user.role === "configurable_admin"
          ? "Specialist"
          : "Admin";

      return {
        id: uId,
        name: user.name || ("User #" + uId),
        email: user.email || "",
        role: roleLabel,
        leadsAssigned: assignedLeads.length,
        opportunitiesActive: activeDeals.length,
        quotationsCreated: quotesCreated.length,
        wonQuotations: wonQuotes.length,
        wonRevenue: wonRev,
        conversionRate: convRate,
      };
    }).sort((a, b) => b.wonRevenue - a.wonRevenue || b.leadsAssigned - a.leadsAssigned);

    const decidedQuotationsCount = statusCounts.approved + statusCounts.delivered + statusCounts.rejected;
    const quoteWinRate = decidedQuotationsCount > 0
      ? Math.round(((statusCounts.approved + statusCounts.delivered) / decidedQuotationsCount) * 100)
      : 0;

    crm = {
      isDemo: false,
      summary: {
        totalLeads,
        newLeads,
        activeOpportunities,
        pipelineValue,
        leadToWonRate,
        leadToOpportunityRate,
        quotationWinRate: quoteWinRate,
        avgSalesCycleDays,
        wonRevenue: approvedValue,
        totalQuotationValue,
        averageQuotationValue: averageValue,
        pendingQuotationValue: pendingValue,
      },
      stages,
      sources,
      salespeople,
    };
  }

  const leadPeriodChangePercent =
    priorLeadsCount > 0
      ? Math.round(((leadsInPeriod.length - priorLeadsCount) / priorLeadsCount) * 100)
      : null;

  // Dealer categories are real data from this company's dealers and history, never demo values.
  const tierCompanyId = getTenantContext()?.companyId ?? null;
  let dealerTiers: DashboardData["dealerTiers"] = null;
  if (tierCompanyId !== null) {
    await reconcileCompanyDealerCategories(tierCompanyId);
    dealerTiers = await dealerTierAnalytics(tierCompanyId, range.start ?? new Date(0));
  }

  return {
    dateRange: {
      key: range.key,
      label: range.label,
      start: range.start ? range.start.toISOString() : null,
      end: range.end.toISOString(),
    },
    quotations: {
      total: totalQuotations,
      statusCounts,
      months: trendBuckets,
      trend: trendBuckets,
      thisMonth: totalQuotations,
      lastMonth: priorTotalQuotations,
      thisPeriod: totalQuotations,
      priorPeriod: priorTotalQuotations,
      periodChangePercent,
      approvedValueChangePercent,
      approvedValue,
      pendingValue,
      sentValue,
      draftValue,
      totalValue: totalQuotationValue,
      averageValue,
      approvalRate,
      confirmedDealerEarnings,
      recent,
    },
    leads: {
      total: leadsInPeriod.length,
      newLeads: leadsInPeriod.filter((l) => l.status === "new").length,
      thisPeriod: leadsInPeriod.length,
      priorPeriod: priorLeadsCount,
      periodChangePercent: leadPeriodChangePercent,
    },
    pipeline,
    dealers: {
      items: dealerRows,
      totalActiveDealers: dealersList.length,
    },
    deliveries,
    catalog: {
      totalProducts,
      activeProducts,
      inactiveProducts: totalProducts - activeProducts,
      matrixProducts,
      categoryCount,
      seriesCount,
      typeBreakdown,
    },
    crm,
    dealerTiers,
    isDemoMode: isDemo,
  };
}

/** What the person looking at the dashboard may see. Anything else is removed before the data leaves the server. */
export interface DashboardAccess {
  /** leads:read: leads, pipeline, sources, salesperson performance. */
  crm: boolean;
  /** quotations:read_all: company-wide quotation values, won revenue, recent quotations and deliveries. */
  sales: boolean;
  /** dealers:read: the dealer table, dealer earnings and categories. */
  dealers: boolean;
}

const EMPTY_CRM: CrmAnalyticsData = {
  isDemo: false,
  summary: { totalLeads: 0, newLeads: 0, activeOpportunities: 0, pipelineValue: 0, leadToWonRate: 0, leadToOpportunityRate: 0, quotationWinRate: 0, avgSalesCycleDays: 0, wonRevenue: 0, totalQuotationValue: 0, averageQuotationValue: 0, pendingQuotationValue: 0 },
  stages: [],
  sources: [],
  salespeople: [],
};

/**
 * Removes from the dashboard data what this person may not see, so it is never sent to their browser (hiding it on screen
 * is not enough). Company Owners and Admins see everything; a custom role sees the parts its permissions cover.
 */
export function redactDashboardData(data: DashboardData, access: DashboardAccess): DashboardData {
  const out: DashboardData = { ...data };
  if (!access.crm) {
    out.crm = data.crm?.isDemo ? data.crm : EMPTY_CRM;
    out.leads = undefined;
  }
  if (!access.sales) {
    out.quotations = {
      ...data.quotations,
      approvedValue: 0,
      pendingValue: 0,
      sentValue: 0,
      draftValue: 0,
      totalValue: 0,
      averageValue: 0,
      approvedValueChangePercent: null,
      confirmedDealerEarnings: 0,
      recent: [],
      months: data.quotations.months.map((bucket) => ({ ...bucket, approvedValue: 0 })),
      trend: data.quotations.trend.map((bucket) => ({ ...bucket, approvedValue: 0 })),
    };
    out.deliveries = { ...data.deliveries, recent: [] };
    if (out.crm && !out.crm.isDemo) {
      out.crm = {
        ...out.crm,
        summary: { ...out.crm.summary, wonRevenue: 0, totalQuotationValue: 0, averageQuotationValue: 0, pendingQuotationValue: 0 },
        sources: out.crm.sources.map((source) => ({ ...source, wonRevenue: 0 })),
        salespeople: out.crm.salespeople.map((person) => ({ ...person, wonRevenue: 0 })),
      };
    }
  }
  if (!access.dealers) {
    out.dealers = { items: [], totalActiveDealers: 0 };
    out.quotations = { ...out.quotations, confirmedDealerEarnings: 0 };
    out.dealerTiers = null;
  }
  return out;
}
