"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Wallet,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Calendar,
  ArrowRight,
  Info,
  ChevronRight,
  Calculator,
  ShieldCheck,
  Tag,
  Receipt,
  X,
  ExternalLink,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import Pagination from "@/components/shared/Pagination";
import Modal from "@/components/shared/Modal";
import { Select } from "@/components/ui";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { QuotationStatus } from "@/types";

interface QuotationEarningsItem {
  id: string;
  quotationNumber: string;
  clientName: string;
  createdAt: string;
  status: QuotationStatus;
  subtotal: number;
  customerDiscountPercent: number;
  customerDiscountAmount: number;
  netQuotationValue: number;
  allocatedDiscountPercent: number;
  dealerCommissionPercent: number;
  estimatedCommissionAmount: number;
  confirmedCommissionAmount: number;
  isConfirmed: boolean;
  discountType: string | null;
  discountValue: number | null;
}

interface EarningsSummary {
  totalQuotationValue: number;
  totalCustomerDiscount: number;
  estimatedCommission: number;
  confirmedEarnings: number;
  totalQuotations: number;
  approvedCount: number;
  deliveredCount: number;
  sentCount: number;
  draftCount: number;
  rejectedCount: number;
}

interface DealerInfo {
  id: number;
  name: string;
  email: string;
  discountAllocationPercent: number;
}

