import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, Quotation, QuotationAuditEvent } from "@/models";
import { runUnscoped } from "@/lib/tenant/context";
import { getConfirmedEarningsTotal } from "@/lib/dealerEarningsService";
import { aggregateQuotationRoomTotals, deriveQuotationFinancials, totalsForQuotation } from "@/lib/quotationTotals";
import type { QuotationStatus } from "@/types";

export interface MonthBucket {
  key: string;
  label: string;
  total: number;
  approved: number;
}

export interface SuperAdminDashboardData {
  companies: {
    total: number;
    pendingReviewCount: number;
    approvedCount: number;
    rejectedCount: number;
    deactivatedCount: number;
    recentPending: Array<{
      id: number;
      name: string;
      email: string | null;
      phone: string;
      logoUrl: string | null;
      submittedAt: string | null;
      ownerName: string | null;
      ownerEmail: string | null;
    }>;
  };
  dealers: {
    total: number;
    active: number;
    inactive: number;
    totalEarnings: number;
    topDealers: Array<{
      id: number;
      name: string;
      companyName: string | null;
      email: string;
      discountAllocationPercent: number;
      accumulatedEarnings: number;
      quotationsCount: number;
      isActive: boolean;
    }>;
  };
  users: {
    total: number;
    active: number;
    inactive: number;
    byRole: {
      super_admin: number;
      company_owner: number;
      admin: number;
      dealer: number;
      sales_executive: number;
    };
  };
  quotations: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    approvedValue: number;
    statusCounts: Record<QuotationStatus, number>;
    months: MonthBucket[];
  };
  recentActivity: Array<{
    id: string;
    action: string;
    performedByName: string | null;
    performedOn: string;
    quotationNumber?: string;
    clientName?: string;
    description: string;
  }>;
}

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: BUSINESS_TIME_ZONE });

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
    const start = new Date(Date.UTC(y, m, 1, 12, 0, 0));
    months.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: MONTH_LABEL.format(start), start });
  }
  return months;
}

function formatAuditAction(action: string): string {
  switch (action) {
    case "quotation_created":
      return "Created quotation";
    case "quotation_assigned":
      return "Assigned quotation to dealer";
    case "quotation_reassigned":
      return "Reassigned quotation";
    case "quotation_unassigned":
      return "Unassigned quotation";
    case "quotation_cloned":
      return "Cloned quotation";
    case "status_changed":
      return "Updated quotation status";
    case "quotation_approved":
      return "Approved proposal";
    case "quotation_rejected":
      return "Rejected proposal";
    case "quotation_delivered":
      return "Marked quotation delivered";
    default:
      return action.replace(/_/g, " ");
  }
}

