"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  FolderTree,
  Layers as LayersIcon,
  LayoutDashboard,
  Package,
  Percent,
  Sparkles,
  Store,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { DashboardAccess, DashboardData, DateRangeKey } from "@/lib/adminDashboardData";
import type { Product as IProduct } from "@/types";
import { getDemoCrmAnalytics } from "@/lib/dashboard/demoData";
import { STATUS_ORDER, STATUS_STYLE } from "@/components/admin/dashboard/statusStyle";

import DealerTierSummary from "@/components/admin/dashboard/DealerTierSummary";
import QuickActions from "@/components/admin/dashboard/QuickActions";
import CatalogSnapshot from "@/components/admin/dashboard/CatalogSnapshot";
import RecentProducts from "@/components/admin/dashboard/RecentProducts";
import SetupGuide from "@/components/admin/dashboard/SetupGuide";
import HeroBand, { type HeroStat } from "@/components/admin/dashboard/premium/HeroBand";
import PremiumTabs, { type PremiumTabItem } from "@/components/admin/dashboard/premium/PremiumTabs";
import { PremiumKpi, PremiumPanel, type Trend } from "@/components/admin/dashboard/premium/PremiumCards";
import { BarList, StatusDonut, TrendChart } from "@/components/admin/dashboard/premium/charts";
import { DealerLeaderboard, DeliveryHealth, RecentQuotationList, SalespersonLeaderboard, StageFunnel } from "@/components/admin/dashboard/premium/PremiumLists";
import { compactINR, percent } from "@/components/admin/dashboard/premium/format";
import { panelVariants } from "@/components/admin/dashboard/premium/motion";

export type DashboardTabKey = "overview" | "crm" | "sales" | "dealers" | "catalog";

interface DashboardTabsLayoutProps {
  data: DashboardData;
  recentProducts: IProduct[];
  categories: any[];
  addedAtById: Record<number, string>;
  companyName: string | null;
  actingAsCompany: boolean;
  isSuperAdmin: boolean;
  canEnableDemo: boolean;
  canViewDealers: boolean;
  /** What this person may see; the server has already removed the rest from `data`. Absent = everything. */
  access?: DashboardAccess;
  showSetupGuide: boolean;
  onboarding: any;
  initialTab?: string;
  dateRange: DateRangeKey;
}

const VALID_TABS: DashboardTabKey[] = ["overview", "crm", "sales", "dealers", "catalog"];

