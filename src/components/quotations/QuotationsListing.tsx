"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Plus,
  Search,
  FileText,
  FileEdit,
  CheckCircle2,
  TrendingUp,
  SlidersHorizontal,
  Eye,
  Copy,
  Trash2,
  Building,
  MapPin,
  Layers,
  ShoppingBag,
  X,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { QuotationStatus, HouseType } from "@/types";
import { Select } from "@/components/ui/Select";
import { Check, Truck, Wallet } from "lucide-react";

export interface QuotationRowData {
  id: string;
  quotationNumber: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  houseTypeId: number | null;
  houseType?: { id: number; name: string } | null;
  status: QuotationStatus;
  notes: string | null;
  discountType: string | null;
  discountValue: string | number | null;
  createdAt: string;
  updatedAt?: string;
  roomsCount: number;
  productsCount: number;
  totalAmount: number;
  dealerId?: number | null;
  dealerName?: string | null;
  allocatedDiscountPercent?: number;
  customerDiscountPercent?: number;
  estimatedEarningPercent?: number;
  estimatedEarningAmount?: number;
  clonedFromQuotationId?: string | null;
  sentAt?: string | null;
  approvedAt?: string | null;
  deliveredAt?: string | null;
}

interface Props {
  initialQuotations: QuotationRowData[];
  houseTypes: HouseType[];
  userRole?: string;
  dealerEarnings?: number;
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft:     { label: "Draft",     dot: "bg-gray-400",    bg: "bg-gray-50",     text: "text-gray-600",   border: "border-gray-200" },
  sent:      { label: "Sent",      dot: "bg-amber-400 animate-pulse", bg: "bg-amber-50",    text: "text-amber-700",  border: "border-amber-200" },
  approved:  { label: "Approved",  dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700",border: "border-emerald-200" },
  rejected:  { label: "Rejected",  dot: "bg-red-400",     bg: "bg-red-50",      text: "text-red-700",    border: "border-red-200" },
  delivered: { label: "Delivered", dot: "bg-indigo-500",  bg: "bg-indigo-50",   text: "text-indigo-700", border: "border-indigo-200" },
};

function InlineBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default function QuotationsListing({
  initialQuotations,
  houseTypes,
  userRole,
  dealerEarnings = 0,
}: Props) {
  const router = useRouter();
  const [quotations, setQuotations] = useState<QuotationRowData[]>(initialQuotations);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectTypeFilter, setProjectTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const confirm = useConfirm();

  // Computed summary metrics from real database data
  const summaryMetrics = useMemo(() => {
    const total = quotations.length;
    const drafts = quotations.filter((q) => q.status === "draft").length;
    const completed = quotations.filter((q) => q.status === "approved" || q.status === "sent" || q.status === "delivered").length;
    const pendingSent = quotations.filter((q) => q.status === "sent").length;
    const totalValue = quotations.reduce((acc, q) => acc + (q.totalAmount || 0), 0);

    return { total, drafts, completed, pendingSent, totalValue };
  }, [quotations]);

  // Transition handler (Sales / Admin approval actions)
  const handleTransition = async (quotationId: string, action: "approve" | "reject" | "deliver") => {
    setTransitioningId(quotationId);
    try {
      const res = await fetch(`/api/quotations/${quotationId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} quotation`);
      }
      const targetStatus: QuotationStatus =
        action === "approve" ? "approved" : action === "reject" ? "rejected" : "delivered";
      setQuotations((prev) =>
        prev.map((q) => (q.id === quotationId ? { ...q, status: targetStatus } : q))
      );
      toast.success(`Quotation marked as ${targetStatus}!`);
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} quotation`);
    } finally {
      setTransitioningId(null);
    }
  };

  // Client-side filtering and sorting
  const filteredQuotations = useMemo(() => {
    let result = [...quotations];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (item) =>
          item.quotationNumber.toLowerCase().includes(q) ||
          item.clientName.toLowerCase().includes(q) ||
          (item.clientPhone && item.clientPhone.toLowerCase().includes(q)) ||
          (item.clientEmail && item.clientEmail.toLowerCase().includes(q)) ||
          (item.clientAddress && item.clientAddress.toLowerCase().includes(q)) ||
          (item.notes && item.notes.toLowerCase().includes(q))
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((item) => item.status === statusFilter);
    }

    if (projectTypeFilter !== "all") {
      result = result.filter((item) => String(item.houseTypeId) === projectTypeFilter);
    }

    if (dateFilter !== "all") {
      const now = new Date();
      result = result.filter((item) => {
        const itemDate = new Date(item.createdAt);
        const diffMs = now.getTime() - itemDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (dateFilter === "today") return diffDays <= 1;
        if (dateFilter === "7days") return diffDays <= 7;
        if (dateFilter === "30days") return diffDays <= 30;
        if (dateFilter === "year") return itemDate.getFullYear() === now.getFullYear();
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === "highest") {
        return (b.totalAmount || 0) - (a.totalAmount || 0);
      }
      if (sortBy === "lowest") {
        return (a.totalAmount || 0) - (b.totalAmount || 0);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [quotations, search, statusFilter, projectTypeFilter, dateFilter, sortBy]);

  // Duplicate handler
  const handleDuplicate = async (quotationId: string) => {
    setDuplicatingId(quotationId);
    try {
      const res = await fetch(`/api/quotations/${quotationId}/duplicate`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to duplicate quotation");
      }

      const newQuote = await res.json();
      toast.success("Quotation duplicated successfully!");

      router.push(`/quotation/${newQuote.id || newQuote._id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate quotation");
    } finally {
      setDuplicatingId(null);
      setActiveMenuId(null);
    }
  };

