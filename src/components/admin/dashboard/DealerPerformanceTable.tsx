"use client";

import Link from "next/link";
import { Users, Award, ExternalLink } from "lucide-react";
import type { DealerPerformanceRow } from "@/lib/adminDashboardData";
import { formatCurrency } from "@/lib/utils";

interface DealerPerformanceTableProps {
  dealers: DealerPerformanceRow[];
  totalActiveDealers: number;
  canViewEarnings: boolean;
}

export default function DealerPerformanceTable({
  dealers,
  totalActiveDealers,
  canViewEarnings,
}: DealerPerformanceTableProps) {
  if (dealers.length === 0) {
    return (
      <div className="py-10 text-center px-4">
        <Users className="w-8 h-8 text-[#8A8A93] mx-auto mb-2" />
        <p className="text-sm font-medium text-[#111111]">No dealer quotations in this period</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-sm mx-auto">
          {totalActiveDealers > 0
            ? `${totalActiveDealers} partner dealers registered. Performance metrics will rank here as proposals are issued.`
            : "No partner dealers registered yet for this workspace."}
        </p>
        <Link
          href="/admin/dealers"
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-[var(--color-admin-primary-foreground,#B83E68)] hover:underline"
        >
          <span>Manage Partners</span>
          <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-[#F0F0F2] text-[#8A8A93] font-medium uppercase tracking-wider text-[10px] bg-white">
            <th scope="col" className="py-2.5 px-4 font-medium">Rank & Partner</th>
            <th scope="col" className="py-2.5 px-3 text-right font-medium">Quotes</th>
            <th scope="col" className="py-2.5 px-3 text-right font-medium">Won</th>
            <th scope="col" className="py-2.5 px-3 text-right font-medium">Win Rate</th>
            <th scope="col" className="py-2.5 px-3 text-right font-medium">Won Revenue</th>
            {canViewEarnings && <th scope="col" className="py-2.5 px-4 text-right font-medium">Earnings</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0F0F2]">
          {dealers.map((dealer, idx) => {
            const isTop = idx === 0;
            return (
              <tr key={dealer.dealerId} className="hover:bg-[var(--color-admin-primary-subtle,#FFF6F8)]/70 transition-colors">
                <td className="py-3 px-4 font-medium text-[#111111]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold tabular-nums ${
                        isTop ? "bg-amber-100 text-amber-900 border border-amber-200" : "bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7]"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-1 font-semibold text-xs text-[#111111]">
                        <span>{dealer.name}</span>
                        {isTop && <Award size={12} className="text-amber-500 fill-amber-500" />}
                      </div>
                      {dealer.email && <div className="text-[10px] text-[#8A8A93] font-normal">{dealer.email}</div>}
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3 text-right font-medium text-[#5F5F68] tabular-nums">
                  {dealer.totalQuotations}
                </td>
                <td className="py-3 px-3 text-right font-medium text-emerald-800 tabular-nums">
                  {dealer.approvedQuotations}
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      dealer.approvalRate >= 50
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : dealer.approvalRate > 0
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-[#F6F6F7] text-[#5F5F68]"
                    }`}
                  >
                    {dealer.approvalRate}%
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-semibold text-[#111111] tabular-nums">
                  {formatCurrency(dealer.approvedValue)}
                </td>
                {canViewEarnings && (
                  <td className="py-3 px-4 text-right font-semibold text-emerald-800 tabular-nums">
                    {formatCurrency(dealer.earnings)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
