"use client";

import CompanyLogo from "@/components/shared/CompanyLogo";
import { useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  Building,
  Store,
  Users,
  FileText,
  TrendingUp,
  Activity,
  Palette,
  ExternalLink,
  CheckCircle2,
  Clock,
  ArrowRight,
  Layers,
  ChevronRight,
  UserCog,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { SuperAdminDashboardData } from "@/lib/superAdminDashboardData";
import CrmAnalyticsPreview from "@/components/admin/dashboard/CrmAnalyticsPreview";
import { getDemoCrmAnalytics, type CrmAnalyticsData } from "@/lib/dashboard/demoData";

interface SuperAdminDashboardProps {
  data: SuperAdminDashboardData;
  adminViewContent: React.ReactNode;
  crmData?: CrmAnalyticsData | null;
  canEnableDemo?: boolean;
  initialTab?: "platform" | "business" | "crm";
}

export default function SuperAdminDashboard({
  data,
  adminViewContent,
  crmData,
  canEnableDemo,
  initialTab,
}: SuperAdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<"platform" | "business" | "crm">(initialTab || "platform");

  const { companies, dealers, users, quotations, recentActivity } = data;
  const approvedTotal = quotations.statusCounts.approved + quotations.statusCounts.delivered;

  return (
    <div className="space-y-6 max-w-full">
      {/* Top Superadmin Platform Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-gray-200/80">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-neutral-900 text-white shadow-2xs">
              <ShieldCheck size={12} className="text-[var(--color-admin-primary,#D85B83)]" />
              Platform Superadmin
            </span>
            <span className="text-xs text-gray-400 font-mono">System Oversight</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-950">
            Control Center & Governance
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Multi-tenant company telemetry, partner dealer network, user governance, and security audit trail.
          </p>
        </div>

        {/* View Switcher: Platform Oversight vs Business / Catalog */}
        <div className="flex items-center bg-gray-100/90 p-1 rounded-xl border border-gray-200/70 self-start md:self-auto shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("platform")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "platform"
                ? "bg-white text-gray-950 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <ShieldCheck size={14} className={activeTab === "platform" ? "text-[var(--color-admin-primary,#D85B83)]" : ""} />
            <span>Platform Oversight</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("business")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "business"
                ? "bg-white text-gray-950 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Layers size={14} />
            <span>Business & Catalog View</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("crm")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "crm"
                ? "bg-[#111111] text-white shadow-xs"
                : "text-[#5F5F68] hover:text-[#111111]"
            }`}
          >
            <Sparkles size={14} className={activeTab === "crm" ? "text-white" : "text-purple-600"} />
            <span>CRM & Leads (Demo)</span>
          </button>
        </div>
      </div>

      {activeTab === "crm" ? (
        <div className="space-y-4">
          <div className="p-3 bg-[#F6F6F7] border border-[#E5E5E7] rounded-xl text-xs text-[#5F5F68] flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>Showing <strong className="font-semibold text-[#111111]">CRM Analytics, Leads, Opportunities & Sales Funnel</strong> (Illustrative Preview).</span>
            </span>
            <button
              onClick={() => setActiveTab("platform")}
              className="text-xs font-semibold text-[var(--color-admin-primary-foreground,#8A2B4D)] hover:underline cursor-pointer"
            >
              Back to Platform Oversight
            </button>
          </div>
          <CrmAnalyticsPreview crm={crmData ?? (canEnableDemo ? getDemoCrmAnalytics() : null)} canEnableDemo={Boolean(canEnableDemo)} />
        </div>
      ) : activeTab === "business" ? (
        // Business View (Standard Admin Dashboard content for inspecting single-tenant catalog & quotation view)
        <div className="space-y-4">
          <div className="p-3 bg-blue-50/70 border border-blue-200/70 rounded-xl text-xs text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Layers size={15} />
              Showing <strong>Business & Catalog Operations</strong> perspective (Quotation creator view).
            </span>
            <button
              onClick={() => setActiveTab("platform")}
              className="text-xs font-bold underline hover:no-underline cursor-pointer"
            >
              Switch back to Platform Oversight
            </button>
          </div>
          {adminViewContent}
        </div>
      ) : (
        // Superadmin Platform Oversight
        <div className="space-y-6">
          {/* Quick Access Card: CRM & Leads Preview */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E5E5E7] shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary,#D85B83)] flex items-center justify-center shrink-0">
                <Sparkles size={17} />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111] text-sm sm:text-base flex items-center gap-2">
                  <span>CRM Analytics, Leads & Opportunity Funnel</span>
                  <span className="text-[10px] font-medium bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)] px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Demo Ready
                  </span>
                </h3>
                <p className="text-xs text-[#8A8A93] mt-0.5 font-normal">
                  Explore interactive prospects, opportunity funnel by stage, lead sources attribution, and salesperson performance.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("crm")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#111111] hover:bg-[#1E1E22] text-white text-xs font-medium transition shrink-0 self-end sm:self-auto cursor-pointer"
            >
              <Sparkles size={13} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>View CRM Pipeline</span>
              <ArrowRight size={13} />
            </button>
          </div>
          {/* Urgent Alert Banner: Pending Company Reviews */}
          {companies.pendingReviewCount > 0 && (
            <div className="relative overflow-hidden p-4 sm:p-5 rounded-2xl bg-gradient-to-r bg-amber-50/70 border border-amber-200/80 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-[#111111] text-sm sm:text-base flex items-center gap-2">
                    Action Required: {companies.pendingReviewCount} Company Registration{companies.pendingReviewCount > 1 ? "s" : ""} Pending Review
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Self-registered companies are waiting for Superadmin verification to access the platform.
                  </p>
                </div>
              </div>
              <Link
                href="/admin/companies"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#111111] text-white text-xs font-medium hover:bg-[#1E1E22] transition shadow-2xs shrink-0 self-end sm:self-auto"
              >
                <span>Review Applications</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          )}

          {/* Row 1: High-Impact Vital Sign KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Companies */}
            <Link
              href="/admin/companies"
              className="group p-5 rounded-2xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition-all relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Registered Companies
                </span>
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Building size={16} />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-mono font-bold text-gray-950">
                  {companies.total}
                </span>
                <span className="text-xs text-gray-400">tenants</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                <span className="text-emerald-700 font-medium">
                  {companies.approvedCount} active
                </span>
                {companies.pendingReviewCount > 0 ? (
                  <span className="font-bold text-amber-700 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">
                    {companies.pendingReviewCount} pending
                  </span>
                ) : (
                  <span className="text-gray-400">All reviewed</span>
                )}
              </div>
            </Link>

            {/* KPI 2: Dealers Network */}
            <Link
              href="/admin/dealers"
              className="group p-5 rounded-2xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition-all relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Dealer Partners
                </span>
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Store size={16} />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-mono font-bold text-gray-950">
                  {dealers.total}
                </span>
                <span className="text-xs text-gray-400">partners</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                <span className="text-purple-700 font-semibold">
                  {dealers.active} active partners
                </span>
                <span className="font-mono text-gray-500">
                  {dealers.inactive} inactive
                </span>
              </div>
            </Link>

            {/* KPI 3: Platform Quotations */}
            <Link
              href="/admin/quotations"
              className="group p-5 rounded-2xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition-all relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Platform Quotations
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <FileText size={16} />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-mono font-bold text-gray-950">
                  {quotations.total}
                </span>
                <span className="text-xs text-gray-400">total proposals</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                <span className="text-emerald-700 font-semibold">
                  {approvedTotal} confirmed orders
                </span>
                <span className="text-gray-500 font-mono">
                  {quotations.thisMonth} this mo
                </span>
              </div>
            </Link>

            {/* KPI 4: Commercial Volume & Earnings */}
            <Link
              href="/admin/quotations"
              className="group p-5 rounded-2xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition-all relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Approved Value
                </span>
                <div className="w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
                  <TrendingUp size={16} />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-mono font-bold text-gray-950 truncate">
                  {formatCurrency(quotations.approvedValue)}
                </span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                <span className="text-gray-500">Dealer Earnings:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {formatCurrency(dealers.totalEarnings)}
                </span>
              </div>
            </Link>
          </div>

          {/* Row 2: Incoming Company Reviews & Dealer Network */}
          <div className="grid grid-cols-12 gap-5">
            {/* Incoming Company Reviews */}
            <div className="col-span-12 lg:col-span-7 bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden flex flex-col">
              <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-950 text-sm sm:text-base flex items-center gap-2">
                    <Building size={16} className="text-gray-600" />
                    Incoming Company Registrations
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Self-registered tenant accounts awaiting Superadmin approval
                  </p>
                </div>
                <Link
                  href="/admin/companies"
                  className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1"
                >
                  <span>View All ({companies.total})</span>
                  <ChevronRight size={13} />
                </Link>
              </div>

              <div className="flex-1 divide-y divide-gray-100">
                {companies.recentPending.length === 0 ? (
                  <div className="p-8 text-center my-auto">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                      <CheckCircle2 size={24} />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900">All Registrations Reviewed</h4>
                    <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                      No companies are currently waiting in the review queue. All {companies.approvedCount} registered companies are processed.
                    </p>
                    <Link
                      href="/admin/companies"
                      className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <span>Manage Approved Companies</span>
                      <ExternalLink size={12} />
                    </Link>
                  </div>
                ) : (
                  companies.recentPending.map((comp) => (
                    <div key={comp.id} className="p-4 flex items-center justify-between gap-3 hover:bg-gray-50/70 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <CompanyLogo src={comp.logoUrl} name={comp.name} variant="thumb" size="sm" />
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 text-xs sm:text-sm truncate">{comp.name}</p>
                          <p className="text-gray-500 text-xs truncate">
                            {comp.ownerName ? `${comp.ownerName} · ` : ""}{comp.email || comp.phone}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Submitted: {comp.submittedAt ? formatDate(comp.submittedAt) : "Recently"}
                          </p>
                        </div>
                      </div>
                      <Link
                        href="/admin/companies"
                        className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition shrink-0"
                      >
                        Review
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Dealers & Network Overview */}
            <div className="col-span-12 lg:col-span-5 bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden flex flex-col">
              <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-950 text-sm sm:text-base flex items-center gap-2">
                    <Store size={16} className="text-purple-600" />
                    Authorized Dealers Network
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {dealers.active} active of {dealers.total} registered partners
                  </p>
                </div>
                <Link
                  href="/admin/dealers"
                  className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1"
                >
                  <span>Manage ({dealers.total})</span>
                  <ChevronRight size={13} />
                </Link>
              </div>

              <div className="flex-1 divide-y divide-gray-100">
                {dealers.topDealers.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-500">
                    No dealers registered yet.
                  </div>
                ) : (
                  dealers.topDealers.map((d) => (
                    <div key={d.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-gray-50/70 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-gray-900 text-xs truncate">{d.name}</p>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                              d.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                            }`}
                          >
                            {d.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        {d.companyName && (
                          <p className="text-[11px] text-gray-500 truncate">{d.companyName}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-0.5">{d.quotationsCount} quotations created</p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-block px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-bold text-xs border border-purple-100">
                          {d.discountAllocationPercent}% disc
                        </span>
                        <p className="text-[10px] text-emerald-700 font-mono font-semibold mt-1">
                          {formatCurrency(d.accumulatedEarnings)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Platform Telemetry & User Governance */}
          <div className="grid grid-cols-12 gap-5">
            {/* 6-Month Platform Quotation Growth & Pipeline */}
            <div className="col-span-12 lg:col-span-7 bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-950 text-sm sm:text-base flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-600" />
                    Platform Activity Trend (6 Months)
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Monthly quotation generation and confirmation volume across the ecosystem
                  </p>
                </div>
                <Link
                  href="/admin/quotations"
                  className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1"
                >
                  <span>Quotations</span>
                  <ExternalLink size={12} />
                </Link>
              </div>

              {/* Monthly Bars */}
              <div className="grid grid-cols-6 gap-2 pt-2 items-end h-40">
                {quotations.months.map((m) => {
                  const maxTotal = Math.max(...quotations.months.map((item) => item.total), 1);
                  const heightPercent = Math.max(Math.round((m.total / maxTotal) * 100), 8);
                  return (
                    <div key={m.key} className="flex flex-col items-center h-full justify-end group">
                      <div className="text-[10px] text-gray-400 font-mono mb-1 group-hover:text-black transition-colors">
                        {m.total}
                      </div>
                      <div
                        className="w-full max-w-[42px] rounded-t-xl bg-gradient-to-t from-gray-900 to-gray-700 group-hover:from-black group-hover:to-gray-800 transition-all relative overflow-hidden"
                        style={{ height: `${heightPercent}%` }}
                      >
                        {m.approved > 0 && (
                          <div
                            className="absolute bottom-0 inset-x-0 bg-emerald-500"
                            style={{ height: `${Math.round((m.approved / (m.total || 1)) * 100)}%` }}
                            title={`${m.approved} approved`}
                          />
                        )}
                      </div>
                      <span className="text-[11px] font-bold text-gray-500 mt-2 uppercase">
                        {m.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Status Breakdown Strip */}
              <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-gray-500 font-medium">Lifecycle Distribution:</span>
                <div className="flex items-center gap-2 flex-wrap font-medium">
                  <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px]">
                    Draft: {quotations.statusCounts.draft}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px]">
                    Sent: {quotations.statusCounts.sent}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px]">
                    Approved: {quotations.statusCounts.approved}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-700 text-[11px]">
                    Delivered: {quotations.statusCounts.delivered}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-[11px]">
                    Rejected: {quotations.statusCounts.rejected}
                  </span>
                </div>
              </div>
            </div>

            {/* Platform Users & Governance */}
            <div className="col-span-12 lg:col-span-5 bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-950 text-sm sm:text-base flex items-center gap-2">
                    <Users size={16} className="text-blue-600" />
                    User Accounts & Roles
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {users.active} active accounts across platform roles
                  </p>
                </div>
                <Link
                  href="/admin/users"
                  className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1"
                >
                  <span>Users ({users.total})</span>
                  <ChevronRight size={13} />
                </Link>
              </div>

              {/* Role Distribution Grid */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-[10px] text-gray-400 block uppercase font-bold">Super Admins</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-bold text-gray-950">{users.byRole.super_admin}</span>
                    <span className="text-[10px] text-gray-400">platform staff</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100">
                  <span className="text-[10px] text-blue-700 block uppercase font-bold">Company Owners</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-bold text-blue-950">{users.byRole.company_owner}</span>
                    <span className="text-[10px] text-blue-600">tenants</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-purple-50/60 border border-purple-100">
                  <span className="text-[10px] text-purple-700 block uppercase font-bold">Dealers</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-bold text-purple-950">{users.byRole.dealer}</span>
                    <span className="text-[10px] text-purple-600">partners</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                  <span className="text-[10px] text-emerald-700 block uppercase font-bold">Admins & Staff</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-bold text-emerald-950">{users.byRole.admin + users.byRole.sales_executive}</span>
                    <span className="text-[10px] text-emerald-600">operators</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                <Link
                  href="/admin/roles"
                  className="font-semibold text-gray-700 hover:text-black flex items-center gap-1.5"
                >
                  <ShieldCheck size={13} className="text-gray-500" />
                  <span>Configure Granular Permissions</span>
                </Link>
                <Link
                  href="/admin/users"
                  className="font-bold text-[var(--color-admin-primary,#D85B83)] hover:underline"
                >
                  Manage Users →
                </Link>
              </div>
            </div>
          </div>

          {/* Row 4: Live Platform Security & Activity Audit Trail */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-950 text-sm sm:text-base flex items-center gap-2">
                  <Activity size={16} className="text-blue-600" />
                  Recent Platform Audit Activity
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Append-only event stream of user actions, quotation lifecycles, and assignments
                </p>
              </div>
              <Link
                href="/admin/activity"
                className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1"
              >
                <span>Full Audit Log</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            <div className="divide-y divide-gray-100 text-xs">
              {recentActivity.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  No activity events recorded yet.
                </div>
              ) : (
                recentActivity.map((event) => (
                  <div key={event.id} className="p-3.5 sm:px-5 flex items-center justify-between gap-4 hover:bg-gray-50/70 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center shrink-0">
                        <Clock size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {event.description}
                          {event.quotationNumber && (
                            <span className="font-mono text-gray-600 ml-1.5 font-normal">
                              ({event.quotationNumber})
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          Actor: <strong className="text-gray-600 font-medium">{event.performedByName}</strong>
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-gray-400 shrink-0">
                      {formatDate(event.performedOn)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Row 5: Superadmin Direct Governance Shortcuts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Link
              href="/admin/companies"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <Building size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Companies</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Reviews & Tenants</p>
            </Link>

            <Link
              href="/admin/dealers"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <Store size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Dealers</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Discount Allocations</p>
            </Link>

            <Link
              href="/admin/roles"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <ShieldCheck size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Roles & Caps</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Permissions Matrix</p>
            </Link>

            <Link
              href="/admin/users"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <UserCog size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Users</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Accounts & Status</p>
            </Link>

            <Link
              href="/admin/activity"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-800 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <Activity size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Activity Log</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Audit Trail</p>
            </Link>

            <Link
              href="/admin/theme"
              className="p-3.5 rounded-xl bg-white border border-gray-200/80 hover:border-gray-300 hover:shadow-xs transition text-center group"
            >
              <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                <Palette size={16} />
              </div>
              <p className="font-bold text-gray-900 text-xs">Theme & Brand</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Platform Styling</p>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