  // Delete handler
  const handleDelete = async (quotation: QuotationRowData) => {
    setActiveMenuId(null);
    await confirm({
      title: "Delete Quotation",
      message: `Are you sure you want to delete proposal "${quotation.quotationNumber} (${quotation.clientName})"?`,
      detail: "This will permanently remove all associated rooms and configured devices.",
      confirmText: "Delete Proposal",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/quotations/${quotation.id}`, {
            method: "DELETE",
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to delete quotation");
          }

          toast.success("Quotation deleted");
          setQuotations((prev) => prev.filter((q) => q.id !== quotation.id));
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to delete quotation"
          );
        }
      },
    });
  };

  return (
    <div className="space-y-6 md:space-y-8">

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-1">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-1">
            {userRole === "dealer" ? "Dealer Portal" : "Sales & Admin"}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-950 tracking-tight leading-none">
            Quotations
          </h1>
          <p className="text-gray-500 text-sm mt-2 font-normal max-w-md">
            Create, manage and track smart automation proposals for your clients.
          </p>
        </div>
        <Link
          href="/quotation/new"
          className="group inline-flex items-center justify-center gap-2 px-5 py-3 bg-gray-950 text-white rounded-2xl font-semibold text-sm hover:bg-gray-800 active:scale-[0.98] transition-all shadow-lg shadow-gray-900/20 shrink-0 border border-gray-900"
        >
          <Plus size={16} className="group-hover:rotate-90 transition-transform duration-200" />
          New Quotation
        </Link>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className={`grid grid-cols-2 ${userRole === "dealer" ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-3 sm:gap-4`}>

        {/* Total */}
        <div className="group bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-gray-100 transition-colors">
              <FileText size={15} />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-950 font-mono tabular-nums">{summaryMetrics.total}</p>
          <p className="text-[11px] text-gray-400 mt-1">All client projects</p>
        </div>

        {/* Drafts */}
        <div className="group bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Drafts</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-gray-100 transition-colors">
              <FileEdit size={15} />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-950 font-mono tabular-nums">{summaryMetrics.drafts}</p>
          <p className="text-[11px] text-gray-400 mt-1">In progress</p>
        </div>

        {/* Completed */}
        <div className="group bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-emerald-100 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <CheckCircle2 size={15} />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-950 font-mono tabular-nums">{summaryMetrics.completed}</p>
          <p className="text-[11px] text-emerald-600 mt-1 font-medium">Ready proposals</p>
        </div>

        {/* Total Value */}
        <div className="group bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Value</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-gray-100 transition-colors">
              <TrendingUp size={15} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-gray-950 font-mono tabular-nums truncate">
            {formatCurrency(summaryMetrics.totalValue)}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">Proposal sum</p>
        </div>

        {/* Dealer Earnings */}
        {userRole === "dealer" && (
          <div className="group relative overflow-hidden bg-gray-950 rounded-2xl border border-gray-900 p-4 sm:p-5 shadow-lg col-span-2 sm:col-span-1">
            {/* subtle gradient shimmer */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/5 pointer-events-none" />
            <div className="relative flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-emerald-400/80 uppercase tracking-wider">Your Earnings</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Wallet size={15} />
              </div>
            </div>
            <p className="relative text-2xl sm:text-3xl font-black text-white font-mono tabular-nums truncate">
              {formatCurrency(dealerEarnings)}
            </p>
            <p className="relative text-[11px] text-emerald-400/70 mt-1 font-medium">Approved & Delivered</p>
          </div>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Approval queue banner */}
        {(userRole === "sales" || userRole === "super_admin" || userRole === "admin") && summaryMetrics.pendingSent > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span className="font-semibold">Approval Queue:</span>
              <span>
                <strong>{summaryMetrics.pendingSent}</strong> quotation{summaryMetrics.pendingSent !== 1 ? "s" : ""} waiting for review.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === "sent" ? "all" : "sent")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                statusFilter === "sent"
                  ? "bg-amber-900 text-white"
                  : "bg-amber-200/70 hover:bg-amber-300 text-amber-900"
              }`}
            >
              {statusFilter === "sent" ? "Show All" : "Filter Queue"}
            </button>
          </div>
        )}

        <div className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, QT number, city or phone…"
                className="w-full h-10 pl-10 pr-9 border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 bg-gray-50/50 hover:bg-white transition"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: "all", label: "All Statuses" },
                  { value: "draft", label: "Draft" },
                  { value: "sent", label: "Sent (Pending)" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "delivered", label: "Delivered" },
                ]}
                triggerClassName="h-10 rounded-xl text-xs sm:text-sm"
                aria-label="Filter by Status"
              />
              <Select
                value={projectTypeFilter}
                onChange={(e) => setProjectTypeFilter(e.target.value)}
                options={[
                  { value: "all", label: "All Types" },
                  ...houseTypes.map((ht) => ({ value: String(ht.id), label: ht.name })),
                ]}
                triggerClassName="h-10 rounded-xl text-xs sm:text-sm"
                aria-label="Filter by Project Type"
              />
              <Select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                options={[
                  { value: "all", label: "All Time" },
                  { value: "today", label: "Today" },
                  { value: "7days", label: "Last 7 Days" },
                  { value: "30days", label: "Last 30 Days" },
                  { value: "year", label: "This Year" },
                ]}
                triggerClassName="h-10 rounded-xl text-xs sm:text-sm"
                aria-label="Filter by Date"
              />
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: "newest", label: "Newest First" },
                  { value: "oldest", label: "Oldest First" },
                  { value: "highest", label: "Highest Value" },
                  { value: "lowest", label: "Lowest Value" },
                ]}
                triggerClassName="h-10 rounded-xl text-xs sm:text-sm"
                aria-label="Sort Quotations"
              />
            </div>
          </div>

          {/* Active filter summary */}
          {(search || statusFilter !== "all" || projectTypeFilter !== "all" || dateFilter !== "all" || sortBy !== "newest") && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs text-gray-500">
              <span>
                Showing <strong className="text-gray-900">{filteredQuotations.length}</strong> of{" "}
                <strong className="text-gray-900">{quotations.length}</strong> quotations
              </span>
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setProjectTypeFilter("all");
                  setDateFilter("all");
                  setSortBy("newest");
                }}
                className="text-gray-600 font-semibold hover:text-gray-900 hover:underline transition"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────── */}
      {filteredQuotations.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
            <FileText size={28} />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            {quotations.length === 0 ? "No quotations yet" : "No matching quotations"}
          </h2>
          <p className="text-gray-400 text-sm max-w-sm mx-auto mb-6">
            {quotations.length === 0
              ? "Start by creating your first smart automation proposal for your client."
              : "Try adjusting your search or filters."}
          </p>
          {quotations.length === 0 ? (
            <Link
              href="/quotation/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-950 text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition"
            >
              <Plus size={16} />
              Create Proposal
            </Link>
          ) : (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setProjectTypeFilter("all");
                setDateFilter("all");
              }}
              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-950 text-gray-400 text-[10px] font-bold uppercase tracking-widest">
                    <th className="py-3.5 px-5 text-left rounded-tl-2xl">Quotation / Project</th>
                    {userRole !== "dealer" && <th className="py-3.5 px-4">Dealer</th>}
                    <th className="py-3.5 px-4">Client</th>
                    <th className="py-3.5 px-4">Location</th>
                    <th className="py-3.5 px-4">Scope</th>
                    <th className="py-3.5 px-4">Value</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-5 text-right rounded-tr-2xl">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredQuotations.map((q) => {
                    const isLocked = q.status === "approved" || q.status === "delivered";
                    const isSent = q.status === "sent";
                    const isApproved = q.status === "approved";
                    const canReview = userRole === "sales" || userRole === "super_admin" || userRole === "admin";

                    return (
                      <tr
                        key={q.id}
                        className="group hover:bg-gray-50/80 transition-colors duration-150 cursor-pointer"
                        onClick={() => router.push(`/quotation/${q.id}`)}
                      >
                        {/* QT Number */}
                        <td className="py-4 px-5">
                          <span className="font-mono font-black text-gray-950 text-sm tracking-tight block">
                            {q.quotationNumber}
                          </span>
                          {q.houseType && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 mt-0.5 font-medium">
                              <Building size={9} />
                              {q.houseType.name}
                            </span>
                          )}
                        </td>

                        {/* Dealer */}
                        {userRole !== "dealer" && (
                          <td className="py-4 px-4 text-xs">
                            <span className="font-semibold text-gray-800 block">{q.dealerName || "Direct / Admin"}</span>
                            {q.allocatedDiscountPercent !== undefined && q.allocatedDiscountPercent > 0 && (
                              <span className="text-[10px] text-gray-400 block mt-0.5">
                                Alloc: {q.allocatedDiscountPercent}% · Cust: {q.customerDiscountPercent || 0}%
                              </span>
                            )}
                          </td>
                        )}

                        {/* Client */}
                        <td className="py-4 px-4">
                          <p className="font-semibold text-gray-900 leading-snug">{q.clientName}</p>
                          {q.clientPhone && (
                            <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{q.clientPhone}</p>
                          )}
                        </td>

                        {/* Location */}
                        <td className="py-4 px-4 text-xs text-gray-500">
                          {q.clientAddress ? (
                            <span className="flex items-center gap-1 truncate max-w-[140px]" title={q.clientAddress}>
                              <MapPin size={11} className="text-gray-300 shrink-0" />
                              {q.clientAddress}
                            </span>
                          ) : (
                            <span className="text-gray-200">—</span>
                          )}
                        </td>

                        {/* Scope */}
                        <td className="py-4 px-4">
                          <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Layers size={11} className="text-gray-300" />
                              {q.roomsCount} {q.roomsCount === 1 ? "room" : "rooms"}
                            </span>
                            <span className="flex items-center gap-1">
                              <ShoppingBag size={11} className="text-gray-300" />
                              {q.productsCount} {q.productsCount === 1 ? "device" : "devices"}
                            </span>
                          </div>
                        </td>

                        {/* Value */}
                        <td className="py-4 px-4">
                          <span className="font-mono font-black text-gray-950 text-sm">
                            {formatCurrency(q.totalAmount || 0)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4">
                          <InlineBadge status={q.status} />
                        </td>

                        {/* Date */}
                        <td className="py-4 px-4 text-xs text-gray-500 whitespace-nowrap">
                          <span className="font-medium text-gray-700 block">{formatDate(q.createdAt)}</span>
                          {q.updatedAt && q.updatedAt !== q.createdAt && (
                            <span className="text-[10px] text-gray-400 block mt-0.5">
                              Upd. {formatDate(q.updatedAt)}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/quotation/${q.id}?step=5`}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition"
                              title="View Proposal Preview"
                            >
                              <Eye size={14} />
                            </Link>

                            {isLocked ? (
                              <button
                                type="button"
                                disabled={duplicatingId === q.id}
                                onClick={() => handleDuplicate(q.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/80 transition"
                                title="Proposal is locked. Clone to revise."
                              >
                                <Copy size={12} />
                                Clone
                              </button>
                            ) : (
                              <Link
                                href={`/quotation/${q.id}`}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition"
                                title="Edit / Configure Proposal"
                              >
                                <SlidersHorizontal size={14} />
                              </Link>
                            )}

                            {canReview && isSent && (
                              <>
                                <button
                                  type="button"
                                  disabled={transitioningId === q.id}
                                  onClick={() => handleTransition(q.id, "approve")}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition disabled:opacity-50"
                                >
                                  <Check size={12} />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={transitioningId === q.id}
                                  onClick={() => handleTransition(q.id, "reject")}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition disabled:opacity-50"
                                >
                                  <X size={12} />
                                  Reject
                                </button>
                              </>
                            )}

                            {canReview && isApproved && (
                              <button
                                type="button"
                                disabled={transitioningId === q.id}
                                onClick={() => handleTransition(q.id, "deliver")}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition disabled:opacity-50"
                              >
                                <Truck size={12} />
                                Deliver
                              </button>
                            )}

                            {!isLocked && (
                              <button
                                type="button"
                                disabled={duplicatingId === q.id}
                                onClick={() => handleDuplicate(q.id)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition disabled:opacity-50"
                                title="Duplicate Quotation"
                              >
                                <Copy size={14} />
                              </button>
                            )}

                            {!isLocked && (
                              <button
                                type="button"
                                onClick={() => handleDelete(q)}
                                className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition"
                                title="Delete Quotation"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table footer count */}
            <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {filteredQuotations.length} proposal{filteredQuotations.length !== 1 ? "s" : ""}
              </p>
              <Link
                href="/quotation/new"
                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900 transition"
              >
                <Plus size={12} />
                New Quotation
              </Link>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filteredQuotations.map((q) => {
              const isLocked = q.status === "approved" || q.status === "delivered";
              const isSent = q.status === "sent";
              const isApproved = q.status === "approved";
              const canReview = userRole === "sales" || userRole === "super_admin" || userRole === "admin";

              return (
                <div
                  key={q.id}
                  onClick={() => router.push(`/quotation/${q.id}`)}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-gray-200 hover:shadow-md transition-all duration-200 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-gray-950 text-sm tracking-tight">
                          {q.quotationNumber}
                        </span>
                        <InlineBadge status={q.status} />
                      </div>
                      <p className="font-bold text-gray-900 text-base mt-1 truncate">{q.clientName}</p>
                      {userRole !== "dealer" && q.dealerName && (
                        <p className="text-xs text-gray-500 font-medium mt-0.5">Dealer: {q.dealerName}</p>
                      )}
                      {q.clientAddress && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                          <MapPin size={10} className="shrink-0" />
                          <span className="truncate">{q.clientAddress}</span>
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Value</p>
                      <p className="font-mono font-black text-gray-950 text-base mt-0.5">
                        {formatCurrency(q.totalAmount || 0)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-400 pt-2.5 border-t border-gray-100">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Layers size={10} className="text-gray-300" />
                        {q.roomsCount} rooms
                      </span>
                      <span className="flex items-center gap-1">
                        <ShoppingBag size={10} className="text-gray-300" />
                        {q.productsCount} devices
                      </span>
                    </div>
                    <span>{formatDate(q.createdAt)}</span>
                  </div>

                  <div
                    className="flex items-center gap-2 pt-2 border-t border-gray-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      href={`/quotation/${q.id}?step=5`}
                      className="flex-1 py-2 px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 text-center transition"
                    >
                      View Proposal
                    </Link>

                    {isLocked ? (
                      <button
                        onClick={() => handleDuplicate(q.id)}
                        disabled={duplicatingId === q.id}
                        className="flex-1 py-2 px-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold text-center transition"
                      >
                        Clone (Locked)
                      </button>
                    ) : (
                      <Link
                        href={`/quotation/${q.id}`}
                        className="flex-1 py-2 px-3 bg-gray-950 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold text-center transition"
                      >
                        Open Builder
                      </Link>
                    )}

                    {canReview && isSent && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleTransition(q.id, "approve")}
                          disabled={transitioningId === q.id}
                          className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleTransition(q.id, "reject")}
                          disabled={transitioningId === q.id}
                          className="px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-semibold transition disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {canReview && isApproved && (
                      <button
                        onClick={() => handleTransition(q.id, "deliver")}
                        disabled={transitioningId === q.id}
                        className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
                      >
                        Deliver
                      </button>
                    )}

                    {!isLocked && (
                      <button
                        onClick={() => handleDelete(q)}
                        className="p-2 bg-red-50 hover:bg-red-100 border border-red-100 rounded-xl text-red-500 transition"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Delete confirmation is raised through the global ConfirmProvider portal. */}
    </div>
  );
}
