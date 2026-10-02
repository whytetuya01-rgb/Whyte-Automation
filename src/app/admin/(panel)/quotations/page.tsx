"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Quotation, QuotationStatus } from "@/types";
import { formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Pagination from "@/components/shared/Pagination";
import CustomDropdown, { DropdownOption } from "@/components/shared/CustomDropdown";
import { Trash2, ExternalLink, Search, RefreshCw, X, FileText } from "lucide-react";
import notify from "@/lib/notify";

const STATUSES: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "delivered", label: "Delivered" },
];

const STATUS_CHANGE_OPTIONS: DropdownOption[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "delivered", label: "Delivered" },
];

function QuotationsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read initial states from URL query parameters
  const initialPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const initialPageSize = Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10) || 10);
  const initialSearch = searchParams.get("search") || "";
  const initialStatus = searchParams.get("status") || "all";

  // Data states
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Pagination states
  const [page, setPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);

  // Filter states
  const [search, setSearch] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);

  // Loading & Action states
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const confirm = useConfirm();

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Synchronize URL parameters
  const updateUrl = useCallback(
    (newPage: number, newPageSize: number, newSearch: string, newStatus: string) => {
      const params = new URLSearchParams();
      if (newPage > 1) params.set("page", String(newPage));
      if (newPageSize !== 10) params.set("pageSize", String(newPageSize));
      if (newSearch.trim()) params.set("search", newSearch.trim());
      if (newStatus !== "all") params.set("status", newStatus);

      const query = params.toString();
      const targetUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(targetUrl, { scroll: false });
    },
    [pathname, router]
  );

  const hasLoadedRef = useRef(false);

  // Fetch paginated quotations from backend
  const fetchData = useCallback(
    async (
      targetPage: number,
      targetPageSize: number,
      targetSearch: string,
      targetStatus: string,
      isManualRefresh = false
    ) => {
      if (isManualRefresh) setRefreshing(true);
      else if (hasLoadedRef.current) setPageLoading(true);
      else setLoading(true);

      try {
        const queryParams = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(targetPageSize),
        });

        if (targetSearch.trim()) queryParams.set("search", targetSearch.trim());
        if (targetStatus !== "all") queryParams.set("status", targetStatus);

        const res = await fetch(`/api/quotations?${queryParams.toString()}`);
        if (res.status === 401) {
          router.replace("/admin/login");
          return;
        }

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to fetch quotations");
        }

        if (data?.data && data?.pagination) {
          setQuotations(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
          setPage(data.pagination.page);
        } else if (Array.isArray(data)) {
          setQuotations(data);
          setTotal(data.length);
          setTotalPages(1);
          setPage(1);
        }

        hasLoadedRef.current = true;

        if (isManualRefresh) {
          notify.success("Quotations refreshed", "Quotation records are up to date.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load quotations. Please try again.";
        notify.error("Unable to load quotations", msg);
      } finally {
        setLoading(false);
        setPageLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  // Initial load
  useEffect(() => {
    fetchData(initialPage, initialPageSize, initialSearch, initialStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstMount = useRef(true);
  const prevFiltersRef = useRef({
    search: initialSearch,
    status: initialStatus,
  });

  // When filters or search change, reset page to 1
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const prev = prevFiltersRef.current;
    const filtersChanged =
      prev.search !== debouncedSearch ||
      prev.status !== statusFilter;

    if (filtersChanged) {
      prevFiltersRef.current = {
        search: debouncedSearch,
        status: statusFilter,
      };
      setPage(1);
      updateUrl(1, pageSize, debouncedSearch, statusFilter);
      fetchData(1, pageSize, debouncedSearch, statusFilter);
    }
  }, [debouncedSearch, statusFilter, pageSize, updateUrl, fetchData]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setPage(newPage);
    updateUrl(newPage, pageSize, debouncedSearch, statusFilter);
    fetchData(newPage, pageSize, debouncedSearch, statusFilter);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    if (newPageSize === pageSize) return;
    setPageSize(newPageSize);
    setPage(1);
    updateUrl(1, newPageSize, debouncedSearch, statusFilter);
    fetchData(1, newPageSize, debouncedSearch, statusFilter);
  };

  const handleDelete = async (quotation: Quotation) => {
    await confirm({
      title: "Delete Quotation",
      message: `Delete quotation "${quotation.quotationNumber}" for ${quotation.clientName}?`,
      detail: "All rooms and items will be permanently deleted.",
      confirmText: "Delete Quotation",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/quotations/${quotation.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error();
          notify.success("Quotation deleted", "The quotation has been removed successfully.");
          fetchData(page, pageSize, debouncedSearch, statusFilter);
        } catch {
          notify.error("Unable to delete quotation", "Failed to delete quotation. Please try again.");
        }
      },
    });
  };

  const handleStatusChange = async (q: Quotation, targetStatus: QuotationStatus) => {
    if (q.status === targetStatus) return;

    try {
      let res: Response;
      if (q.status === "draft" && targetStatus === "sent") {
        res = await fetch(`/api/quotations/${q.id}/mark-sent`, { method: "POST" });
      } else if (q.status === "sent" && targetStatus === "approved") {
        res = await fetch(`/api/quotations/${q.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        });
      } else if (q.status === "sent" && targetStatus === "rejected") {
        res = await fetch(`/api/quotations/${q.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject" }),
        });
      } else if (q.status === "approved" && targetStatus === "delivered") {
        res = await fetch(`/api/quotations/${q.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deliver" }),
        });
      } else {
        notify.warning(
          "Invalid transition",
          `Cannot transition directly from ${q.status} to ${targetStatus}. Follow the lifecycle: Draft → Sent → Approved/Rejected → Delivered.`
        );
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Transition failed");
      }

      setQuotations((prev) =>
        prev.map((item) => (item.id === q.id ? { ...item, status: targetStatus } : item))
      );
      notify.success("Quotation updated", `Quotation status changed to ${targetStatus}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to update quotation status.";
      notify.error("Status update failed", msg);
    }
  };

  const hasActiveFilters = debouncedSearch.trim() !== "" || statusFilter !== "all";

  return (
    <div className="space-y-6 max-w-full">
      {/* ── Top Header Section ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
            Quotations
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            {total} total quotation{total !== 1 ? "s" : ""} recorded in system
          </p>
        </div>

        <button
          onClick={() => fetchData(page, pageSize, debouncedSearch, statusFilter, true)}
          disabled={refreshing || loading}
          className="h-10 px-3.5 border border-gray-200 rounded-xl flex items-center gap-2 hover:bg-gray-50 transition-colors text-gray-600 self-start sm:self-auto shadow-2xs text-xs font-semibold"
          title="Refresh quotations list"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin text-neutral-900" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ── Filter Toolbar ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status Tabs */}
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="flex gap-1 bg-admin-grey-light p-1 rounded-xl w-max sm:w-auto border border-admin-grey-border">
            {STATUSES.map((s) => {
              const isActive = statusFilter === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`relative px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? "bg-white text-neutral-950 shadow-2xs font-semibold"
                      : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
                  }`}
                >
                  <span>{s.label}</span>
                  {isActive && (
                    <span className="absolute bottom-1 left-2.5 right-2.5 h-0.5 bg-admin-primary rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by client name, quotation #, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-9 border border-admin-grey-border rounded-xl text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-admin-primary/20 focus:border-admin-primary transition-colors bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600 rounded-full hover:bg-neutral-100 transition-colors cursor-pointer"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Table & Cards Section ───────────────────────────────────── */}
      {loading ? (
        <div className="bg-white rounded-2xl p-12 border border-admin-grey-border shadow-xs flex flex-col items-center justify-center">
          <LoadingSpinner />
          <p className="mt-4 text-xs text-neutral-500">Loading quotations...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-xs border border-admin-grey-border overflow-hidden relative">
          {pageLoading && (
            <div className="absolute inset-x-0 top-0 h-1 bg-admin-primary/20 overflow-hidden z-10">
              <div className="w-1/3 h-full bg-admin-primary animate-pulse" />
            </div>
          )}

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-admin-grey-border bg-admin-grey-light/80 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <th className="px-4 py-3.5">QT Number</th>
                  <th className="px-4 py-3.5">Client</th>
                  <th className="px-4 py-3.5">Date</th>
                  <th className="px-4 py-3.5">Rooms</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-neutral-100 text-sm transition-opacity duration-150 ${pageLoading ? "opacity-60" : "opacity-100"
                  }`}
              >
                {quotations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="max-w-sm mx-auto flex flex-col items-center">
                        <div className="w-12 h-12 rounded-2xl bg-admin-primary-soft border border-admin-primary-border flex items-center justify-center text-admin-primary mb-3">
                          <FileText size={24} />
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-1">
                          No quotations found
                        </h3>
                        <p className="text-xs text-gray-500 mb-4">
                          {hasActiveFilters
                            ? "No quotations match your current search or status filter."
                            : "No quotations have been generated yet."}
                        </p>
                        {hasActiveFilters && (
                          <button
                            onClick={() => {
                              setSearch("");
                              setStatusFilter("all");
                            }}
                            className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  quotations.map((q) => (
                    <tr key={q.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-gray-900 text-sm">
                        {q.quotationNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900 text-sm">{q.clientName}</p>
                        {q.clientPhone && <p className="text-gray-400 text-xs mt-0.5">{q.clientPhone}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {formatDate(q.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-medium">
                          {q.rooms?.length ?? 0} room{(q.rooms?.length ?? 0) !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <CustomDropdown
                          value={q.status}
                          onChange={(val) => handleStatusChange(q, val as QuotationStatus)}
                          options={STATUS_CHANGE_OPTIONS}
                          ariaLabel="Change quotation status"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/quotation/${q.id}`}
                            className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                            title="Open quotation"
                          >
                            <ExternalLink size={16} />
                          </Link>
                          <button
                            onClick={() => handleDelete(q)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete quotation"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="md:hidden divide-y divide-gray-100">
            {quotations.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                No quotations found
              </div>
            ) : (
              quotations.map((q) => (
                <div key={q.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-semibold text-gray-900 text-sm">{q.quotationNumber}</p>
                      <p className="font-medium text-gray-800 text-sm truncate mt-0.5">{q.clientName}</p>
                      {q.clientPhone && <p className="text-gray-400 text-xs mt-0.5">{q.clientPhone}</p>}
                    </div>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded font-medium shrink-0">
                      {q.rooms?.length ?? 0} rooms
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-2">
                      <CustomDropdown
                        value={q.status}
                        onChange={(val) => handleStatusChange(q, val as QuotationStatus)}
                        options={STATUS_CHANGE_OPTIONS}
                        ariaLabel="Change quotation status"
                      />
                      <span className="text-[11px] text-gray-400">{formatDate(q.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/quotation/${q.id}`}
                        className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                      >
                        <ExternalLink size={16} />
                      </Link>
                      <button
                        onClick={() => handleDelete(q)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Server-Side Pagination Component ─────────────────────── */}
          {!loading && total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[10, 20, 25, 50, 100]}
              entityName="quotations"
              isLoading={pageLoading}
            />
          )}
        </div>
      )}

      {/* Delete confirmation is raised through the global ConfirmProvider portal. */}
    </div>
  );
}

export default function AdminQuotationsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-24 flex flex-col items-center justify-center">
          <LoadingSpinner />
          <p className="mt-4 text-sm text-gray-500">Loading quotations...</p>
        </div>
      }
    >
      <QuotationsPageContent />
    </Suspense>
  );
}
