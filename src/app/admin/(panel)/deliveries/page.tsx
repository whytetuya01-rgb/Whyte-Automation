"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, Mail, MessageCircle, RefreshCw, Search, Send, X } from "lucide-react";
import { apiJson, notifyApiError, toErrorMessage } from "@/lib/apiClient";
import notify from "@/lib/notify";
import PageHeader from "@/components/admin/PageHeader";
import Pagination from "@/components/shared/Pagination";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import {
  DELIVERY_CHANNEL_LABELS,
  deliveryStatusLabel,
  type DeliveryChannelValue,
  type DeliveryStatusValue,
  type QuotationDeliveryDto,
} from "@/lib/quotationDeliveryShared";

type DeliveryRow = QuotationDeliveryDto & { quotation: { id: string; quotationNumber: string; clientName: string; status: string } | null };

interface Summary {
  total: number;
  viewed: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface SetupStatus {
  email: { configured: boolean };
  webhook: { configured: boolean; url: string | null; lastReportAt: string | null; waitingOverAnHour: number };
  links: { appUrl: string | null; publicAppUrl: boolean; canCopyAgain: boolean };
}

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Sending" },
  { value: "sent", label: "Sent / Shared" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read / Viewed" },
  { value: "failed", label: "Failed" },
];

const CHANNEL_OPTIONS = [
  { value: "all", label: "All channels" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
];

const STATUS_BADGE: Record<DeliveryStatusValue, string> = {
  queued: "bg-gray-100 text-gray-700 border-gray-200",
  sent: "bg-sky-50 text-sky-800 border-sky-200",
  delivered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  read: "bg-violet-50 text-violet-800 border-violet-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const CHANNEL_ICON: Record<DeliveryChannelValue, React.ElementType> = { email: Mail, whatsapp: MessageCircle };

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const recipientOf = (row: DeliveryRow) => (row.channel === "whatsapp" ? `+${row.recipient}` : row.recipient);

const viewsOf = (row: DeliveryRow) =>
  row.link.state === "none" ? "—" : row.link.viewCount === 0 ? "Not opened" : `${row.link.viewCount} · ${formatDateTime(row.link.lastViewedAt)}`;

function SetupCheck({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5" data-testid="setup-check" data-ok={ok}>
      {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Working" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-label="Needs attention" />}
      <div className="min-w-0 text-xs text-gray-600">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Every quotation the company sent (email and WhatsApp) with where it stands — sent, delivered, viewed or failed —
 * plus a setup check that tells an admin whether delivery tracking is fully working.
 */
export default function DeliveriesPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [viewedOnly, setViewedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchData = useCallback(
    async (targetPage = page, isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else if (!hasLoadedRef.current) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (channelFilter !== "all") params.set("channel", channelFilter);
        if (viewedOnly) params.set("viewed", "1");
        const result = await apiJson.get<{ data: DeliveryRow[]; pagination: { page: number; totalPages: number; total: number }; summary: Summary }>(
          `/api/deliveries?${params.toString()}`
        );
        setRows(result.data);
        setSummary(result.summary);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setPage(result.pagination.page);
        setError(null);
        hasLoadedRef.current = true;
      } catch (err: unknown) {
        setError(toErrorMessage(err, "Failed to load deliveries."));
        if (hasLoadedRef.current) notifyApiError(err, "Unable to load deliveries", "Failed to load deliveries.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, pageSize, debouncedSearch, statusFilter, channelFilter, viewedOnly]
  );

  useEffect(() => {
    void fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, channelFilter, viewedOnly, pageSize]);

  useEffect(() => {
    apiJson
      .get<SetupStatus>("/api/deliveries/setup")
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  const hasActiveFilters = debouncedSearch.trim() !== "" || statusFilter !== "all" || channelFilter !== "all" || viewedOnly;
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setChannelFilter("all");
    setViewedOnly(false);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify.success("Copied", what);
    } catch {
      notify.error("Could not copy", text);
    }
  };

  const tiles: Array<{ label: string; value: number | undefined; onClick: () => void; active: boolean }> = [
    { label: "Sent", value: summary?.total, onClick: clearFilters, active: !hasActiveFilters },
    { label: "Viewed by client", value: summary?.viewed, onClick: () => { setStatusFilter("all"); setViewedOnly(true); }, active: viewedOnly && statusFilter === "all" },
    { label: "Delivered", value: summary?.delivered, onClick: () => { setViewedOnly(false); setStatusFilter("delivered"); }, active: !viewedOnly && statusFilter === "delivered" },
    { label: "Failed", value: summary?.failed, onClick: () => { setViewedOnly(false); setStatusFilter("failed"); }, active: !viewedOnly && statusFilter === "failed" },
  ];

  const webhookWorking = Boolean(setup?.webhook.configured && setup.webhook.waitingOverAnHour === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliveries"
        icon={Send}
        subtitle="Every quotation sent by email or WhatsApp — sent, delivered, viewed by the client, or failed."
        actions={
          <button
            type="button"
            onClick={() => void fetchData(page, true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-xs transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        }
      />

      {error && summary === null ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-medium text-amber-800">
          {error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="delivery-summary">
            {tiles.map((tile) => (
              <button
                key={tile.label}
                type="button"
                onClick={tile.onClick}
                aria-pressed={tile.active}
                className={cn(
                  "rounded-2xl border bg-white p-4 text-left transition hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  tile.active ? "border-gray-900" : "border-gray-200"
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{tile.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{tile.value ?? "–"}</p>
              </button>
            ))}
          </div>

          {setup && (
            <section aria-label="Delivery tracking setup" className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="delivery-setup">
              <h2 className="mb-3 text-sm font-bold text-gray-900">Tracking setup</h2>
              <ul className="grid gap-3 md:grid-cols-3">
                <SetupCheck ok={setup.email.configured} title="Email sending">
                  {setup.email.configured ? "Quotations can be emailed." : "Email is not set up, so emailed quotations fail. WhatsApp sharing still works."}
                </SetupCheck>
                <SetupCheck ok={webhookWorking} title="Delivery reports">
                  {!setup.webhook.configured ? (
                    <>Delivered / read updates need the email service&apos;s webhook. Add it with this address and set its signing secret on the server.</>
                  ) : setup.webhook.waitingOverAnHour > 0 ? (
                    <>{setup.webhook.waitingOverAnHour} email{setup.webhook.waitingOverAnHour === 1 ? " has" : "s have"} had no delivery report for over an hour. Check the webhook address in the email service.</>
                  ) : setup.webhook.lastReportAt ? (
                    <>Last report {formatDateTime(setup.webhook.lastReportAt)}.</>
                  ) : (
                    <>Set up. Reports appear after the next email is delivered.</>
                  )}
                  {setup.webhook.url && (
                    <button type="button" onClick={() => void copy(setup.webhook.url as string, "Webhook address copied.")} className="mt-1 flex max-w-full items-center gap-1 font-mono text-[11px] text-gray-700 hover:underline">
                      <Copy size={11} className="shrink-0" aria-hidden /> <span className="truncate">{setup.webhook.url}</span>
                    </button>
                  )}
                </SetupCheck>
                <SetupCheck ok={setup.links.publicAppUrl} title="View links">
                  {setup.links.publicAppUrl ? (
                    <>Clients open quotations at {setup.links.appUrl}. Opening one marks it &ldquo;Viewed&rdquo;.</>
                  ) : (
                    <>Links point at {setup.links.appUrl ?? "an unset address"}, which clients cannot open. Set the app&apos;s public https address on the server.</>
                  )}
                </SetupCheck>
              </ul>
            </section>
          )}

          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by recipient, quotation number, or client..."
                aria-label="Search deliveries"
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-9 text-sm text-gray-800 transition placeholder:text-gray-400 hover:bg-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Select ariaLabel="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} triggerClassName="h-10 text-xs" />
              <Select ariaLabel="Filter by channel" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} options={CHANNEL_OPTIONS} triggerClassName="h-10 text-xs" />
              <label className="flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-700">
                <input type="checkbox" checked={viewedOnly} onChange={(e) => setViewedOnly(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                Only opened by the client
              </label>
            </div>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-accent hover:underline">
                Clear all filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-20">
              <LoadingSpinner />
            </div>
          ) : rows.length === 0 ? (
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-400">
              <Send size={28} className="mx-auto text-gray-300" />
              <p className="text-sm font-semibold text-gray-700">No deliveries found</p>
              <p className="text-xs">{hasActiveFilters ? "Try adjusting or clearing your filters." : "Quotations sent by email or WhatsApp appear here."}</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white md:block">
                <table className="w-full text-left text-sm" data-testid="deliveries-table">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/80 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Quotation</th>
                      <th className="px-4 py-3">Sent to</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Client views</th>
                      <th className="w-10 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row) => {
                      const ChannelIcon = CHANNEL_ICON[row.channel];
                      return (
                        <tr key={row.id} className="transition-colors hover:bg-gray-50/50" data-testid="deliveries-row" data-status={row.status}>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                            {formatDateTime(row.createdAt)}
                            {row.createdByName && <p className="mt-0.5 font-sans text-[11px] text-gray-400">by {row.createdByName}</p>}
                          </td>
                          <td className="px-4 py-3">
                            {row.quotation ? (
                              <>
                                <span className="font-mono text-xs font-semibold text-gray-900">{row.quotation.quotationNumber}</span>
                                <p className="mt-0.5 text-[11px] text-gray-400">{row.quotation.clientName}</p>
                              </>
                            ) : (
                              <span className="text-xs italic text-gray-400">Quotation deleted</span>
                            )}
                          </td>
                          <td className="max-w-[16rem] px-4 py-3">
                            <span className="flex items-center gap-1.5 text-xs text-gray-800">
                              <ChannelIcon size={13} className="shrink-0 text-gray-500" aria-label={DELIVERY_CHANNEL_LABELS[row.channel]} />
                              <span className="truncate">{recipientOf(row)}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold", STATUS_BADGE[row.status])}>{deliveryStatusLabel(row)}</span>
                            {row.status === "failed" && row.lastError && <p className="mt-1 max-w-xs text-[11px] text-red-700">{row.lastError.message}</p>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            <span className="inline-flex items-center gap-1">
                              <Eye size={12} className="text-gray-400" aria-hidden /> {viewsOf(row)}
                            </span>
                            {row.link.state === "expired" && <p className="text-[11px] text-amber-700">Link expired</p>}
                            {row.link.state === "revoked" && <p className="text-[11px] text-gray-400">Link switched off</p>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.quotation && (
                              <Link href={`/quotation/${row.quotation.id}`} className="text-gray-400 transition hover:text-gray-900" title="Open quotation" aria-label={`Open quotation ${row.quotation.quotationNumber}`}>
                                <ExternalLink size={15} />
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2.5 md:hidden">
                {rows.map((row) => {
                  const ChannelIcon = CHANNEL_ICON[row.channel];
                  return (
                    <div key={row.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-testid="deliveries-card">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
                          <ChannelIcon size={14} className="shrink-0 text-gray-500" aria-label={DELIVERY_CHANNEL_LABELS[row.channel]} />
                          <span className="truncate">{recipientOf(row)}</span>
                        </span>
                        <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold", STATUS_BADGE[row.status])}>{deliveryStatusLabel(row)}</span>
                      </div>
                      <p className="text-[11px] text-gray-500">
                        {formatDateTime(row.createdAt)} · <Eye size={11} className="inline" aria-hidden /> {viewsOf(row)}
                      </p>
                      {row.quotation ? (
                        <Link href={`/quotation/${row.quotation.id}`} className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                          <span className="min-w-0 truncate text-xs">
                            <span className="font-mono font-semibold text-gray-900">{row.quotation.quotationNumber}</span>
                            <span className="text-gray-400"> · {row.quotation.clientName}</span>
                          </span>
                          <ExternalLink size={13} className="shrink-0 text-gray-400" />
                        </Link>
                      ) : (
                        <p className="border-t border-gray-100 pt-2 text-[11px] italic text-gray-400">Quotation deleted</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <Pagination
                currentPage={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={(p) => void fetchData(p)}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                entityName="deliveries"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
