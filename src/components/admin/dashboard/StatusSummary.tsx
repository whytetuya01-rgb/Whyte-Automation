import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { QuotationStatus } from "@/types";
import { STATUS_ORDER, STATUS_STYLE } from "./statusStyle";

/**
 * Executive Lifecycle Funnel Distribution widget.
 * Features proportional segmented bars, progress percentage meters, and clean interactive status rows.
 */
export default function StatusSummary({
  counts,
  total,
}: {
  counts: Record<QuotationStatus, number>;
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="py-8 text-center bg-[#F6F6F7]/60 rounded-xl border border-dashed border-[#E5E5E7] p-4">
        <p className="text-sm font-medium text-[#111111]">No quotations yet</p>
        <p className="text-xs text-[#8A8A93] mt-0.5">The lifecycle distribution appears once quotations are created.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Segmented Proportional Progress Bar */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#F0F0F2] p-0.5 gap-0.5"
        role="img"
        aria-label="Quotation status distribution"
      >
        {STATUS_ORDER.map((status) => {
          const count = counts[status];
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <span
              key={status}
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                backgroundColor: STATUS_STYLE[status].color,
              }}
              title={`${STATUS_STYLE[status].label}: ${count} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>

      {/* Status Itemized Rows */}
      <ul className="divide-y divide-[#F0F0F2] text-xs">
        {STATUS_ORDER.map((status) => {
          const count = counts[status];
          const percent = Math.round((count / total) * 100);
          return (
            <li key={status}>
              <Link
                href={`/admin/quotations?status=${status}`}
                className="group flex items-center justify-between gap-3 py-2 hover:bg-[#F6F6F7]/60 px-2 rounded-lg -mx-2 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: STATUS_STYLE[status].color }}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-[#111111] group-hover:text-black">
                    {STATUS_STYLE[status].label}
                  </span>
                </div>

                <div className="flex items-center gap-2.5 tabular-nums shrink-0">
                  <span className="font-semibold text-[#111111]">{count}</span>
                  <span className="text-[11px] text-[#8A8A93] w-9 text-right font-normal">
                    {percent}%
                  </span>
                  <ArrowUpRight
                    size={12}
                    className="text-[#8A8A93] group-hover:text-[#111111] opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer Total */}
      <div className="flex items-center justify-between rounded-xl bg-[#F6F6F7] px-3.5 py-2.5 text-xs border border-[#E5E5E7]">
        <span className="text-[#5F5F68] font-medium">Total Proposals in Pipeline</span>
        <span className="font-semibold text-[#111111] tabular-nums">{total}</span>
      </div>
    </div>
  );
}
