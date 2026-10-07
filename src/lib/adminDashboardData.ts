import { Category, Product, Quotation } from "@/models";
import { attachQuotationActors } from "@/lib/quotationActors";
import { getConfirmedEarningsTotal } from "@/lib/dealerEarningsService";
import { normalizeQuotation } from "@/lib/quotationNormalization";
import type { QuotationStatus } from "@/types";

/**
 * Read-only data for the admin dashboard. Everything here is derived from the
 * existing collections and the application's existing calculations
 * (`normalizeQuotation` for quotation totals, the dealer earnings service for
 * earnings). No business rule is implemented in this file.
 */

export const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "approved", "rejected", "delivered"];

export interface MonthBucket {
  /** "2026-10" */
  key: string;
  label: string;
  total: number;
  byStatus: Record<QuotationStatus, number>;
}

export interface RecentQuotationRow {
  id: string;
  quotationNumber: string;
  clientName: string;
  /** Assigned dealer, otherwise the creator; null when neither can be resolved. */
  ownerName: string | null;
  ownerIsDealer: boolean;
  amount: number;
  status: QuotationStatus;
  createdAt: string;
}

export interface DashboardData {
  quotations: {
    total: number;
    statusCounts: Record<QuotationStatus, number>;
    months: MonthBucket[];
    thisMonth: number;
    lastMonth: number;
    approvedValue: number;
    confirmedDealerEarnings: number;
    recent: RecentQuotationRow[];
  };
  catalog: {
    totalProducts: number;
    activeProducts: number;
    inactiveProducts: number;
    matrixProducts: number;
    categoryCount: number;
    seriesCount: number;
    typeBreakdown: Array<{ type: string; count: number; percent: number }>;
  };
}

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: BUSINESS_TIME_ZONE });

/** "YYYY-MM" of a date in the business time zone, matching the Mongo grouping below. */
function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: BUSINESS_TIME_ZONE }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function lastSixMonths(now: Date): Array<{ key: string; label: string; start: Date }> {
  const [year, month] = monthKey(now).split("-").map(Number);
  const months: Array<{ key: string; label: string; start: Date }> = [];
  for (let i = 5; i >= 0; i--) {
    const index = month - 1 - i;
    const y = year + Math.floor(index / 12);
    const m = ((index % 12) + 12) % 12;
    // Noon UTC on the 1st is the same calendar day in IST.
    const start = new Date(Date.UTC(y, m, 1, 12, 0, 0));
    months.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: MONTH_LABEL.format(start), start });
  }
  return months;
}

function emptyStatusMap(): Record<QuotationStatus, number> {
  return { draft: 0, sent: 0, approved: 0, rejected: 0, delivered: 0 };
}

function isStatus(value: unknown): value is QuotationStatus {
  return typeof value === "string" && (QUOTATION_STATUSES as string[]).includes(value);
}

const ROOMS_WITH_ITEMS = {
  path: "rooms",
  populate: { path: "items", select: "quantity unitPrice taxPercent priceWithoutTax taxAmount" },
} as const;

export async function getAdminDashboardData(): Promise<DashboardData> {
  const now = new Date();
  const months = lastSixMonths(now);
  const windowStart = new Date(months[0].start.getTime() - 24 * 60 * 60 * 1000);

  const [
    totalQuotations,
    statusAgg,
    monthAgg,
    approvedDocs,
    recentDocs,
    confirmedDealerEarnings,
    totalProducts,
    activeProducts,
    matrixProducts,
    categoryCount,
    seriesCount,
    productsByType,
  ] = await Promise.all([
    Quotation.countDocuments(),
    Quotation.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Quotation.aggregate<{ _id: { month: string; status: string }; n: number }>([
      { $match: { createdAt: { $gte: windowStart } } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: BUSINESS_TIME_ZONE } },
            status: "$status",
          },
          n: { $sum: 1 },
        },
      },
    ]),
    Quotation.find({ status: { $in: ["approved", "delivered"] } }).populate(ROOMS_WITH_ITEMS).lean({ virtuals: true }),
    Quotation.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .populate({ path: "dealer", select: "id name email firstName lastName" })
      .populate(ROOMS_WITH_ITEMS)
      .lean({ virtuals: true }),
    getConfirmedEarningsTotal(),
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isMatrix: true }),
    Category.countDocuments(),
    Category.countDocuments({ level: 1 }),
    Product.aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const statusCounts = emptyStatusMap();
  for (const row of statusAgg) if (isStatus(row._id)) statusCounts[row._id] = row.n;

  const buckets: MonthBucket[] = months.map((m) => ({ key: m.key, label: m.label, total: 0, byStatus: emptyStatusMap() }));
  for (const row of monthAgg) {
    const bucket = buckets.find((b) => b.key === row._id.month);
    if (!bucket || !isStatus(row._id.status)) continue;
    bucket.byStatus[row._id.status] += row.n;
    bucket.total += row.n;
  }

  // Quotation totals use the application's own normaliser (GST, discount, rooms), so
  // the dashboard can never disagree with the quotation screens.
  const grandTotalOf = (doc: unknown): number => {
    const normalised = normalizeQuotation(JSON.parse(JSON.stringify(doc)));
    const value = Number(normalised?.grandTotal ?? normalised?.totalAmount ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const approvedValue = approvedDocs.reduce((sum, doc) => sum + grandTotalOf(doc), 0);

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

  const currentKey = monthKey(now);
  const thisMonth = buckets.find((b) => b.key === currentKey)?.total ?? 0;
  const lastMonth = buckets.length >= 2 ? buckets[buckets.length - 2].total : 0;

  const typeBreakdown = productsByType.map((row) => ({
    type: String(row._id || "other"),
    count: Number(row.count) || 0,
    percent: totalProducts > 0 ? Math.round(((Number(row.count) || 0) / totalProducts) * 100) : 0,
  }));

  return {
    quotations: {
      total: totalQuotations,
      statusCounts,
      months: buckets,
      thisMonth,
      lastMonth,
      approvedValue,
      confirmedDealerEarnings,
      recent,
    },
    catalog: {
      totalProducts,
      activeProducts,
      inactiveProducts: totalProducts - activeProducts,
      matrixProducts,
      categoryCount,
      seriesCount,
      typeBreakdown,
    },
  };
}