export async function getSuperAdminDashboardData(): Promise<SuperAdminDashboardData> {
  await connectMongoDB();

  return runUnscoped("platform-admin", async () => {
    const now = new Date();
    const months = lastSixMonths(now);
    const windowStart = new Date(months[0].start.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalCompanies,
      pendingReviewCount,
      approvedCompaniesCount,
      rejectedCompaniesCount,
      deactivatedCompaniesCount,
      pendingCompaniesDocs,
      dealersTotal,
      dealersActive,
      dealersInactive,
      userRolesAgg,
      totalUsersCount,
      activeUsersCount,
      totalQuotations,
      quotationStatusAgg,
      monthAgg,
      approvedDocs,
      dealerEarnings,
      recentAuditDocs,
      topDealersDocs,
    ] = await Promise.all([
      Company.countDocuments(),
      Company.countDocuments({ registrationStatus: "pending_review" }),
      Company.countDocuments({
        $or: [{ registrationStatus: "approved" }, { registrationStatus: null }, { registrationStatus: { $exists: false } }],
        status: { $ne: "suspended" },
      }),
      Company.countDocuments({ registrationStatus: "rejected" }),
      Company.countDocuments({ status: "suspended" }),
      Company.find({ registrationStatus: "pending_review" })
        .sort({ registrationSubmittedAt: -1, createdAt: -1 })
        .limit(5)
        .lean(),
      AdminUser.countDocuments({ role: "dealer" }),
      AdminUser.countDocuments({ role: "dealer", isActive: true }),
      AdminUser.countDocuments({ role: "dealer", isActive: false }),
      AdminUser.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      AdminUser.countDocuments(),
      AdminUser.countDocuments({ isActive: true }),
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
      Quotation.find({ status: { $in: ["approved", "delivered"] } }).lean({ virtuals: true }),
      getConfirmedEarningsTotal(),
      QuotationAuditEvent.find().sort({ performedOn: -1 }).limit(6).lean(),
      AdminUser.find({ role: "dealer" }).sort({ createdAt: -1 }).limit(4).lean(),
    ]);

    // Resolve owners for pending companies
    const pendingCompanyIds = pendingCompaniesDocs.map((c: any) => c._id);
    const companyOwners = pendingCompanyIds.length > 0
      ? await AdminUser.find({ companyId: { $in: pendingCompanyIds }, role: "company_owner" })
          .select("companyId name email")
          .lean()
      : [];
    const ownerByCompanyId = new Map(companyOwners.map((o: any) => [o.companyId, o]));

    const recentPending = pendingCompaniesDocs.map((doc: any) => {
      const owner = ownerByCompanyId.get(doc._id);
      return {
        id: doc._id,
        name: doc.name,
        email: doc.email || owner?.email || null,
        phone: doc.phone || "—",
        logoUrl: doc.logoUrl || null,
        submittedAt: doc.registrationSubmittedAt ? new Date(doc.registrationSubmittedAt).toISOString() : doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        ownerName: owner?.name || null,
        ownerEmail: owner?.email || null,
      };
    });

    // Quotation status counts
    const statusCounts: Record<QuotationStatus, number> = {
      draft: 0,
      sent: 0,
      approved: 0,
      rejected: 0,
      delivered: 0,
    };
    for (const row of quotationStatusAgg) {
      if (row._id in statusCounts) {
        statusCounts[row._id as QuotationStatus] = row.n;
      }
    }

    // Monthly buckets
    const buckets: MonthBucket[] = months.map((m) => ({
      key: m.key,
      label: m.label,
      total: 0,
      approved: 0,
    }));
    for (const row of monthAgg) {
      const bucket = buckets.find((b) => b.key === row._id.month);
      if (!bucket) continue;
      bucket.total += row.n;
      if (row._id.status === "approved" || row._id.status === "delivered") {
        bucket.approved += row.n;
      }
    }

    const currentKey = monthKey(now);
    const thisMonth = buckets.find((b) => b.key === currentKey)?.total ?? 0;
    const lastMonth = buckets.length >= 2 ? buckets[buckets.length - 2].total : 0;

    // Approved Value Calculation
    const approvedSubtotalIds = approvedDocs.map((d: any) => String(d._id));
    const aggregatedTotals = approvedSubtotalIds.length > 0
      ? await aggregateQuotationRoomTotals(approvedSubtotalIds)
      : new Map();

    const approvedValue = approvedDocs.reduce((sum: number, doc: any) => {
      const { subtotal } = totalsForQuotation(aggregatedTotals, String(doc._id));
      const financials = deriveQuotationFinancials({
        subtotal,
        discountType: doc.discountType as string | null | undefined,
        discountValue: doc.discountValue,
        customerDiscountPercent: doc.customerDiscountPercent,
        allocatedDiscountPercent: doc.allocatedDiscountPercent,
      });
      return sum + financials.grandTotal;
    }, 0);

    // Users by role
    const byRole = {
      super_admin: 0,
      company_owner: 0,
      admin: 0,
      dealer: 0,
      sales_executive: 0,
    };
    for (const row of userRolesAgg) {
      if (row._id in byRole) {
        byRole[row._id as keyof typeof byRole] = row.count;
      }
    }

    // Top dealers with their quotation stats
    const topDealerIds = topDealersDocs.map((d: any) => d._id);
    const dealerQuotationStats = topDealerIds.length > 0
      ? await Quotation.aggregate([
          { $match: { dealerId: { $in: topDealerIds } } },
          { $group: { _id: "$dealerId", total: { $sum: 1 }, earnings: { $sum: { $cond: [{ $in: ["$status", ["approved", "delivered"]] }, { $toDouble: "$estimatedEarningAmount" }, 0] } } } },
        ])
      : [];
    const dealerStatsMap = new Map(dealerQuotationStats.map((s: any) => [s._id, s]));

    const topDealers = topDealersDocs.map((d: any) => {
      const stats = dealerStatsMap.get(d._id);
      return {
        id: d._id,
        name: d.name || "Dealer",
        companyName: d.companyName || null,
        email: d.email,
        discountAllocationPercent: d.discountAllocationPercent || 0,
        accumulatedEarnings: Math.round(Number(stats?.earnings || 0) * 100) / 100,
        quotationsCount: stats?.total || 0,
        isActive: d.isActive ?? true,
      };
    });

    // Format audit activity
    const recentActivity = recentAuditDocs.map((event: any) => ({
      id: String(event._id),
      action: event.action,
      performedByName: event.performedByName || "System",
      performedOn: new Date(event.performedOn).toISOString(),
      quotationNumber: event.metadata?.quotationNumber || event.quotationId,
      description: formatAuditAction(event.action),
    }));

    return {
      companies: {
        total: totalCompanies,
        pendingReviewCount,
        approvedCount: approvedCompaniesCount,
        rejectedCount: rejectedCompaniesCount,
        deactivatedCount: deactivatedCompaniesCount,
        recentPending,
      },
      dealers: {
        total: dealersTotal,
        active: dealersActive,
        inactive: dealersInactive,
        totalEarnings: dealerEarnings,
        topDealers,
      },
      users: {
        total: totalUsersCount,
        active: activeUsersCount,
        inactive: totalUsersCount - activeUsersCount,
        byRole,
      },
      quotations: {
        total: totalQuotations,
        thisMonth,
        lastMonth,
        approvedValue,
        statusCounts,
        months: buckets,
      },
      recentActivity,
    };
  });
}
