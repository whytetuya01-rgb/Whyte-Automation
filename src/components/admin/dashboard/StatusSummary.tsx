import Link from "next/link";
import type { QuotationStatus } from "@/types";
import { STATUS_ORDER, STATUS_STYLE } from "./statusStyle";

/** Lifecycle breakdown of every quotation: one proportional bar plus a linked row per status. */
export default function StatusSummary({ counts, total }: { counts: Record<QuotationStatus, number>; total: number }) {
  if (total === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-[#111111]">No quotations yet</p>
        <p className="text-xs text-[#8A8A93] mt-1">The lifecycle breakdown appears once quotations exist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#F0F0F2]" role="img" aria-label="Quotation status distribution">
        {STATUS_ORDER.map((status) =>
          counts[status] > 0 ? (
            <span
              key={status}
              className="h-full"
              style={{ width: `${(counts[status] / total) * 100}%`, backgroundColor: STATUS_STYLE[status].color }}
              title={`${STATUS_STYLE[status].label}: ${counts[status]}`}
            />
          ) : null
        )}
      </div>

      <ul className="divide-y divide-[#F0F0F2]">
        {STATUS_ORDER.map((status) => {
          const count = counts[status];
          const percent = Math.round((count / total) * 100);
          return (
            <li key={status}>
              <Link
                href={`/admin/quotations?status=${status}`}
                className="flex items-center justify-between gap-3 py-2 text-sm hover:text-[#B83E68] transition-colors"
              >
                <span className="inline-flex items-center gap-2 text-[#111111]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_STYLE[status].color }} aria-hidden="true" />
                  {STATUS_STYLE[status].label}
                </span>
                <span className="inline-flex items-baseline gap-2 tabular-nums">
                  <span className="font-semibold text-[#111111]">{count}</span>
                  <span className="text-[11px] text-[#8A8A93] w-8 text-right">{percent}%</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between rounded-xl bg-[#F6F6F7] px-3 py-2 text-xs">
        <span className="text-[#5F5F68]">Total quotations</span>
        <span className="font-semibold text-[#111111] tabular-nums">{total}</span>
      </div>
    </div>
  );
}
