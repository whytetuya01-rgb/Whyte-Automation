"use client";

import Link from "next/link";
import { Users2, Award, ExternalLink, ArrowRight, TrendingUp, Sparkles } from "lucide-react";
import type { CrmSalespersonPerformance } from "@/lib/dashboard/demoData";
import { formatCurrency } from "@/lib/utils";

interface SalespersonPerformanceTableProps {
  salespeople: CrmSalespersonPerformance[];
  isDemo?: boolean;
}

export default function SalespersonPerformanceTable({
  salespeople,
  isDemo,
}: SalespersonPerformanceTableProps) {
  if (salespeople.length === 0) {
    return (
      <div className="py-12 text-center px-4">
        <Users2 className="w-8 h-8 text-[#8A8A93] mx-auto mb-2" />
        <p className="text-sm font-semibold text-[#111111]">No salesperson performance logged</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-sm mx-auto leading-relaxed">
          Assigned leads, generated quotations, and won revenue will rank here as your sales team interacts with prospects.
        </p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <Link
            href="/admin/crm/leads"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#111111] text-white hover:bg-neutral-800 transition shadow-2xs"
          >
            <span>Assign Leads</span>
            <ArrowRight size={12} />
          </Link>
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E5E5E7] bg-white text-[#5F5F68] hover:text-[#111111] hover:bg-[#F6F6F7] transition"
          >
            <span>Manage Team</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-[#F0F0F2] text-[#8A8A93] font-semibold uppercase tracking-wider text-[10px] bg-[#FDFDFD]">
            <th scope="col" className="py-3 px-4 font-semibold">Rank & Salesperson</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Role</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Assigned Leads</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Active Deals</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Quotes Created</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Won Deals</th>
            <th scope="col" className="py-3 px-3 text-right font-semibold">Won Revenue</th>
            <th scope="col" className="py-3 px-4 text-right font-semibold">Conversion Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0F0F2]">
          {salespeople.map((rep, idx) => {
            const isTop = idx === 0 && rep.wonRevenue > 0;
            const initials = rep.name
              .split(/\s+/)
              .map((n) => n[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase() || "SP";

            return (
              <tr
                key={String(rep.id)}
                className={`transition-all duration-200 ${
                  isTop
                    ? "bg-gradient-to-r from-amber-50/40 via-white to-transparent hover:from-amber-50/70"
                    : "hover:bg-gradient-to-r hover:from-[var(--color-admin-primary-subtle,#FFF6F8)]/70 hover:via-white hover:to-transparent"
                }`}
              >
                {/* Salesperson Name & Avatar */}
                <td className="py-3 px-4 font-medium text-[#111111]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold tabular-nums shrink-0 shadow-2xs ${
                        isTop
                          ? "bg-gradient-to-br from-amber-200 to-amber-300 text-amber-950 border border-amber-300"
                          : "bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7]"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div
                      className={`w-7 h-7 rounded-full bg-gradient-to-br from-neutral-900 to-neutral-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs ${
                        isTop ? "ring-2 ring-amber-400 ring-offset-1" : ""
                      }`}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 font-bold text-xs text-[#111111] truncate tracking-tight">
                        <span>{rep.name}</span>
                        {isTop && (
                          <span title="Top Performer" className="inline-flex items-center">
                            <Award
                              size={14}
                              className="text-amber-500 fill-amber-500 trophy-bounce shrink-0 drop-shadow-xs"
                            />
                          </span>
                        )}
                      </div>
                      {rep.email && (
                        <div className="text-[10px] text-[#8A8A93] font-normal truncate max-w-[170px]">
                          {rep.email}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Role Badge */}
                <td className="py-3 px-3 text-right whitespace-nowrap">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7] shadow-2xs">
                    {rep.role}
                  </span>
                </td>

                {/* Assigned Leads */}
                <td className="py-3 px-3 text-right font-bold text-[#111111] tabular-nums">
                  {rep.leadsAssigned}
                </td>

                {/* Active Opportunities */}
                <td className="py-3 px-3 text-right font-semibold text-[#5F5F68] tabular-nums">
                  {rep.opportunitiesActive ?? 0}
                </td>

                {/* Quotations Created */}
                <td className="py-3 px-3 text-right font-semibold text-[#5F5F68] tabular-nums">
                  {rep.quotationsCreated}
                </td>

                {/* Won Deals */}
                <td className="py-3 px-3 text-right font-bold text-emerald-800 tabular-nums">
                  {rep.wonQuotations}
                </td>

                {/* Won Revenue */}
                <td className="py-3 px-3 text-right font-bold text-[#111111] tabular-nums whitespace-nowrap">
                  {formatCurrency(rep.wonRevenue)}
                </td>

                {/* Conversion Rate */}
                <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold shadow-2xs transition-transform duration-200 hover:scale-105 ${
                      rep.conversionRate >= 30
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : rep.conversionRate > 0
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-[#F6F6F7] text-[#8A8A93] border border-[#E5E5E7]"
                    }`}
                  >
                    {rep.conversionRate}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
