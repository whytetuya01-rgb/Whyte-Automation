import Link from "next/link";
import { BadgeCheck, Clock, FileText, Plus, Wallet } from "lucide-react";
import { connectMongoDB } from "@/lib/mongodb";
import { Category as CategoryModel, Product } from "@/models";
import { getAdminDashboardData } from "@/lib/adminDashboardData";
import { formatCurrency } from "@/lib/utils";
import { normalizeCategories, normalizeProducts } from "@/lib/quotationNormalization";
import type { Product as IProduct } from "@/types";
import DashboardCard from "@/components/admin/dashboard/DashboardCard";
import DashboardKpi from "@/components/admin/dashboard/DashboardKpi";
import QuotationTrendChart from "@/components/admin/dashboard/QuotationTrendChart";
import StatusSummary from "@/components/admin/dashboard/StatusSummary";
import RecentQuotations from "@/components/admin/dashboard/RecentQuotations";
import QuickActions from "@/components/admin/dashboard/QuickActions";
import CatalogSnapshot from "@/components/admin/dashboard/CatalogSnapshot";
import RecentProducts from "@/components/admin/dashboard/RecentProducts";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard. Presentation only: every figure comes from existing
 * collections and the application's existing calculations (see
 * `getAdminDashboardData`). Failures propagate to `error.tsx`, which offers a retry.
 *
 * Layout: one 12-column grid. On small screens items are re-ordered by
 * importance (KPIs, chart, recent quotations, status, catalog, quick actions)
 * instead of simply stacking the desktop order.
 */
export default async function DashboardPage() {
  await connectMongoDB();

  const [data, rawProducts, rawCategories] = await Promise.all([
    getAdminDashboardData(),
    Product.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({ path: "category", populate: { path: "parent" } })
      .populate({ path: "variants", options: { sort: { sortOrder: 1 } } }),
    CategoryModel.find().lean(),
  ]);

  const recentProducts: IProduct[] = normalizeProducts(rawProducts.map((doc) => doc.toObject()));
  const categories = normalizeCategories(rawCategories);
  // The product normaliser does not carry creation dates, so read them from the documents.
  const addedAtById: Record<number, string> = {};
  for (const doc of rawProducts) addedAtById[doc._id] = new Date(doc.createdAt).toISOString();

  const { quotations, catalog } = data;
  const approvedCount = quotations.statusCounts.approved + quotations.statusCounts.delivered;
  const decided = approvedCount + quotations.statusCounts.rejected;

  // Trends are shown only when they can be computed from real figures.
  const monthChange =
    quotations.lastMonth > 0
      ? Math.round(((quotations.thisMonth - quotations.lastMonth) / quotations.lastMonth) * 100)
      : null;

  return (
    <div className="space-y-5 max-w-full">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#111111] tracking-tight">Dashboard</h1>
          <p className="text-sm text-[#8A8A93] mt-0.5">Overview of your quotation activity and business performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/products"
            className="inline-flex items-center h-9 px-3.5 rounded-xl border border-[#E5E5E7] bg-white text-sm font-medium text-[#3F3F46] hover:border-[#F1B8C8] hover:text-[#B83E68] transition-colors"
          >
            Add Product
          </Link>
          <Link
            href="/quotation/new"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#111111] text-white text-sm font-medium hover:bg-[#1E1E22] transition-colors"
          >
            <Plus size={15} aria-hidden="true" />
            New Quotation
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        {/* KPIs: four across on desktop, two across on tablet, one on phones. */}
        <div className="col-span-12 order-1 lg:order-none grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <DashboardKpi
            label="Quotations"
            value={String(quotations.total)}
            icon={FileText}
            href="/admin/quotations"
            hint={`${quotations.thisMonth} created this month`}
            trend={
              monthChange === null
                ? undefined
                : { text: `${monthChange > 0 ? "+" : ""}${monthChange}% vs last month`, direction: monthChange > 0 ? "up" : monthChange < 0 ? "down" : "flat" }
            }
          />
          <DashboardKpi
            label="Pending Review"
            value={String(quotations.statusCounts.sent)}
            icon={Clock}
            href="/admin/quotations?status=sent"
            hint={quotations.statusCounts.draft > 0 ? `${quotations.statusCounts.draft} more in draft` : "Sent and awaiting approval"}
          />
          <DashboardKpi
            label="Approved Value"
            value={formatCurrency(quotations.approvedValue)}
            icon={BadgeCheck}
            href="/admin/quotations?status=approved"
            hint={`${approvedCount} approved or delivered`}
            trend={decided > 0 ? { text: `${Math.round((approvedCount / decided) * 100)}% approval rate`, direction: "flat" } : undefined}
          />
          <DashboardKpi
            label="Dealer Earnings"
            value={formatCurrency(quotations.confirmedDealerEarnings)}
            icon={Wallet}
            href="/admin/dealers"
            hint="Confirmed on approved quotations"
          />
        </div>

        <DashboardCard
          title="Quotation Performance"
          description="Quotations created per month, by status"
          action={{ href: "/admin/quotations", label: "View all" }}
          className="col-span-12 lg:col-span-8 order-2 lg:order-none"
        >
          <QuotationTrendChart months={quotations.months} />
        </DashboardCard>

        <DashboardCard
          title="Status Summary"
          description="All quotations by lifecycle stage"
          className="col-span-12 md:col-span-6 lg:col-span-4 order-4 lg:order-none"
        >
          <StatusSummary counts={quotations.statusCounts} total={quotations.total} />
        </DashboardCard>

        <DashboardCard
          title="Recent Quotations"
          action={{ href: "/admin/quotations", label: "View all" }}
          flush
          className="col-span-12 lg:col-span-8 order-3 lg:order-none"
        >
          <RecentQuotations rows={quotations.recent} />
        </DashboardCard>

        <div className="col-span-12 lg:col-span-4 order-5 lg:order-none grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4 lg:gap-5 content-start">
          <DashboardCard title="Quick Actions" className="order-2 md:order-none">
            <QuickActions />
          </DashboardCard>
          <DashboardCard
            title="Catalog"
            description={`${catalog.totalProducts} products · ${catalog.categoryCount} categories`}
            action={{ href: "/admin/products", label: "Manage" }}
            className="order-1 md:order-none"
          >
            <CatalogSnapshot catalog={catalog} />
          </DashboardCard>
        </div>

        <DashboardCard
          title="Recently Added Products"
          action={{ href: "/admin/products", label: "View all" }}
          flush
          className="col-span-12 order-6 lg:order-none"
        >
          <RecentProducts products={recentProducts} categories={categories} addedAtById={addedAtById} />
        </DashboardCard>
      </div>
    </div>
  );
}