/** A change in percent as the up / down / flat pill, or nothing when there is nothing to compare with. */
function changeTrend(change: number | null | undefined, suffix: string): Trend | undefined {
  if (change === null || change === undefined) return undefined;
  return { text: `${change > 0 ? "+" : ""}${change}% ${suffix}`, direction: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

export default function DashboardTabsLayout({
  data,
  recentProducts,
  categories,
  addedAtById,
  companyName,
  actingAsCompany,
  isSuperAdmin,
  canEnableDemo,
  canViewDealers,
  access = { crm: true, sales: true, dealers: true },
  showSetupGuide,
  onboarding,
  initialTab,
  dateRange,
}: DashboardTabsLayoutProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramTab = searchParams.get("tab") as DashboardTabKey | null;
  const resolvedInitialTab: DashboardTabKey =
    paramTab && VALID_TABS.includes(paramTab) ? paramTab : initialTab && VALID_TABS.includes(initialTab as DashboardTabKey) ? (initialTab as DashboardTabKey) : "overview";
  const [activeTab, setActiveTab] = useState<DashboardTabKey>(resolvedInitialTab);

  const handleTabChange = (key: DashboardTabKey) => {
    setActiveTab(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const { quotations, dealers, deliveries, catalog, crm, dealerTiers, isDemoMode } = data;
  const approvedCount = quotations.statusCounts.approved + quotations.statusCounts.delivered;
  const crmData = crm || getDemoCrmAnalytics();
  const totalValue = quotations.totalValue ?? quotations.approvedValue + quotations.pendingValue;
  const rupees = (n: number) => formatCurrency(Math.round(n));

  // The last few months as small trend lines on the KPI cards.
  const volumeSeries = quotations.trend.map((m) => m.total);
  const revenueSeries = quotations.trend.map((m) => m.approvedValue ?? 0);
  const trendPoints = quotations.trend.map((m) => ({ label: m.label, count: m.total, value: m.approvedValue ?? 0 }));

  const heroStats: HeroStat[] = [
    ...(access.sales ? [{ label: "Won revenue", value: quotations.approvedValue, format: compactINR, trend: changeTrend(quotations.approvedValueChangePercent, "vs prior"), hint: `${approvedCount} closed deals` }] : []),
    ...(access.crm ? [{ label: "Active pipeline", value: crmData.summary.pipelineValue, format: compactINR, hint: `${crmData.summary.activeOpportunities} open deals` }] : []),
    ...(access.sales ? [{ label: "Quotation value", value: totalValue, format: compactINR, trend: changeTrend(quotations.periodChangePercent, "volume"), hint: `${quotations.total} quotes` }] : []),
    ...(access.crm ? [{ label: "Lead-to-won", value: crmData.summary.leadToWonRate, format: (n: number) => percent(n), hint: `${quotations.approvalRate}% quote win rate` }] : []),
  ];

  const TAB_ITEMS: Array<PremiumTabItem<DashboardTabKey> & { visible?: boolean }> = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "crm", label: "CRM & Pipeline", icon: Users, badge: crmData.summary.activeOpportunities > 0 ? `${crmData.summary.activeOpportunities} deals` : undefined, visible: access.crm },
    { key: "sales", label: "Quotations & Sales", icon: FileText, badge: `${quotations.total} quotes`, visible: access.sales },
    { key: "dealers", label: "Dealers & Partners", icon: Store, badge: dealers.totalActiveDealers > 0 ? `${dealers.totalActiveDealers} active` : undefined, visible: canViewDealers && access.dealers },
    { key: "catalog", label: "Catalog & Inventory", icon: Package, badge: `${catalog.totalProducts} items` },
  ];

  const visibleTabs = TAB_ITEMS.filter((t) => t.visible !== false);
  // A tab this person may not see (an old link, a shared URL) opens the overview instead.
  const shownTab: DashboardTabKey = visibleTabs.some((t) => t.key === activeTab) ? activeTab : "overview";

  const statusSegments = STATUS_ORDER.map((status) => ({
    key: status,
    label: STATUS_STYLE[status].label,
    count: quotations.statusCounts[status] ?? 0,
    color: STATUS_STYLE[status].color,
    sub: status === "approved" ? `${formatCurrency(quotations.approvedValue)} won` : undefined,
  }));

  const sourceRows = [...crmData.sources]
    .sort((a, b) => b.count - a.count)
    .map((source) => ({
      key: source.source,
      label: source.source,
      value: source.count,
      display: `${source.count} leads · ${compactINR(source.wonRevenue)}`,
      sub: source.conversionRate !== undefined ? `${source.conversionRate}% convert to won` : undefined,
    }));

  const typeRows = catalog.typeBreakdown.map((row) => ({
    key: row.type,
    label: row.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    value: row.count,
    display: `${row.count} · ${Math.round(row.percent)}%`,
  }));

  const panel = (key: DashboardTabKey, children: React.ReactNode) => (
    <motion.div key={key} id={`dash-panel-${key}`} role="tabpanel" aria-labelledby={`dash-tab-${key}`} variants={panelVariants} initial="hidden" animate="show" exit="exit" className="space-y-4 lg:space-y-5">
      {children}
    </motion.div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="max-w-full space-y-5" data-own-motion="">
        <HeroBand companyName={companyName} actingAsCompany={actingAsCompany} isSuperAdmin={isSuperAdmin} isDemoMode={isDemoMode} canEnableDemo={canEnableDemo} dateRange={dateRange} rangeLabel={data.dateRange.label} stats={heroStats} />

        {crmData.isDemo && (
          <p className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900" data-testid="sample-data-note">
            <Sparkles size={13} aria-hidden="true" />
            Lead, pipeline and salesperson figures are sample data until your first leads are in.
          </p>
        )}

        <PremiumTabs items={visibleTabs} active={shownTab} onChange={handleTabChange} />

        <AnimatePresence mode="wait" initial={false}>
          {shownTab === "overview" &&
            panel(
              "overview",
              <>
                {showSetupGuide && onboarding && <SetupGuide state={onboarding} />}

                {(access.crm || access.sales) && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 lg:gap-5">
                  {access.crm && <PremiumKpi label="Total leads" value={crmData.summary.totalLeads} icon={Users} onClick={() => handleTabChange("crm")} hint={`${crmData.summary.newLeads ?? 0} new · ${crmData.summary.leadToOpportunityRate ?? 0}% qualified`} trend={changeTrend(data.leads?.periodChangePercent, "vs prior")} accent="#3B82F6" />}
                  {access.crm && <PremiumKpi label="Opportunities" value={crmData.summary.activeOpportunities} format={(n) => `${Math.round(n)} active`} icon={LayersIcon} onClick={() => handleTabChange("crm")} hint={`${compactINR(crmData.summary.pipelineValue)} in the pipeline`} badge="In pipeline" accent="#8B5CF6" />}
                  {access.sales && <PremiumKpi label="Quotation values" value={totalValue} format={compactINR} icon={FileText} onClick={() => handleTabChange("sales")} hint={`${quotations.total} quotes · ${compactINR(quotations.pendingValue)} pending`} trend={changeTrend(quotations.periodChangePercent, "volume")} series={volumeSeries} accent="#0EA5E9" />}
                  {access.sales && <PremiumKpi label="Won revenue" value={quotations.approvedValue} format={compactINR} icon={BadgeCheck} onClick={() => handleTabChange("sales")} hint={`${approvedCount} closed deals · ${quotations.approvalRate}% win rate`} trend={changeTrend(quotations.approvedValueChangePercent, "revenue")} series={revenueSeries} accent="#10B981" />}
                  {access.crm && <PremiumKpi className="col-span-2 xl:col-span-1" label="Conversion rate" value={crmData.summary.leadToWonRate} format={(n) => percent(n)} icon={Percent} onClick={() => handleTabChange("crm")} hint={`Lead-to-won · ${quotations.approvalRate}% quote win rate`} badge="Velocity" />}
                </div>
                )}

                <div className="grid grid-cols-12 gap-4 lg:gap-5">
                  {access.sales && (
                  <PremiumPanel title="Revenue & volume" description={`Won revenue and quotations over ${data.dateRange.label.toLowerCase()}`} action={{ href: "/admin/quotations", label: "View all" }} className={`col-span-12 ${access.crm ? "xl:col-span-8" : ""}`}>
                    <TrendChart points={trendPoints} />
                  </PremiumPanel>
                  )}
                  {access.crm && (
                  <PremiumPanel title="Opportunity funnel" description="Deals across the pipeline stages" action={{ href: "/admin/crm/pipeline", label: "Open pipeline" }} className={`col-span-12 ${access.sales ? "xl:col-span-4" : ""}`}>
                    <StageFunnel stages={crmData.stages} pipelineValue={crmData.summary.pipelineValue} />
                  </PremiumPanel>
                  )}
                  {access.sales && (
                  <PremiumPanel title="Recent quotations" description="The latest proposals in your workspace" action={{ href: "/admin/quotations", label: "View all" }} flush className="col-span-12 xl:col-span-8">
                    <RecentQuotationList rows={quotations.recent} />
                  </PremiumPanel>
                  )}
                  <div className={`col-span-12 grid content-start gap-4 lg:gap-5 ${access.sales ? "md:grid-cols-2 xl:col-span-4 xl:grid-cols-1" : "md:grid-cols-2"}`}>
                    <PremiumPanel title="Quick actions">
                      <QuickActions />
                    </PremiumPanel>
                    <PremiumPanel title="Catalogue snapshot" description={`${catalog.totalProducts} products · ${catalog.categoryCount} categories`} action={{ href: "/admin/products", label: "Manage" }}>
                      <CatalogSnapshot catalog={catalog} maxTypes={3} />
                    </PremiumPanel>
                  </div>
                </div>
              </>
            )}

          {shownTab === "crm" &&
            panel(
              "crm",
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 lg:gap-5">
                  <PremiumKpi label="Inbound leads" value={crmData.summary.totalLeads} icon={Users} href="/admin/crm/leads" hint={`${crmData.summary.newLeads ?? 0} new in this period`} trend={changeTrend(data.leads?.periodChangePercent, "vs prior")} accent="#3B82F6" />
                  <PremiumKpi label="Active deals" value={crmData.summary.activeOpportunities} icon={LayersIcon} href="/admin/crm/pipeline" hint={`${compactINR(crmData.summary.pipelineValue)} estimated value`} badge="In pipeline" accent="#8B5CF6" />
                  <PremiumKpi label="Lead-to-won" value={crmData.summary.leadToWonRate} format={(n) => percent(n)} icon={Percent} href="/admin/crm/pipeline" hint={`${crmData.summary.leadToOpportunityRate ?? 0}% become opportunities`} badge="Win rate" accent="#10B981" />
                  <PremiumKpi label="Average sales cycle" value={crmData.summary.avgSalesCycleDays} format={(n) => (crmData.summary.avgSalesCycleDays > 0 ? `${Math.round(n)} days` : "—")} icon={Timer} href="/admin/crm/pipeline" hint={crmData.summary.avgSalesCycleDays > 0 ? "From enquiry to closed won" : "Shown once a deal is won"} badge="Velocity" accent="#F59E0B" />
                </div>
                <div className="grid grid-cols-12 gap-4 lg:gap-5">
                  <PremiumPanel title="Opportunity funnel" description="Deals across the pipeline stages" action={{ href: "/admin/crm/pipeline", label: "Open pipeline" }} className="col-span-12 lg:col-span-6">
                    <StageFunnel stages={crmData.stages} pipelineValue={crmData.summary.pipelineValue} />
                  </PremiumPanel>
                  <PremiumPanel title="Lead sources" description="Where enquiries come from and what they earn" action={{ href: "/admin/crm/sources", label: "Manage sources" }} className="col-span-12 lg:col-span-6">
                    <BarList rows={sourceRows} emptyText="Lead sources appear here once leads are captured." />
                  </PremiumPanel>
                  <PremiumPanel title="Salesperson leaderboard" description="Won revenue, conversion and target by sales representative" action={{ href: "/admin/crm/leads", label: "Assign leads" }} flush className="col-span-12">
                    <SalespersonLeaderboard people={crmData.salespeople} isDemo={crmData.isDemo} />
                  </PremiumPanel>
                </div>
              </>
            )}

          {shownTab === "sales" &&
            panel(
              "sales",
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 lg:gap-5">
                  <PremiumKpi label="Total quotation value" value={totalValue} format={rupees} icon={FileText} href="/admin/quotations" hint={`${quotations.total} quotations created`} trend={changeTrend(quotations.periodChangePercent, "volume")} series={volumeSeries} accent="#0EA5E9" />
                  <PremiumKpi label="Won revenue" value={quotations.approvedValue} format={rupees} icon={BadgeCheck} href="/admin/quotations?status=approved" hint={`${approvedCount} closed deals · ${quotations.approvalRate}% win rate`} trend={changeTrend(quotations.approvedValueChangePercent, "revenue")} series={revenueSeries} accent="#10B981" />
                  <PremiumKpi label="Pending proposals" value={quotations.pendingValue} format={rupees} icon={Clock} href="/admin/quotations?status=sent" hint={`${quotations.statusCounts.sent + quotations.statusCounts.draft} awaiting a decision`} accent="#F59E0B" />
                  <PremiumKpi label="Quotation win rate" value={quotations.approvalRate} format={(n) => percent(n)} icon={TrendingUp} href="/admin/quotations" hint={`Average quote ${formatCurrency(quotations.averageValue ?? 0)}`} badge="Approval rate" />
                </div>
                <div className="grid grid-cols-12 gap-4 lg:gap-5">
                  <PremiumPanel title="Revenue & volume" description={`Won revenue and quotations over ${data.dateRange.label.toLowerCase()}`} action={{ href: "/admin/quotations", label: "View all" }} className="col-span-12 xl:col-span-8">
                    <TrendChart points={trendPoints} />
                  </PremiumPanel>
                  <PremiumPanel title="Proposal delivery health" description="How sent quotations are doing" className="col-span-12 xl:col-span-4">
                    <DeliveryHealth deliveries={deliveries} />
                  </PremiumPanel>
                  <PremiumPanel title="Quotation lifecycle" description="Where your proposals stand" action={{ href: "/admin/quotations", label: "View quotations" }} className="col-span-12 lg:col-span-6">
                    <StatusDonut segments={statusSegments} centerLabel="quotations" />
                  </PremiumPanel>
                  <PremiumPanel title="Recent quotations" description="The latest proposals in your workspace" action={{ href: "/admin/quotations", label: "View all" }} flush className="col-span-12 lg:col-span-6">
                    <RecentQuotationList rows={quotations.recent} />
                  </PremiumPanel>
                </div>
              </>
            )}

          {shownTab === "dealers" &&
            canViewDealers &&
            panel(
              "dealers",
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
                  <PremiumKpi label="Active partner dealers" value={dealers.totalActiveDealers} icon={Store} href="/admin/dealers" hint="Authorised network partners" accent="#8B5CF6" />
                  <PremiumKpi label="Confirmed dealer earnings" value={quotations.confirmedDealerEarnings} format={rupees} icon={Wallet} href="/admin/dealers" hint="Commission accrued across your dealers" accent="#10B981" />
                  <PremiumKpi label="Dealer approval rate" value={quotations.approvalRate} format={(n) => percent(n)} icon={CheckCircle2} href="/admin/dealers" hint={`${approvedCount} approved of the decided quotations`} />
                </div>
                <div className="grid grid-cols-12 gap-4 lg:gap-5">
                  <PremiumPanel title="Dealer leaderboard" description="Approved value and earnings by dealer" action={{ href: "/admin/dealers", label: "Manage dealers" }} flush className={`col-span-12 ${dealerTiers ? "lg:col-span-7" : "lg:col-span-12"}`}>
                    <DealerLeaderboard dealers={dealers.items} canViewEarnings={canViewDealers} totalActive={dealers.totalActiveDealers} />
                  </PremiumPanel>
                  {dealerTiers && (
                    <PremiumPanel title="Dealer categories" description="Active dealers by category, and upgrades in the period" action={{ href: "/admin/dealers", label: "Manage dealers" }} className="col-span-12 lg:col-span-5">
                      <DealerTierSummary dealersByCategory={dealerTiers.dealersByCategory} upgradesInPeriod={dealerTiers.upgradesInPeriod} periodLabel={data.dateRange.label} />
                    </PremiumPanel>
                  )}
                </div>
              </>
            )}

          {shownTab === "catalog" &&
            panel(
              "catalog",
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
                  <PremiumKpi label="Total products" value={catalog.totalProducts} icon={Package} href="/admin/products" hint={`${catalog.activeProducts} active in the catalogue`} accent="#0EA5E9" />
                  <PremiumKpi label="Matrix products" value={catalog.matrixProducts} icon={LayersIcon} href="/admin/products?matrix=true" hint="Modular switch-board configurations" accent="#8B5CF6" />
                  <PremiumKpi label="Categories" value={catalog.categoryCount} format={(n) => `${Math.round(n)} categories`} icon={FolderTree} href="/admin/categories" hint={`${catalog.seriesCount} series`} accent="#F59E0B" />
                </div>
                <div className="grid grid-cols-12 gap-4 lg:gap-5">
                  <PremiumPanel title="Catalogue mix" description="Products by hardware type" action={{ href: "/admin/products", label: "Manage" }} className="col-span-12 lg:col-span-5">
                    <BarList rows={typeRows} emptyText="Add products to see the mix." />
                  </PremiumPanel>
                  <PremiumPanel title="Recently added" action={{ href: "/admin/products", label: "View all" }} flush className="col-span-12 lg:col-span-7">
                    <RecentProducts products={recentProducts} categories={categories} addedAtById={addedAtById} />
                  </PremiumPanel>
                </div>
              </>
            )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
