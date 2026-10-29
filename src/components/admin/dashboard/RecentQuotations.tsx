import Link from "next/link";
import { ArrowUpRight, FileText, Plus } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { RecentQuotationRow } from "@/lib/adminDashboardData";
import { STATUS_STYLE } from "./statusStyle";

function StatusPill({ status }: { status: RecentQuotationRow["status"] }) {
  const meta = STATUS_STYLE[status] ?? {
    label: status,
    badge: "bg-[#F6F6F7] text-[#5F5F68] border-[#E5E5E7]",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium border whitespace-nowrap tracking-tight transition-colors ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

/** Luxury audit-log recent quotations table with clean responsive card fallback */
export default function RecentQuotations({ rows }: { rows: RecentQuotationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-12 px-4 text-center">
        <span className="w-10 h-10 rounded-xl bg-[#F6F6F7] text-[#8A8A93] inline-flex items-center justify-center mb-2.5 border border-[#E5E5E7]">
          <FileText size={18} aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-[#111111]">No quotations created yet</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-xs mx-auto">
          Proposals created by your sales executives or dealer network will appear here automatically.
        </p>
        <Link
          href="/quotation/new"
          className="inline-flex items-center gap-1.5 mt-4 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors shadow-2xs"
        >
          <Plus size={13} aria-hidden="true" />
          Create First Quotation
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] font-semibold text-[#8A8A93] tracking-wider uppercase border-y border-[#F0F0F2] bg-[#FAFAFA]/75">
              <th scope="col" className="pl-5 pr-3 py-2.5 font-semibold">Reference</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Client / Project</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Creator</th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-right">Value (INR)</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Issued Date</th>
              <th scope="col" className="pr-5 pl-2 py-2.5 w-8">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F2] text-xs">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="group hover:bg-[#F6F6F7]/70 transition-colors"
              >
                <td className="pl-5 pr-3 py-3 whitespace-nowrap">
                  <Link
                    href={`/quotation/${row.id}`}
                    className="inline-flex items-center font-mono text-xs font-semibold text-[#111111] group-hover:text-[var(--color-admin-primary-foreground,#B83E68)] transition-colors"
                  >
                    <span>{row.quotationNumber}</span>
                  </Link>
                </td>
                <td className="px-3 py-3 max-w-[180px]">
                  <span className="block truncate font-medium text-[#111111]">
                    {row.clientName || "Unnamed Client"}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-[200px]">
                  {row.ownerName ? (
                    <span className="inline-flex items-center gap-1.5 text-[#5F5F68] truncate">
                      <span className="truncate">{row.ownerName}</span>
                      {row.ownerIsDealer && (
                        <span className="shrink-0 text-[9.5px] font-semibold uppercase px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200">
                          Dealer
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[#C9C9D0]">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums font-semibold text-[#111111] whitespace-nowrap">
                  {formatCurrency(row.amount)}
                </td>
                <td className="px-3 py-3">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-3 py-3 text-xs text-[#8A8A93] whitespace-nowrap">
                  {formatDate(row.createdAt)}
                </td>
                <td className="pr-5 pl-2 py-3 text-right">
                  <Link
                    href={`/quotation/${row.id}`}
                    aria-label={`Open quotation ${row.quotationNumber}`}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[#8A8A93] group-hover:text-[#111111] group-hover:bg-[#E5E5E7]/50 transition-colors"
                  >
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <ul className="md:hidden divide-y divide-[#F0F0F2] border-t border-[#F0F0F2]">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/quotation/${row.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-[#F6F6F7]/80 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[#111111]">
                    {row.quotationNumber}
                  </span>
                  <StatusPill status={row.status} />
                </div>
                <p className="text-xs font-medium text-[#111111] truncate">
                  {row.clientName || "Unnamed Client"}
                </p>
                <p className="text-[11px] text-[#8A8A93] truncate">
                  {[row.ownerName, formatDate(row.createdAt)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-xs font-semibold tabular-nums text-[#111111]">
                  {formatCurrency(row.amount)}
                </p>
                <div className="inline-flex items-center text-[11px] text-[var(--color-admin-primary-foreground,#B83E68)] font-medium mt-1">
                  View <ArrowUpRight size={11} className="ml-0.5" />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
