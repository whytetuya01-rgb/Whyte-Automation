import Link from "next/link";
import { ArrowUpRight, FileText, Plus } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { RecentQuotationRow } from "@/lib/adminDashboardData";
import { STATUS_STYLE } from "./statusStyle";

function StatusPill({ status }: { status: RecentQuotationRow["status"] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${STATUS_STYLE[status].badge}`}>
      {STATUS_STYLE[status].label}
    </span>
  );
}

/** Compact recent-quotations table (cards on small screens). Quotation numbers keep their links. */
export default function RecentQuotations({ rows }: { rows: RecentQuotationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-10 px-4 text-center">
        <span className="w-9 h-9 rounded-xl bg-[#FFF6F8] text-[#D85B83] inline-flex items-center justify-center mb-2">
          <FileText size={17} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-[#111111]">No quotations created yet</p>
        <p className="text-xs text-[#8A8A93] mt-0.5">New proposals will appear here as they are created.</p>
        <Link
          href="/quotation/new"
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors"
        >
          <Plus size={13} aria-hidden="true" />
          Create Quotation
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-medium text-[#8A8A93] border-y border-[#F0F0F2]">
              <th scope="col" className="pl-5 pr-3 py-2 font-medium">Quotation</th>
              <th scope="col" className="px-3 py-2 font-medium">Customer</th>
              <th scope="col" className="px-3 py-2 font-medium">Owner</th>
              <th scope="col" className="px-3 py-2 font-medium text-right">Amount</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="pr-5 pl-2 py-2 w-8"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F2] text-sm">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[#FFF6F8]/70 transition-colors">
                <td className="pl-5 pr-3 py-2.5 whitespace-nowrap">
                  <Link href={`/quotation/${row.id}`} className="font-mono text-xs font-semibold text-[#111111] hover:text-[#B83E68] hover:underline underline-offset-2">
                    {row.quotationNumber}
                  </Link>
                </td>
                <td className="px-3 py-2.5 max-w-[160px]">
                  <span className="block truncate text-[#111111]">{row.clientName}</span>
                </td>
                <td className="px-3 py-2.5 max-w-[200px]">
                  {row.ownerName ? (
                    <span className="block truncate text-[#5F5F68]">
                      {row.ownerName}
                      {row.ownerIsDealer && <span className="ml-1.5 text-[10px] font-medium text-[#B83E68]">Dealer</span>}
                    </span>
                  ) : (
                    <span className="text-[#C9C9D0]">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[#111111] whitespace-nowrap">
                  {formatCurrency(row.amount)}
                </td>
                <td className="px-3 py-2.5"><StatusPill status={row.status} /></td>
                <td className="px-3 py-2.5 text-xs text-[#8A8A93] whitespace-nowrap">{formatDate(row.createdAt)}</td>
                <td className="pr-5 pl-2 py-2.5">
                  <Link href={`/quotation/${row.id}`} aria-label={`Open ${row.quotationNumber}`} className="text-[#8A8A93] hover:text-[#B83E68] transition-colors">
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-[#F0F0F2] border-t border-[#F0F0F2]">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/quotation/${row.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#FFF6F8]/70 transition-colors">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-[#111111]">{row.quotationNumber}</p>
                <p className="text-sm text-[#111111] truncate">{row.clientName}</p>
                <p className="text-[11px] text-[#8A8A93] truncate">
                  {[row.ownerName, formatDate(row.createdAt)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <p className="font-mono text-xs tabular-nums text-[#111111]">{formatCurrency(row.amount)}</p>
                <StatusPill status={row.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
