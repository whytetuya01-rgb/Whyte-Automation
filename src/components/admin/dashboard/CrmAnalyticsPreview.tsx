"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Target,
  Users2,
  PieChart,
  Layers,
  Award,
  ArrowRight,
} from "lucide-react";
import type { CrmAnalyticsData } from "@/lib/dashboard/demoData";
import { formatCurrency } from "@/lib/utils";

interface CrmAnalyticsPreviewProps {
  crm: CrmAnalyticsData | null;
  canEnableDemo: boolean;
}

export default function CrmAnalyticsPreview({ crm, canEnableDemo }: CrmAnalyticsPreviewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleToggleDemo = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (crm) {
      params.delete("demo");
    } else {
      params.set("demo", "1");
    }
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  // State 1: Live Mode (Clean Architecture Roadmap card)
  if (!crm) {
    return (
      <section className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6 flex flex-col gap-5">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0F0F2]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7]">
                <Target size={12} className="text-[#8A8A93]" />
                <span>Product Roadmap</span>
              </span>
              <span className="text-[11px] text-[#8A8A93]">Future CRM Architecture</span>
            </div>
            <h2 className="text-base font-semibold tracking-tight text-[#111111]">
              CRM Pipeline & Sales Intelligence
            </h2>
            <p className="text-xs text-[#8A8A93] mt-0.5 font-normal leading-relaxed">
              Whyte Automation tracks active quotations via MongoDB. Dedicated pre-proposal lead and opportunity stages are queued on the system roadmap.
            </p>
          </div>

          {canEnableDemo && (
            <button
              type="button"
              onClick={handleToggleDemo}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-[#111111] text-white hover:bg-[#1E1E22] text-xs font-medium transition cursor-pointer self-start sm:self-auto shrink-0 shadow-2xs"
            >
              <Sparkles size={13} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>Preview Demo Data</span>
            </button>
          )}
        </header>

        {/* Feature Preview Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
          <div className="p-4 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7] space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#111111]">
              <Users2 size={15} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>1. Homeowner & Client Inquiries</span>
            </div>
            <p className="text-[#8A8A93] text-[11px] font-normal leading-relaxed">
              Capture inbound client leads, site visit bookings, and architect contacts prior to drafting quotations.
            </p>
          </div>

          <div className="p-4 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7] space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#111111]">
              <PieChart size={15} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>2. Lead Source Attribution</span>
            </div>
            <p className="text-[#8A8A93] text-[11px] font-normal leading-relaxed">
              Track deal conversion efficiency across Architects, Web Inquiries, Experience Centers, and Word of Mouth.
            </p>
          </div>

          <div className="p-4 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7] space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#111111]">
              <Award size={15} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>3. Sales Quota Management</span>
            </div>
            <p className="text-[#8A8A93] text-[11px] font-normal leading-relaxed">
              Monitor individual salesperson deal volume, won revenue achievement, and closing velocity against monthly quotas.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // State 2: Active Demo Mode (Refined Luxury Executive Styling)
  const { summary, stages, sources, salespeople } = crm;

  return (
    <section className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6 flex flex-col gap-5">
      {/* Refined Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0F0F2]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)]">
              <Sparkles size={11} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>DEMO DATA · Illustrative Preview</span>
            </span>
            <span className="text-[11px] text-[#8A8A93] font-normal">In-Memory Mock Fixture</span>
          </div>
          <h2 className="text-base font-semibold tracking-tight text-[#111111]">
            CRM Intelligence & Opportunity Pipeline
          </h2>
          <p className="text-xs text-[#8A8A93] mt-0.5 font-normal leading-relaxed">
            Illustrative preview of future CRM capability. Values are development fixtures and do not alter real database records.
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleDemo}
          disabled={isPending}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-lg border border-[#E5E5E7] bg-white text-[#5F5F68] hover:text-[#111111] hover:bg-[#F6F6F7] text-xs font-medium transition cursor-pointer self-start sm:self-auto shrink-0"
        >
          <span>Exit Preview</span>
        </button>
      </header>

      {/* Primary CRM Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7] flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93]">Active Leads</span>
          <div className="text-2xl font-semibold text-[#111111] tracking-tight tabular-nums mt-1">{summary.totalLeads}</div>
          <span className="text-[11px] text-[#8A8A93] mt-1 font-normal">Active prospects</span>
        </div>

        <div className="p-4 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7] flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93]">Open Deals</span>
          <div className="text-2xl font-semibold text-[#111111] tracking-tight tabular-nums mt-1">{summary.activeOpportunities}</div>
          <span className="text-[11px] text-[#8A8A93] mt-1 font-normal">{formatCurrency(summary.pipelineValue)} pipeline</span>
        </div>

        <div className="p-4 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7] flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93]">Lead-to-Won</span>
          <div className="text-2xl font-semibold text-emerald-800 tracking-tight tabular-nums mt-1">{summary.leadToWonRate}%</div>
          <span className="text-[11px] text-[#8A8A93] mt-1 font-normal">Deal conversion rate</span>
        </div>

        <div className="p-4 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7] flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93]">Sales Cycle</span>
          <div className="text-2xl font-semibold text-[#111111] tracking-tight tabular-nums mt-1">{summary.avgSalesCycleDays} <span className="text-sm font-normal text-[#8A8A93]">days</span></div>
          <span className="text-[11px] text-[#8A8A93] mt-1 font-normal">Average closing time</span>
        </div>

        <div className="p-4 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7] flex flex-col justify-between col-span-2 sm:col-span-1 lg:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93]">CRM Won Value</span>
          <div className="text-2xl font-semibold text-[#111111] tracking-tight tabular-nums mt-1">{formatCurrency(summary.wonRevenue)}</div>
          <span className="text-[11px] text-emerald-700 mt-1 font-medium">Closed deals</span>
        </div>
      </div>

      {/* Middle Grid: Opportunity Funnel & Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
        {/* Opportunity Funnel */}
        <div className="lg:col-span-7 p-4 sm:p-5 rounded-xl bg-white border border-[#E5E5E7] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#F0F0F2]">
            <h3 className="text-xs font-semibold text-[#111111] flex items-center gap-2">
              <Layers size={14} className="text-[#8A8A93]" />
              <span>Opportunity Funnel by Stage</span>
            </h3>
            <span className="text-[10px] text-[#8A8A93] uppercase font-semibold tracking-wider">
              {summary.activeOpportunities} Active
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {stages.map((st) => {
              const pct = Math.min(100, Math.max(8, (st.value / summary.pipelineValue) * 100));
              return (
                <div key={st.id} className="text-xs space-y-1">
                  <div className="flex items-center justify-between text-[#5F5F68]">
                    <span className="font-medium flex items-center gap-2 text-[#111111]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
                      <span>{st.name}</span>
                    </span>
                    <span className="tabular-nums font-semibold text-[#111111]">
                      {st.count} <span className="font-normal text-[#8A8A93] mr-1.5">deals</span> {formatCurrency(st.value)}
                    </span>
                  </div>
                  <div className="w-full bg-[#F0F0F2] h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        backgroundColor: st.color,
                        width: `${pct}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lead Sources Breakdown */}
        <div className="lg:col-span-5 p-4 sm:p-5 rounded-xl bg-white border border-[#E5E5E7] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#F0F0F2]">
            <h3 className="text-xs font-semibold text-[#111111] flex items-center gap-2">
              <PieChart size={14} className="text-[#8A8A93]" />
              <span>Lead Source Attribution</span>
            </h3>
            <span className="text-[10px] text-[#8A8A93] uppercase font-semibold tracking-wider">
              Inbound Mix
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {sources.map((src) => (
              <div key={src.source} className="text-xs space-y-1">
                <div className="flex items-center justify-between text-[#5F5F68]">
                  <span className="font-medium text-[#111111] truncate pr-2">{src.source}</span>
                  <span className="font-semibold text-[#111111] shrink-0 tabular-nums">{src.percentage}% ({src.count})</span>
                </div>
                <div className="w-full bg-[#F0F0F2] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#111111] rounded-full"
                    style={{ width: `${src.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Salesperson Performance Table */}
      <div className="rounded-xl border border-[#E5E5E7] overflow-hidden bg-white">
        <div className="px-4 py-3 bg-[#F6F6F7]/60 border-b border-[#E5E5E7] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#111111] flex items-center gap-2">
            <Award size={14} className="text-[#8A8A93]" />
            <span>Salesperson Conversion & Target Performance</span>
          </h3>
          <span className="text-[10px] text-[#8A8A93] uppercase font-semibold tracking-wider">
            Team Leaderboard
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#F0F0F2] text-[#8A8A93] font-medium uppercase tracking-wider text-[10px] bg-white">
                <th scope="col" className="py-2.5 px-4 font-medium">Salesperson</th>
                <th scope="col" className="py-2.5 px-3 text-right font-medium">Leads</th>
                <th scope="col" className="py-2.5 px-3 text-right font-medium">Quotes</th>
                <th scope="col" className="py-2.5 px-3 text-right font-medium">Won Deals</th>
                <th scope="col" className="py-2.5 px-3 text-right font-medium">Won Revenue</th>
                <th scope="col" className="py-2.5 px-3 text-right font-medium">Win Rate</th>
                <th scope="col" className="py-2.5 px-4 text-right font-medium">Quota Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {salespeople.map((sp) => (
                <tr key={sp.id} className="hover:bg-[var(--color-admin-primary-subtle,#FFF6F8)]/70 transition-colors">
                  <td className="py-2.5 px-4 font-medium text-[#111111]">
                    <div className="font-semibold text-xs text-[#111111]">{sp.name}</div>
                    <div className="text-[10px] text-[#8A8A93] font-normal">{sp.role}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-[#5F5F68] tabular-nums font-medium">{sp.leadsAssigned}</td>
                  <td className="py-2.5 px-3 text-right text-[#5F5F68] tabular-nums font-medium">{sp.quotationsCreated}</td>
                  <td className="py-2.5 px-3 text-right font-semibold text-emerald-800 tabular-nums">{sp.wonQuotations}</td>
                  <td className="py-2.5 px-3 text-right font-semibold text-[#111111] tabular-nums">{formatCurrency(sp.wonRevenue)}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-[#111111] tabular-nums">{sp.conversionRate}%</td>
                  <td className="py-2.5 px-4 text-right">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                        sp.targetAchievement >= 80
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : sp.targetAchievement >= 60
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : "bg-red-50 text-red-800 border border-red-200"
                      }`}
                    >
                      {sp.targetAchievement}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
