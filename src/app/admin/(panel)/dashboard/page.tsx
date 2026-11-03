import Link from "next/link";
import { Building2, ArrowRight } from "lucide-react";
import { connectMongoDB } from "@/lib/mongodb";
import { Category as CategoryModel, Company, Product } from "@/models";
import { getAdminDashboardData, redactDashboardData, type DashboardAccess, type DateRangeKey } from "@/lib/adminDashboardData";
import { getSuperAdminDashboardData } from "@/lib/superAdminDashboardData";
import { getAuthenticatedActor } from "@/lib/api-auth";
import { withTenant } from "@/lib/tenant/context";
import { normalizeCategories, normalizeProducts } from "@/lib/quotationNormalization";
import { hasPermission } from "@/lib/permissions";
import { getDemoCrmAnalytics, isDemoModeAllowed } from "@/lib/dashboard/demoData";
import type { Product as IProduct } from "@/types";
import SuperAdminDashboard from "@/components/admin/dashboard/SuperAdminDashboard";
import DashboardTabsLayout from "@/components/admin/dashboard/DashboardTabsLayout";
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
  // A custom role sees only the parts of the dashboard its permissions cover; the rest is removed before it is sent.
  const access: DashboardAccess = {
    crm: hasPermission(actor.role, actor.permissions, "leads:read"),
    sales: hasPermission(actor.role, actor.permissions, "quotations:read_all"),
    dealers: canViewDealers,
  };

  // Fetch tenant-scoped operational data ONLY if a trusted company context exists
  let data = null;
  let rawProducts: any[] = [];
  let rawCategories: any[] = [];
  let onboarding = null;

  if (hasActiveCompany) {
    [data, rawProducts, rawCategories, onboarding] = await withTenant(actor, () =>
      Promise.all([
        getAdminDashboardData({ dateRange, includeDemo }).then((full) => redactDashboardData(full, access)),
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

  // The complete Business Dashboard view with responsive domain tabs
  const adminViewContent = (
    <DashboardTabsLayout
      data={data}
      recentProducts={recentProducts}
      categories={categories}
      addedAtById={addedAtById}
      companyName={companyName}
      actingAsCompany={actor.actingAsCompany}
      isSuperAdmin={isSuperAdmin}
      canEnableDemo={canEnableDemo}
      canViewDealers={canViewDealers}
      access={access}
      showSetupGuide={showSetupGuide}
      onboarding={onboarding}
      initialTab={resolvedParams.tab}
      dateRange={dateRange}
    />
  );

  // If Super Admin is acting as a company, wrap in SuperAdminDashboard tab view
  if (isSuperAdmin && superAdminData) {
    return (
      <SuperAdminDashboard
        data={superAdminData}
        adminViewContent={adminViewContent}
        crmData={data.crm}
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
