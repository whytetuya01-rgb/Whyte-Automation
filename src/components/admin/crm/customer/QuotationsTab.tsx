"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FilePlus2, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { cn, formatCurrency } from "@/lib/utils";
import { filterQuotations, type QuotationSort } from "@/lib/crmCustomerInsights";
import type { CustomerProfile } from "@/types/crm";
import { EmptyState, QUOTATION_STATUS_STYLE, QuotationStatusBadge, formatDate } from "./shared";

interface Props {
  quotations: CustomerProfile["quotations"];
  statusCounts: Record<string, number>;
  newQuotationUrl: string;
}

const STATUS_ORDER = ["draft", "sent", "approved", "delivered", "rejected"];
/** An approved or delivered quotation is locked: it can be viewed, not edited. */
const isLocked = (status: string) => status === "approved" || status === "delivered";

export default function QuotationsTab({ quotations, statusCounts, newQuotationUrl }: Props) {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<QuotationSort>("newest");

  const rows = useMemo(() => filterQuotations(quotations, { status, search, sort }), [quotations, status, search, sort]);
  const total = rows.reduce((sum, q) => sum + (q.grandTotal || 0), 0);
  const filters = ["all", ...STATUS_ORDER.filter((s) => statusCounts[s])];

  if (quotations.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-xs">
        <EmptyState
          icon={FileText}
          title="No quotations yet"
          text="This customer does not have any proposals linked yet."
          action={
            <Link href={newQuotationUrl} className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-950 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800">
              <FilePlus2 size={14} aria-hidden="true" />
              Create first quotation
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xs" data-testid="quotations-tab">
      <div className="space-y-3 border-b border-neutral-100 p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {filters.map((id) => {
            const count = id === "all" ? quotations.length : statusCounts[id] ?? 0;
            const active = status === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setStatus(id)}
                aria-pressed={active}
                data-testid={`quotation-filter-${id}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                )}
              >
                {id === "all" ? "All" : QUOTATION_STATUS_STYLE[id]?.label ?? id}
                <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/20" : "bg-neutral-100 text-neutral-600")}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search quotation number" aria-label="Search quotations" leftIcon={<Search size={14} />} className="text-xs" />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-neutral-500">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as QuotationSort)}
              aria-label="Sort quotations"
              className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="value_desc">Highest value</option>
              <option value="value_asc">Lowest value</option>
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Search} title="No quotation matches" text="Try another status or search term." />
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full text-left text-sm" data-testid="quotations-table">
              <thead className="bg-neutral-50/70 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Quotation</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3 text-right">Grand total</th>
                  <th scope="col" className="px-5 py-3 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((q) => (
                  <tr key={q.id} className="group transition hover:bg-neutral-50/60" data-testid="quotation-row">
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <Link href={`/quotation/${q.id}/preview`} className="inline-flex items-center gap-1.5 font-mono font-bold text-neutral-950 transition hover:text-accent">
                        {q.quotationNumber}
                        <ExternalLink size={12} className="opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5"><QuotationStatusBadge status={q.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs text-neutral-500">{formatDate(q.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-bold text-neutral-950">{formatCurrency(q.grandTotal || 0)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/quotation/${q.id}/preview`} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200">
                          View proposal
                        </Link>
                        {!isLocked(q.status) && (
                          <Link href={`/quotation/${q.id}`} className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-neutral-800">
                            Edit
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-neutral-100 md:hidden" data-testid="quotations-cards">
            {rows.map((q) => (
              <li key={q.id} className="space-y-2.5 p-4" data-testid="quotation-card">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/quotation/${q.id}/preview`} className="font-mono text-sm font-bold text-neutral-950">
                    {q.quotationNumber}
                  </Link>
                  <QuotationStatusBadge status={q.status} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-neutral-950">{formatCurrency(q.grandTotal || 0)}</p>
                    <p className="text-xs text-neutral-400">{formatDate(q.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/quotation/${q.id}/preview`} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700">
                      View
                    </Link>
                    {!isLocked(q.status) && (
                      <Link href={`/quotation/${q.id}`} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">
                        Edit
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50/70 px-5 py-3 text-xs">
            <span className="font-medium text-neutral-500">
              {rows.length} {rows.length === 1 ? "quotation" : "quotations"}
              {status !== "all" || search ? " shown" : ""}
            </span>
            <span className="font-bold text-neutral-900" data-testid="quotations-total">Total {formatCurrency(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
