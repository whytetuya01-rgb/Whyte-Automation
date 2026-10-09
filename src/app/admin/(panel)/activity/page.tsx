"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Activity,
  Search,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  UserCog,
  Store,
  Calendar,
  X,
} from "lucide-react";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import Pagination from "@/components/shared/Pagination";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import StatusBadge from "@/components/shared/StatusBadge";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Select } from "@/components/ui/Select";
import { QuotationStatus } from "@/types";

type AuditAction =
  | "quotation_created"
  | "quotation_assigned"
  | "quotation_reassigned"
  | "quotation_unassigned"
  | "quotation_cloned"
  | "status_changed"
  | "quotation_approved"
  | "quotation_rejected"
  | "quotation_delivered";

interface ActivityEvent {
  id: string;
  action: AuditAction;
  performedBy: number;
  performedByName: string | null;
  performedByRole: "super_admin" | "admin" | "dealer" | "sales" | null;
  performedOn: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  quotation: { id: string; quotationNumber: string; clientName: string; status: QuotationStatus } | null;
}

interface Actor {
  id: number;
  name: string;
  role: "super_admin" | "admin" | "dealer";
  isActive: boolean;
}

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "quotation_created", label: "Created" },
  { value: "quotation_assigned", label: "Assigned" },
  { value: "quotation_reassigned", label: "Reassigned" },
  { value: "quotation_unassigned", label: "Unassigned" },
  { value: "quotation_cloned", label: "Cloned" },
  { value: "status_changed", label: "Status Changed" },
  { value: "quotation_approved", label: "Approved" },
  { value: "quotation_rejected", label: "Rejected" },
  { value: "quotation_delivered", label: "Delivered" },
];

const ROLE_OPTIONS = [
  { value: "all", label: "All Roles" },
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "dealer", label: "Dealer" },
];

const ROLE_BADGE: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  super_admin: { label: "Super Admin", className: "bg-accent-light text-accent-foreground border-accent-border/60", Icon: ShieldCheck },
  admin: { label: "Admin", className: "bg-neutral-100 text-neutral-700 border-neutral-200", Icon: UserCog },
  dealer: { label: "Dealer", className: "bg-blue-50 text-blue-700 border-blue-200/80", Icon: Store },
};

