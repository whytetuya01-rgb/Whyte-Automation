import Link from "next/link";
import { BadgeCheck, Clock, FileText, LayoutDashboard, Plus, Wallet, Building2, ArrowRight } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { connectMongoDB } from "@/lib/mongodb";
import { Category as CategoryModel, Company, Product } from "@/models";
import { getAdminDashboardData, type DateRangeKey } from "@/lib/adminDashboardData";
import { getSuperAdminDashboardData } from "@/lib/superAdminDashboardData";
import { getAuthenticatedActor } from "@/lib/api-auth";
import { withTenant } from "@/lib/tenant/context";
import { formatCurrency } from "@/lib/utils";
import { normalizeCategories, normalizeProducts } from "@/lib/quotationNormalization";
import { hasPermission } from "@/lib/permissions";
import { getDemoCrmAnalytics, isDemoModeAllowed } from "@/lib/dashboard/demoData";
import type { Product as IProduct } from "@/types";
import DashboardCard from "@/components/admin/dashboard/DashboardCard";
import DashboardKpi from "@/components/admin/dashboard/DashboardKpi";
import StatusSummary from "@/components/admin/dashboard/StatusSummary";
import RecentQuotations from "@/components/admin/dashboard/RecentQuotations";
import QuickActions from "@/components/admin/dashboard/QuickActions";
import CatalogSnapshot from "@/components/admin/dashboard/CatalogSnapshot";
import RecentProducts from "@/components/admin/dashboard/RecentProducts";
import SuperAdminDashboard from "@/components/admin/dashboard/SuperAdminDashboard";
import SetupGuide from "@/components/admin/dashboard/SetupGuide";
import DashboardHeader from "@/components/admin/dashboard/DashboardHeader";
import RevenueTrendChart from "@/components/admin/dashboard/RevenueTrendChart";
import DealerPerformanceTable from "@/components/admin/dashboard/DealerPerformanceTable";
import DeliveryAnalyticsCard from "@/components/admin/dashboard/DeliveryAnalyticsCard";
import CrmAnalyticsPreview from "@/components/admin/dashboard/CrmAnalyticsPreview";
import { getOnboardingState } from "@/lib/companyOnboarding";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams?: Promise<{
    range?: string;
    demo?: string;
    tab?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const actor = await getAuthenticatedActor();
  await connectMongoDB();

  const resolvedParams = searchParams ? await searchParams : {};
  const rawRange = resolvedParams.range as DateRangeKey | undefined;
  const dateRange: DateRangeKey =
    rawRange && ["7d", "30d", "90d", "1y", "all"].includes(rawRange) ? rawRange : "30d";
  const canEnableDemo = isDemoModeAllowed();
  const includeDemo = Boolean((resolvedParams.demo === "1" || resolvedParams.demo === "true") && canEnableDemo);
  const activeTab: "platform" | "business" | "crm" =
    (resolvedParams.tab as "platform" | "business" | "crm") || (includeDemo ? "crm" : "platform");

  const isSuperAdmin = actor.role === "super_admin";
  const hasActiveCompany = actor.companyId !== null;

  // Resolve current company name for header
  let companyName: string | null = null;
  if (actor.companyId) {
    const compDoc = await Company.findById(actor.companyId).select("name").lean();
    companyName = compDoc?.name ?? null;
  }

  // Super Admin platform telemetry (only loaded for super_admin)
  const superAdminData = isSuperAdmin ? await getSuperAdminDashboardData() : null;

  // Permission guards
  const canViewDealers = hasPermission(actor.role, actor.permissions, "dealers:read");

  // Fetch tenant-scoped operational data ONLY if a trusted company context exists
  let data = null;
  let rawProducts: any[] = [];
  let rawCategories: any[] = [];
  let onboarding = null;

  if (hasActiveCompany) {
    [data, rawProducts, rawCategories, onboarding] = await withTenant(actor, () =>
      Promise.all([
        getAdminDashboardData({ dateRange, includeDemo }),
        Product.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate({ path: "category", populate: { path: "parent" } })
          .populate({ path: "variants", options: { sort: { sortOrder: 1 } } }),
        CategoryModel.find().lean(),
        actor.companyId ? getOnboardingState(actor.companyId as number) : null,
      ])
    );
  }

  // If Super Admin has no active company context, show platform overview or clear prompt
  if (isSuperAdmin && !hasActiveCompany) {
    const unselectedViewContent = (
      <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-gray-200/80 shadow-2xs space-y-4 max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
          <Building2 size={24} />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-gray-950">Select a Company to View Analytics</h3>
          <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
            You are currently in <strong>Platform Governance Mode</strong>. Multi-tenant business metrics, quotation values, and dealer performance are strictly company-isolated.
          </p>
          <p className="text-xs text-gray-400">
            To inspect a specific tenant&apos;s workspace, navigate to Company Management and select <strong>&quot;Act As Company&quot;</strong>.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/admin/companies"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black transition-colors"
          >
            <span>Open Company Directory</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    );

    return (
      <SuperAdminDashboard
        data={superAdminData!}
        adminViewContent={unselectedViewContent}
        crmData={includeDemo ? getDemoCrmAnalytics() : null}
        canEnableDemo={canEnableDemo}
        initialTab={activeTab}
      />
    );
  }

  // Active Company Data is available
  if (!data) {
    return null;
  }

  const showSetupGuide = Boolean(onboarding && !onboarding.dismissed && onboarding.completed < onboarding.total);
  const recentProducts: IProduct[] = normalizeProducts(rawProducts.map((doc) => doc.toObject()));
  const categories = normalizeCategories(rawCategories);
  const addedAtById: Record<number, string> = {};
  for (const doc of rawProducts) addedAtById[doc._id] = new Date(doc.createdAt).toISOString();

  const { quotations, pipeline, dealers, deliveries, catalog, crm, isDemoMode } = data;
  const approvedCount = quotations.statusCounts.approved + quotations.statusCounts.delivered;

  // The complete Business Dashboard view
  const adminViewContent = (
    <div className="space-y-6">
      {/* Interactive Controls Header */}
      <DashboardHeader
        currentRange={dateRange}
        companyName={companyName}
        actingAsCompany={actor.actingAsCompany}
        isSuperAdmin={isSuperAdmin}
        isDemoMode={isDemoMode}
        canEnableDemo={canEnableDemo}
      />

      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        {showSetupGuide && onboarding && (
          <div className="col-span-12 order-first lg:order-none">
            <SetupGuide state={onboarding} />
          </div>
        )}

        {/* Top KPI Cards: 4 metrics with real comparisons */}
        <div className="col-span-12 order-1 lg:order-none grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <DashboardKpi
            label="Total Quotations"
            value={String(quotations.total)}
            icon={FileText}
            href="/admin/quotations"
            hint={`${quotations.thisPeriod} created in ${data.dateRange.label}`}
            trend={
              quotations.periodChangePercent !== null
                ? {
                    text: `${quotations.periodChangePercent > 0 ? "+" : ""}${quotations.periodChangePercent}% vs prior period`,
                    direction: quotations.periodChangePercent > 0 ? "up" : quotations.periodChangePercent < 0 ? "down" : "flat",
                  }
                : undefined
            }
          />

          <DashboardKpi
            label="Pending Value"
            value={formatCurrency(quotations.pendingValue)}
            icon={Clock}
            href="/admin/quotations?status=sent"
            hint={`${quotations.statusCounts.sent} awaiting decision · ${quotations.statusCounts.draft} draft`}
          />

          <DashboardKpi
            label="Won Revenue"
            value={formatCurrency(quotations.approvedValue)}
            icon={BadgeCheck}
            href="/admin/quotations?status=approved"
            hint={`${approvedCount} approved · ${quotations.approvalRate}% win rate`}
            trend={
              quotations.approvedValueChangePercent !== null
                ? {
                    text: `${quotations.approvedValueChangePercent > 0 ? "+" : ""}${quotations.approvedValueChangePercent}% revenue`,
                    direction: quotations.approvedValueChangePercent > 0 ? "up" : quotations.approvedValueChangePercent < 0 ? "down" : "flat",
                  }
                : undefined
            }
          />

          {canViewDealers ? (
            <DashboardKpi
              label="Dealer Earnings"
              value={formatCurrency(quotations.confirmedDealerEarnings)}
              icon={Wallet}
              href="/admin/dealers"
              hint="Confirmed across approved deals"
            />
          ) : (
            <DashboardKpi
              label="Delivery Success"
              value={`${deliveries.successRate}%`}
              icon={BadgeCheck}
              href="/admin/quotations"
              hint={`${deliveries.total} total dispatched`}
            />
          )}
        </div>

        {/* Row 1: Revenue Trend Chart + Pipeline Status Summary */}
        <DashboardCard
          title="Revenue & Volume Performance"
          description={`Quotations & won revenue trend over ${data.dateRange.label.toLowerCase()}`}
          action={{ href: "/admin/quotations", label: "View all" }}
          className="col-span-12 lg:col-span-8 order-2 lg:order-none"
        >
          <RevenueTrendChart trend={quotations.trend} />
        </DashboardCard>

        <DashboardCard
          title="Quotation Pipeline"
          description="Distribution across current lifecycle stages"
          className="col-span-12 md:col-span-6 lg:col-span-4 order-3 lg:order-none"
        >
          <StatusSummary counts={quotations.statusCounts} total={quotations.total} />
        </DashboardCard>

        {/* Row 2: CRM Analytics (Elevated to prominent position above tables) */}
        <div className="col-span-12 order-4 lg:order-none">
          <CrmAnalyticsPreview crm={crm} canEnableDemo={canEnableDemo} />
        </div>

        {/* Row 3: Dealer Performance Leaderboard + Delivery Analytics */}
        {canViewDealers && (
          <DashboardCard
            title="Partner Dealer Leaderboard"
            description="Performance, won revenue & confirmed earnings by dealer"
            action={{ href: "/admin/dealers", label: "Manage dealers" }}
            flush
            className="col-span-12 lg:col-span-7 order-5 lg:order-none"
          >
            <DealerPerformanceTable
              dealers={dealers.items}
              totalActiveDealers={dealers.totalActiveDealers}
              canViewEarnings={canViewDealers}
            />
          </DashboardCard>
        )}

        <DashboardCard
          title="Proposal Delivery Health"
          description="Verified email dispatches, delivery confirmations & opens"
          className={`col-span-12 ${canViewDealers ? "lg:col-span-5" : "lg:col-span-12"} order-6 lg:order-none`}
        >
          <DeliveryAnalyticsCard deliveries={deliveries} />
        </DashboardCard>

        {/* Row 4: Recent Quotations Table + Catalog Summary */}
        <DashboardCard
          title="Recent Quotations"
          description="Latest proposal records within active tenant scope"
          action={{ href: "/admin/quotations", label: "View all" }}
          flush
          className="col-span-12 lg:col-span-8 order-7 lg:order-none"
        >
          <RecentQuotations rows={quotations.recent} />
        </DashboardCard>

        <div className="col-span-12 lg:col-span-4 order-8 lg:order-none grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4 lg:gap-5 content-start">
          <DashboardCard title="Quick Actions">
            <QuickActions />
          </DashboardCard>

          <DashboardCard
            title="Catalog Snapshot"
            description={`${catalog.totalProducts} products · ${catalog.categoryCount} categories`}
            action={{ href: "/admin/products", label: "Manage" }}
          >
            <CatalogSnapshot catalog={catalog} />
          </DashboardCard>
        </div>

        {/* Row 5: Recently Added Products */}
        <DashboardCard
          title="Recently Added Products"
          action={{ href: "/admin/products", label: "View all" }}
          flush
          className="col-span-12 order-9 lg:order-none"
        >
          <RecentProducts products={recentProducts} categories={categories} addedAtById={addedAtById} />
        </DashboardCard>
      </div>
    </div>
  );

  // If Super Admin is acting as a company, wrap in SuperAdminDashboard tab view
  if (isSuperAdmin && superAdminData) {
    return (
      <SuperAdminDashboard
        data={superAdminData}
        adminViewContent={adminViewContent}
        crmData={crm}
        canEnableDemo={canEnableDemo}
        initialTab={activeTab}
      />
    );
  }

  // Standard Company Admin Dashboard View
  return (
    <div className="space-y-5 max-w-full">
      {adminViewContent}
    </div>
  );
}