export default function DealerEarningsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [quotations, setQuotations] = useState<QuotationEarningsItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });

  // Filter states
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Calculation Breakdown Modal
  const [selectedQuote, setSelectedQuote] = useState<QuotationEarningsItem | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated" && role && role !== "dealer") {
      router.replace("/admin/dashboard");
      return;
    }
  }, [status, role, router]);

  const fetchEarnings = useCallback(
    async (targetPage = pagination.page, targetPageSize = pagination.pageSize) => {
      try {
        setError(null);
        if (!refreshing) setLoading(true);

        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(targetPageSize),
        });

        if (search.trim()) params.set("search", search.trim());
        if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);

        const res = await fetch(`/api/dealer/earnings?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Unable to load earnings data. Please try again.");
        }

        const data = await res.json();
        setSummary(data.summary || null);
        setDealer(data.dealer || null);
        setQuotations(data.quotations || []);
        setPagination({
          page: data.pagination?.page || targetPage,
          pageSize: data.pagination?.pageSize || targetPageSize,
          total: data.pagination?.total || 0,
          totalPages: data.pagination?.totalPages || 1,
        });
      } catch (err: any) {
        setError(err.message || "Failed to load earnings.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, statusFilter, startDate, endDate, pagination.page, pagination.pageSize, refreshing]
  );

  useEffect(() => {
    if (status === "authenticated" && role === "dealer") {
      fetchEarnings(1, pagination.pageSize);
    }
  }, [status, role, search, statusFilter, startDate, endDate]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEarnings(pagination.page, pagination.pageSize);
  };

  const handleResetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setStartDate("");
    setEndDate("");
  };

  const hasActiveFilters = useMemo(() => {
    return Boolean(search.trim() || statusFilter !== "all" || startDate || endDate);
  }, [search, statusFilter, startDate, endDate]);

  return (
    <div className="space-y-6 pb-12">
      {/* ── Top Header & Context ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 md:p-6 rounded-2xl border border-gray-150 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center shrink-0">
              <Wallet size={20} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-950">
                Dealer Earnings
              </h1>
              <p className="text-xs md:text-sm text-gray-500">
                Authoritative overview of your quotation values, customer discounts, and earned dealer commissions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {dealer && (
            <div className="px-3.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700">
              Allocated Margin Cap:{" "}
              <span className="font-bold text-gray-950">{dealer.discountAllocationPercent}%</span>
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
            title="Refresh dashboard"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin text-black" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchEarnings()}
            className="text-xs font-semibold underline hover:no-underline text-red-900 cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── 4 Top Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Quotation Value */}
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs hover:border-gray-300 transition flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Quotation Value
            </span>
            <div className="p-2 bg-blue-50 text-blue-700 rounded-xl shrink-0">
              <FileSpreadsheet size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl md:text-3xl font-extrabold text-gray-950 tracking-tight">
              {loading && !summary ? (
                <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                formatCurrency(summary?.totalQuotationValue || 0)
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
              <span>Customer-discounted net quotation total</span>
            </p>
          </div>
        </div>

        {/* Card 2: Total Customer Discount */}
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs hover:border-gray-300 transition flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Customer Discount
            </span>
            <div className="p-2 bg-purple-50 text-purple-700 rounded-xl shrink-0">
              <Tag size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl md:text-3xl font-extrabold text-purple-900 tracking-tight">
              {loading && !summary ? (
                <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                formatCurrency(summary?.totalCustomerDiscount || 0)
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
              <span>Savings granted to clients from your allocation</span>
            </p>
          </div>
        </div>

        {/* Card 3: Estimated Commission */}
        <div className="bg-white p-5 rounded-2xl border border-amber-200/80 shadow-xs hover:border-amber-300 transition flex flex-col justify-between bg-gradient-to-br from-white to-amber-50/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                Estimated Commission
              </span>
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                Pending
              </span>
            </div>
            <div className="p-2 bg-amber-50 text-amber-700 rounded-xl shrink-0">
              <Clock size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl md:text-3xl font-extrabold text-amber-900 tracking-tight">
              {loading && !summary ? (
                <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                formatCurrency(summary?.estimatedCommission || 0)
              )}
            </div>
            <p className="mt-1 text-xs text-amber-700/80">
              Estimated across active quotations prior to approval
            </p>
          </div>
        </div>

        {/* Card 4: Confirmed Earnings */}
        <div className="bg-white p-5 rounded-2xl border border-emerald-200/80 shadow-xs hover:border-emerald-300 transition flex flex-col justify-between bg-gradient-to-br from-white to-emerald-50/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wider">
                Confirmed Earnings
              </span>
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                Unlocked
              </span>
            </div>
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl shrink-0">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl md:text-3xl font-extrabold text-emerald-950 tracking-tight">
              {loading && !summary ? (
                <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                formatCurrency(summary?.confirmedEarnings || 0)
              )}
            </div>
            <p className="mt-1 text-xs text-emerald-700/90 font-medium">
              Earned from Approved & Delivered quotations
            </p>
          </div>
        </div>
      </div>

      {/* ── Filters & Search Control Bar ── */}
      <div className="bg-white p-4 rounded-2xl border border-gray-150 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search */}
          <div className="md:col-span-5 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Quotation # or Customer Name..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 hover:bg-gray-100/70 focus:bg-white border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition"
            />
          </div>

          {/* Status Filter */}
          <div className="md:col-span-3">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              ariaLabel="Filter quotations by status"
              options={[
                { value: "all", label: "All Quotation Statuses" },
                { value: "draft", label: "Draft" },
                { value: "sent", label: "Sent" },
                { value: "approved", label: "Approved (Confirmed)" },
                { value: "delivered", label: "Delivered (Confirmed)" },
                { value: "rejected", label: "Rejected" },
              ]}
            />
          </div>

          {/* Date Range Inputs */}
          <div className="md:col-span-4 flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Filter start date"
              className="w-1/2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-black"
              title="Start Date"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="Filter end date"
              className="w-1/2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-black"
              title="End Date"
            />
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                title="Reset filters"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Quotation-Wise Earnings Table ── */}
      <div className="bg-white rounded-2xl border border-gray-150 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-950">Quotation-Wise Breakdown</h2>
            <span className="text-xs font-semibold px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full">
              {pagination.total} {pagination.total === 1 ? "quotation" : "quotations"}
            </span>
          </div>
          <span className="text-xs text-gray-500 hidden sm:inline">
            Click &quot;View Breakdown&quot; for complete financial transparency
          </span>
        </div>

        {loading && quotations.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm font-medium text-gray-500">Calculating dealer earnings...</p>
          </div>
        ) : quotations.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
              <Receipt size={24} />
            </div>
            <h3 className="text-sm font-bold text-gray-900">No quotations found</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
              {hasActiveFilters
                ? "No quotations match your current search and filter criteria. Try clearing filters."
                : "You have not created any quotations yet. Create your first quotation to start earning commissions."}
            </p>
            {hasActiveFilters ? (
              <button
                onClick={handleResetFilters}
                className="mt-4 px-3.5 py-1.5 text-xs font-semibold text-black bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
              >
                Clear Filters
              </button>
            ) : (
              <Link
                href="/quotation/new"
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-neutral-800 transition"
              >
                + New Quotation
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-gray-50/80 border-b border-gray-100 text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Quotation #</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Product Subtotal</th>
                  <th className="py-3 px-4 text-right">Customer Discount</th>
                  <th className="py-3 px-4 text-right">Net Value</th>
                  <th className="py-3 px-4 text-center">Margin %</th>
                  <th className="py-3 px-4 text-right">Estimated Commission</th>
                  <th className="py-3 px-4 text-right">Confirmed Earning</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {quotations.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setSelectedQuote(q)}
                    className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                  >
                    {/* Quotation Number */}
                    <td className="py-3 px-4 font-semibold text-gray-950">
                      <div className="flex items-center gap-1.5">
                        <span>{q.quotationNumber}</span>
                        <Link
                          href={`/quotation/${q.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-400 hover:text-black transition"
                          title="Open Quotation Editor"
                        >
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </td>

                    {/* Customer Name */}
                    <td className="py-3 px-4 font-medium text-gray-900 max-w-[160px] truncate">
                      {q.clientName}
                    </td>

                    {/* Quotation Date */}
                    <td className="py-3 px-4 text-gray-500">{formatDate(q.createdAt)}</td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <StatusBadge status={q.status} />
                    </td>

                    {/* Original Subtotal */}
                    <td className="py-3 px-4 text-right font-mono text-gray-700">
                      {formatCurrency(q.subtotal)}
                    </td>

                    {/* Customer Discount Amount & % */}
                    <td className="py-3 px-4 text-right">
                      {q.customerDiscountAmount > 0 ? (
                        <div className="text-purple-700 font-mono">
                          <span>-{formatCurrency(q.customerDiscountAmount)}</span>
                          <span className="text-[10px] text-purple-500 ml-1">
                            ({q.customerDiscountPercent}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400 font-mono">₹0 (0%)</span>
                      )}
                    </td>

                    {/* Net Quotation Value */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-gray-950">
                      {formatCurrency(q.netQuotationValue)}
                    </td>

                    {/* Dealer Commission % */}
                    <td className="py-3 px-4 text-center">
                      <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-900 rounded-md font-semibold text-[11px]">
                        {q.dealerCommissionPercent}%
                      </span>
                    </td>

                    {/* Estimated Commission */}
                    <td className="py-3 px-4 text-right font-mono font-medium text-amber-900">
                      {formatCurrency(q.estimatedCommissionAmount)}
                    </td>

                    {/* Confirmed Commission */}
                    <td className="py-3 px-4 text-right font-mono">
                      {q.isConfirmed ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          {formatCurrency(q.confirmedCommissionAmount)}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[11px] italic">Pending</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setSelectedQuote(q)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-black hover:text-white rounded-lg transition cursor-pointer"
                      >
                        <Calculator size={12} />
                        <span>Breakdown</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Table Footer & Pagination ── */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={(p) => fetchEarnings(p, pagination.pageSize)}
            onPageSizeChange={(sz) => fetchEarnings(1, sz)}
            pageSizeOptions={[10, 20, 50]}
            entityName="quotations"
            isLoading={loading}
          />
        </div>
      </div>

      {/* ── Calculation Breakdown Modal ── */}
      {selectedQuote && (
        <Modal
          isOpen={Boolean(selectedQuote)}
          onClose={() => setSelectedQuote(null)}
          title={`Calculation Breakdown: ${selectedQuote.quotationNumber}`}
          size="lg"
        >
          <div className="space-y-5 text-sm">
            {/* Header info strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
              <div>
                <p className="text-xs text-gray-500 font-medium">Customer</p>
                <p className="font-bold text-gray-950 text-base">{selectedQuote.clientName}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-medium">Created On</p>
                <p className="font-semibold text-gray-900">{formatDate(selectedQuote.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">Status</p>
                <StatusBadge status={selectedQuote.status} />
              </div>
            </div>

            {/* Step-by-Step Financial Pipeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                1. Quotation Net Value Determination
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-white border border-gray-200 rounded-xl">
                  <p className="text-xs text-gray-500">Eligible Product Subtotal</p>
                  <p className="text-lg font-bold text-gray-950 font-mono mt-0.5">
                    {formatCurrency(selectedQuote.subtotal)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">Sum of items at unit list price</p>
                </div>

                <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-xl">
                  <p className="text-xs text-purple-700">Customer Discount Applied</p>
                  <p className="text-lg font-bold text-purple-900 font-mono mt-0.5">
                    - {formatCurrency(selectedQuote.customerDiscountAmount)}
                  </p>
                  <p className="text-[11px] text-purple-600 mt-1">
                    {selectedQuote.customerDiscountPercent}% customer discount
                  </p>
                </div>

                <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
                  <p className="text-xs text-blue-700">Net Quotation Value</p>
                  <p className="text-lg font-bold text-blue-950 font-mono mt-0.5">
                    = {formatCurrency(selectedQuote.netQuotationValue)}
                  </p>
                  <p className="text-[11px] text-blue-600 mt-1">Net amount payable by customer</p>
                </div>
              </div>
            </div>

            {/* Commission Rate Breakdown */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                2. Dealer Margin & Commission Rate
              </h4>
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-600">Dealer&apos;s Allocated Discount Snapshot:</span>
                  <span className="font-semibold text-gray-900">
                    {selectedQuote.allocatedDiscountPercent}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-purple-700">
                  <span>Less Customer Discount Passed to Client:</span>
                  <span className="font-semibold">
                    - {selectedQuote.customerDiscountPercent}%
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-bold text-gray-950">
                  <span>Dealer Net Commission Percentage:</span>
                  <span className="px-2 py-0.5 bg-black text-white rounded-md text-xs">
                    {selectedQuote.dealerCommissionPercent}%
                  </span>
                </div>
              </div>
            </div>

            {/* Commission Calculation Result */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                3. Canonical Commission Calculation
              </h4>
              <div className="p-4 bg-gradient-to-r from-gray-900 to-black text-white rounded-2xl space-y-3">
                <div className="text-xs text-gray-300">
                  Formula:{" "}
                  <code className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">
                    Product Subtotal (₹{selectedQuote.subtotal.toLocaleString("en-IN")}) × Commission Rate ({selectedQuote.dealerCommissionPercent}%)
                  </code>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/15">
                  <div>
                    <span className="text-xs text-gray-400">Calculated Commission:</span>
                    <div className="text-2xl font-extrabold font-mono text-emerald-400">
                      {formatCurrency(selectedQuote.estimatedCommissionAmount)}
                    </div>
                  </div>

                  <div>
                    {selectedQuote.isConfirmed ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                        <CheckCircle2 size={15} />
                        <span>Confirmed Earning</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold">
                        <Clock size={15} />
                        <span>Pending Approval</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Status explanation */}
              <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-600 flex items-start gap-2 border border-gray-200">
                <Info size={16} className="text-gray-500 shrink-0 mt-0.5" />
                <div>
                  {selectedQuote.isConfirmed ? (
                    <span>
                      This quotation is in <strong>{selectedQuote.status}</strong> status. The commission of{" "}
                      <strong>{formatCurrency(selectedQuote.confirmedCommissionAmount)}</strong> has been confirmed and unlocked.
                    </span>
                  ) : (
                    <span>
                      This quotation is currently in <strong>{selectedQuote.status}</strong> status. The commission of{" "}
                      <strong>{formatCurrency(selectedQuote.estimatedCommissionAmount)}</strong> is estimated and will be confirmed once approved by Whyte Admin.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Modal actions */}
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <Link
                href={`/quotation/${selectedQuote.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-black hover:bg-neutral-800 text-white rounded-xl text-xs font-semibold transition"
              >
                <span>Open Quotation Editor</span>
                <ExternalLink size={14} />
              </Link>

              <button
                onClick={() => setSelectedQuote(null)}
                className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