function readText(obj: Record<string, unknown> | null, key: string): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : "";
}
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Actor-first, human-readable description of a single audit event. */
function describeActivity(event: ActivityEvent): string {
  const previousDealer = readText(event.previousValue, "dealerName");
  const nextDealer = readText(event.newValue, "dealerName");

  switch (event.action) {
    case "quotation_created":
      return "Created this quotation";
    case "quotation_cloned": {
      const source = readText(event.metadata, "clonedFromQuotationNumber");
      return `Cloned this quotation${source ? ` from ${source}` : ""}`;
    }
    case "quotation_assigned":
      return `Assigned this quotation to ${nextDealer || "a dealer"}`;
    case "quotation_reassigned":
      return `Reassigned this quotation from ${previousDealer || "a dealer"} to ${nextDealer || "a dealer"}`;
    case "quotation_unassigned":
      return `Unassigned this quotation from ${previousDealer || "the dealer"}`;
    case "status_changed":
      return `Changed status ${capitalize(readText(event.previousValue, "status"))} → ${capitalize(readText(event.newValue, "status"))}`;
    case "quotation_approved":
      return "Approved this quotation";
    case "quotation_rejected":
      return "Rejected this quotation";
    case "quotation_delivered":
      return "Marked this quotation as delivered";
    default:
      return "Updated this quotation";
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function ActivityLogPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
        if (actionFilter !== "all") params.set("action", actionFilter);
        if (roleFilter !== "all") params.set("actorRole", roleFilter);
        if (actorFilter !== "all") params.set("actorId", actorFilter);
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);

        const result = await apiJson.get<{
          data: ActivityEvent[];
          pagination: { page: number; totalPages: number; total: number };
          actors: Actor[];
        }>(`/api/admin/activity?${params.toString()}`);

        setEvents(result.data);
        setActors(result.actors);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setPage(result.pagination.page);
        hasLoadedRef.current = true;
      } catch (err: unknown) {
        notifyApiError(err, "Unable to load activity", "Failed to load the activity log.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, pageSize, debouncedSearch, actionFilter, roleFilter, actorFilter, startDate, endDate]
  );

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, actionFilter, roleFilter, actorFilter, startDate, endDate, pageSize]);

  const hasActiveFilters =
    debouncedSearch.trim() !== "" ||
    actionFilter !== "all" ||
    roleFilter !== "all" ||
    actorFilter !== "all" ||
    Boolean(startDate) ||
    Boolean(endDate);

  const clearFilters = () => {
    setSearch("");
    setActionFilter("all");
    setRoleFilter("all");
    setActorFilter("all");
    setStartDate("");
    setEndDate("");
  };

  const actorOptions = [
    { value: "all", label: "All People" },
    ...actors.map((a) => ({
      value: String(a.id),
      label: `${a.name}${a.isActive ? "" : " (inactive)"}`,
      badge: ROLE_BADGE[a.role]?.label,
    })),
  ];

  if (role && role !== "super_admin") {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-2">
        <ShieldCheck size={32} className="mx-auto text-gray-300" />
        <h1 className="text-lg font-bold text-gray-900">Super Admin Only</h1>
        <p className="text-sm text-gray-500">
          The activity log is restricted to Super Admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Activity size={22} className="text-accent" />
            Activity Log
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Every dealer and admin action across every quotation — created, assigned, approved, rejected, delivered.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchData(page, true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person, quotation number, or client..."
            className="w-full h-10 pl-9 pr-9 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent bg-gray-50/50 hover:bg-white transition"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Select
            ariaLabel="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            options={ACTION_OPTIONS}
            triggerClassName="h-10 text-xs"
          />
          <Select
            ariaLabel="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={ROLE_OPTIONS}
            triggerClassName="h-10 text-xs"
          />
          <SearchableSelect
            ariaLabel="Filter by person"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            options={actorOptions}
            searchPlaceholder="Search people..."
            emptyText="No one matches"
            triggerClassName="h-10 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || undefined}
                aria-label="Start date"
                className="w-full h-10 pl-7 pr-2 border border-gray-200 rounded-xl text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent bg-white"
              />
            </div>
            <span className="text-gray-300 text-xs">–</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              aria-label="End date"
              className="flex-1 h-10 px-2 border border-gray-200 rounded-xl text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent bg-white"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="py-20">
          <LoadingSpinner />
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 space-y-2">
          <Activity size={28} className="mx-auto text-gray-300" />
          <p className="text-sm font-semibold text-gray-700">No activity found</p>
          <p className="text-xs">
            {hasActiveFilters ? "Try adjusting or clearing your filters." : "Nothing has happened yet."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                  <th className="py-3 px-4">When</th>
                  <th className="py-3 px-4">Who</th>
                  <th className="py-3 px-4">What</th>
                  <th className="py-3 px-4">Quotation</th>
                  <th className="py-3 px-4 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((event) => {
                  const roleBadge = event.performedByRole ? ROLE_BADGE[event.performedByRole] : null;
                  return (
                    <tr key={event.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap font-mono">
                        {formatDateTime(event.performedOn)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-sm">
                            {event.performedByName || "Unknown"}
                          </span>
                          {roleBadge && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleBadge.className}`}
                            >
                              <roleBadge.Icon size={10} />
                              {roleBadge.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-700 text-xs max-w-sm">{describeActivity(event)}</td>
                      <td className="py-3 px-4">
                        {event.quotation ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-gray-900">
                              {event.quotation.quotationNumber}
                            </span>
                            <StatusBadge status={event.quotation.status} />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Quotation deleted</span>
                        )}
                        {event.quotation && (
                          <p className="text-[11px] text-gray-400 mt-0.5">{event.quotation.clientName}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {event.quotation && (
                          <Link
                            href={`/quotation/${event.quotation.id}`}
                            className="text-gray-400 hover:text-gray-900 transition"
                            title="Open quotation"
                          >
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

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {events.map((event) => {
              const roleBadge = event.performedByRole ? ROLE_BADGE[event.performedByRole] : null;
              return (
                <div key={event.id} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-gray-900 text-sm truncate">
                        {event.performedByName || "Unknown"}
                      </span>
                      {roleBadge && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${roleBadge.className}`}
                        >
                          <roleBadge.Icon size={10} />
                          {roleBadge.label}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono shrink-0">
                      {formatDateTime(event.performedOn)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700">{describeActivity(event)}</p>
                  {event.quotation ? (
                    <Link
                      href={`/quotation/${event.quotation.id}`}
                      className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-gray-900">
                          {event.quotation.quotationNumber}
                        </span>
                        <StatusBadge status={event.quotation.status} />
                      </div>
                      <ExternalLink size={13} className="text-gray-400 shrink-0" />
                    </Link>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic pt-2 border-t border-gray-100">
                      Quotation deleted
                    </p>
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
            onPageChange={(p) => fetchData(p)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            entityName="events"
          />
        </>
      )}
    </div>
  );
}
