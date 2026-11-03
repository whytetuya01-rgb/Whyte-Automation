"use client";

import Link from "next/link";
import { PieChart, ArrowRight, ExternalLink, Zap } from "lucide-react";
import type { CrmLeadSource } from "@/lib/dashboard/demoData";
import { formatCurrency } from "@/lib/utils";

interface LeadSourcesBreakdownProps {
  sources: CrmLeadSource[];
  totalLeads: number;
}

export default function LeadSourcesBreakdown({
  sources,
  totalLeads,
}: LeadSourcesBreakdownProps) {
  if (sources.length === 0 || totalLeads === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-[#F6F6F7]/50 rounded-xl border border-dashed border-[#E5E5E7]">
        <div className="w-10 h-10 rounded-xl bg-white border border-[#E5E5E7] flex items-center justify-center text-[#8A8A93] mb-3 shadow-2xs">
          <PieChart size={18} />
        </div>
        <p className="text-sm font-semibold text-[#111111]">No lead source data</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-xs leading-relaxed">
          Lead attribution across channels like Architect Referrals, Website, and Showrooms will analyze here.
        </p>
        <Link
          href="/admin/crm/sources"
          className="inline-flex items-center gap-1.5 mt-3.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#111111] text-white hover:bg-neutral-800 transition"
        >
          <span>Configure Sources</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Summary */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#F0F0F2]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8A93]">Total Inbound:</span>
          <span className="text-xs font-bold text-[#111111] tabular-nums">
            {totalLeads} {totalLeads === 1 ? "Lead" : "Leads"}
          </span>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5F5F68] bg-[#F6F6F7] border border-[#E5E5E7] px-2.5 py-0.5 rounded-full shadow-2xs">
          {sources.length} Active {sources.length === 1 ? "Channel" : "Channels"}
        </span>
      </div>

      {/* Sources List with Gradient Progress Bars & Smooth Fill */}
      <div className="space-y-3 pt-0.5">
        {sources.map((src) => {
          return (
            <div
              key={src.source}
              className="group/source text-xs space-y-1.5 p-1.5 -mx-1.5 rounded-xl hover:bg-[#F6F6F7]/80 transition-all duration-200"
            >
              <div className="flex items-center justify-between text-[#5F5F68]">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="font-semibold text-[#111111] truncate tracking-tight group-hover/source:text-black">
                    {src.source}
                  </span>
                  {src.conversionRate !== undefined && src.conversionRate > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.2 rounded-full shrink-0 shadow-2xs">
                      <Zap size={9} className="text-emerald-600 fill-emerald-600" />
                      <span>{src.conversionRate}% conv</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <span className="font-bold text-[#111111]">
                    {src.count} <span className="font-normal text-[#8A8A93] text-[11px]">({src.percentage}%)</span>
                  </span>
                  {src.wonRevenue > 0 && (
                    <span className="text-emerald-700 font-bold text-[11px]">
                      · {formatCurrency(src.wonRevenue)} won
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar with Gradient and Smooth Ease */}
              <div className="w-full bg-[#EAEAEB] h-1.5 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-700 group-hover/source:from-[var(--color-admin-primary,#D85B83)] group-hover/source:to-[var(--color-admin-primary-dark,#B83E68)]"
                  style={{ width: `${Math.min(100, Math.max(4, src.percentage))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-[#F0F0F2] flex items-center justify-between text-[11px]">
        <span className="text-[#8A8A93]">Ranked by total lead volume</span>
        <Link
          href="/admin/crm/sources"
          className="font-bold text-[var(--color-admin-primary-foreground,#B83E68)] hover:underline inline-flex items-center gap-1 group/link"
        >
          <span>Manage Sources</span>
          <ExternalLink size={11} className="transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
        </Link>
      </div>
    </div>
  );
}
