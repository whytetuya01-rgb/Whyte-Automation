"use client";

import Link from "next/link";
import { Layers, ArrowRight, TrendingUp } from "lucide-react";
import type { CrmOpportunityStage } from "@/lib/dashboard/demoData";
import { formatCurrency } from "@/lib/utils";

interface OpportunityFunnelProps {
  stages: CrmOpportunityStage[];
  activeOpportunities: number;
  pipelineValue: number;
}

export default function OpportunityFunnel({
  stages,
  activeOpportunities,
  pipelineValue,
}: OpportunityFunnelProps) {
  const hasActivity = stages.some((s) => s.count > 0);

  if (!hasActivity) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-[#F6F6F7]/50 rounded-xl border border-dashed border-[#E5E5E7]">
        <div className="w-10 h-10 rounded-xl bg-white border border-[#E5E5E7] flex items-center justify-center text-[#8A8A93] mb-3 shadow-2xs">
          <Layers size={18} />
        </div>
        <p className="text-sm font-semibold text-[#111111]">No active opportunities</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-xs leading-relaxed">
          Leads advanced to site visits, proposal quotations, and negotiations will appear here in the sales funnel.
        </p>
        <Link
          href="/admin/crm/pipeline"
          className="inline-flex items-center gap-1.5 mt-3.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#111111] text-white hover:bg-neutral-800 transition"
        >
          <span>Open Pipeline</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  const maxVal = Math.max(...stages.map((s) => s.value || 0), 1);

  return (
    <div className="space-y-4">
      {/* Funnel Header Summary */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#F0F0F2]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8A93]">Pipeline Total:</span>
          <span className="text-xs font-bold text-[#111111] tabular-nums">
            {formatCurrency(pipelineValue)}
          </span>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5F5F68] bg-[#F6F6F7] border border-[#E5E5E7] px-2.5 py-0.5 rounded-full shadow-2xs">
          {activeOpportunities} Active {activeOpportunities === 1 ? "Deal" : "Deals"}
        </span>
      </div>

      {/* Stage Bars with Gradient Flow & Smooth Transitions */}
      <div className="space-y-3 pt-0.5">
        {stages.map((st) => {
          const pct = Math.min(100, Math.max(st.count > 0 ? 10 : 0, (st.value / maxVal) * 100));
          return (
            <div
              key={st.id}
              className="group/stage text-xs space-y-1.5 p-1.5 -mx-1.5 rounded-xl hover:bg-[#F6F6F7]/80 transition-all duration-200"
            >
              <div className="flex items-center justify-between text-[#5F5F68]">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs transition-transform duration-200 group-hover/stage:scale-125"
                    style={{ backgroundColor: st.color }}
                  />
                  <span className="font-semibold text-[#111111] truncate tracking-tight group-hover/stage:text-black">
                    {st.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <span className="font-bold text-[#111111]">
                    {st.count} <span className="font-normal text-[#8A8A93] text-[11px]">{st.count === 1 ? "deal" : "deals"}</span>
                  </span>
                  <span className="text-[#8A8A93] font-semibold text-[11px]">
                    · {formatCurrency(st.value)}
                  </span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="w-full bg-[#EAEAEB] h-2 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    background: `linear-gradient(90deg, ${st.color}CC 0%, ${st.color} 100%)`,
                    width: `${pct}%`,
                    boxShadow: st.count > 0 ? `0 1px 6px ${st.color}40` : "none",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Funnel Footer */}
      <div className="pt-2 border-t border-[#F0F0F2] flex items-center justify-between text-[11px]">
        <span className="text-[#8A8A93] flex items-center gap-1.5">
          <TrendingUp size={12} className="text-emerald-600 animate-pulse" />
          <span>Real-time deal progression</span>
        </span>
        <Link
          href="/admin/crm/pipeline"
          className="font-bold text-[var(--color-admin-primary-foreground,#B83E68)] hover:underline inline-flex items-center gap-1 group/link"
        >
          <span>Open Pipeline</span>
          <ArrowRight size={11} className="transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
