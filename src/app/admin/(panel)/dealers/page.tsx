"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  Users,
  Search,
  RefreshCw,
  Percent,
  CheckCircle2,
  XCircle,
  Building,
  UserCheck,
  TrendingUp,
  ExternalLink,
  ChevronRight,
  Shield,
  FileText,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError, safeMessage } from "@/lib/apiClient";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Pagination from "@/components/shared/Pagination";
import { Input, Button, Select } from "@/components/ui";
import Link from "next/link";

interface DealerItem {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  companyName: string | null;
  businessEmail: string | null;
  contactNumber: string | null;
  gstNumber: string | null;
  address: string | null;
  isActive: boolean;
  discountAllocationPercent: number;
  discountAllocationHistory?: Array<{
    allocatedPercent: number;
    previousPercent: number;
    changedBy: number;
    changedByName: string | null;
    changedAt: string;
  }>;
  quotationStats: {
    total: number;
    draft: number;
    sent: number;
    approved: number;
    rejected: number;
    delivered: number;
  };
  accumulatedEarnings: number;
  createdAt: string;
}

export default function DealersPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;
  const isSuperAdmin = role === "super_admin";

  const confirm = useConfirm();

  const [dealers, setDealers] = useState<DealerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Discount Allocation Modal
  const [discountDealer, setDiscountDealer] = useState<DealerItem | null>(null);
  const [newDiscountPercent, setNewDiscountPercent] = useState<number>(0);
  const [savingDiscount, setSavingDiscount] = useState(false);

  // Edit Dealer Details Modal (what shows under "Authorized Dealer" on proposals)
  const [editDealer, setEditDealer] = useState<DealerItem | null>(null);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editBusinessEmail, setEditBusinessEmail] = useState("");
  const [savingDealerDetails, setSavingDealerDetails] = useState(false);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchDealers = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/admin/dealers?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(safeMessage(json?.error?.message, "Could not fetch dealer records."));
      }
      setDealers(json.data || []);
      setTotal(json.pagination?.total || 0);
      setTotalPages(json.pagination?.totalPages || 1);
    } catch (err: unknown) {
      notifyApiError(err, "Unable to load dealers", "Could not fetch dealer records.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchDealers();
  }, [fetchDealers]);

  const handleToggleStatus = async (dealer: DealerItem) => {
    const nextStatus = !dealer.isActive;
    await confirm({
      title: nextStatus ? "Activate Dealer Account" : "Deactivate Dealer Account",
      message: nextStatus
        ? `Activate account for ${dealer.name}? They will be able to log in and create quotations.`
        : `Deactivate account for ${dealer.name}? They will be prevented from logging in immediately.`,
      confirmText: nextStatus ? "Activate" : "Deactivate",
      cancelText: "Cancel",
      variant: nextStatus ? "primary" : "danger",
      onConfirm: async () => {
        try {
          await apiJson.patch(`/api/admin/dealers/${dealer.id}`, { isActive: nextStatus });
          notify.success(
            nextStatus ? "Dealer activated" : "Dealer deactivated",
            `${dealer.name}'s account status has been updated.`
          );
          fetchDealers();
        } catch (err: unknown) {
          notifyApiError(err, "Status update failed", "Could not change dealer account status.");
        }
      },
    });
  };

  const handleOpenDiscountModal = (dealer: DealerItem) => {
    setDiscountDealer(dealer);
    setNewDiscountPercent(dealer.discountAllocationPercent || 0);
  };

  const handleSaveDiscount = async () => {
    if (!discountDealer) return;
    if (newDiscountPercent < 0 || newDiscountPercent > 100) {
      notify.error("Invalid discount", "Discount must be between 0% and 100%.");
      return;
    }
    setSavingDiscount(true);
    try {
      await apiJson.patch(`/api/admin/dealers/${discountDealer.id}`, {
        discountAllocationPercent: newDiscountPercent,
      });
      notify.success(
        "Discount allocation saved",
        `Dealer discount allocation updated to ${newDiscountPercent}%. New quotations will snapshot this rate.`
      );
      setDiscountDealer(null);
      fetchDealers();
    } catch (err: unknown) {
      notifyApiError(err, "Update failed", "Could not update discount allocation.");
    } finally {
      setSavingDiscount(false);
    }
  };

  const handleOpenEditDealerModal = (dealer: DealerItem) => {
    setEditDealer(dealer);
    setEditCompanyName(dealer.companyName || "");
    setEditBusinessEmail(dealer.businessEmail || "");
  };

  const handleSaveDealerDetails = async () => {
    if (!editDealer) return;
    setSavingDealerDetails(true);
    try {
      await apiJson.patch(`/api/admin/dealers/${editDealer.id}`, {
        companyName: editCompanyName.trim() || null,
        businessEmail: editBusinessEmail.trim() || null,
      });
      notify.success(
        "Dealer details saved",
        "Company name and business email updated. These appear under Authorized Dealer on this dealer's proposals."
      );
      setEditDealer(null);
      fetchDealers();
    } catch (err: unknown) {
      notifyApiError(err, "Update failed", "Could not update dealer details.");
    } finally {
      setSavingDealerDetails(false);
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <Users className="text-[#D85B83]" size={24} />
            <span>Dealer Management</span>
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            {total} registered partner{total !== 1 ? "s" : ""} recorded in system
          </p>
        </div>

        <button
          onClick={() => {
            setRefreshing(true);
            fetchDealers();
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin text-[#D85B83]" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by dealer name, email, contact, or GST number..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:border-gray-950 focus:bg-white transition"
          />
        </div>

        <div className="flex items-center gap-2 md:w-48">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            ariaLabel="Filter dealers by status"
            options={[
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active Only" },
              { value: "inactive", label: "Inactive Only" },
            ]}
          />
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : dealers.length === 0 ? (
          <div className="p-12 text-center">
            <Building size={36} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900">No dealers found</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              No registered dealers match your current search or filter criteria.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Dealer</th>
                    <th className="px-4 py-3">Contact Details</th>
                    <th className="px-4 py-3 text-center">Allocated Discount</th>
                    <th className="px-4 py-3 text-center">Quotations</th>
                    <th className="px-4 py-3 text-right">Accumulated Earnings</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {dealers.map((dealer) => {
                    const stats = dealer.quotationStats;
                    return (
                      <tr key={dealer.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-gray-950 text-sm">{dealer.name}</p>
                          {dealer.companyName && (
                            <p className="text-gray-600 text-xs font-medium">{dealer.companyName}</p>
                          )}
                          <p className="text-gray-400 text-xs">{dealer.email}</p>
                          {dealer.businessEmail && (
                            <p className="text-gray-400 text-xs" title="Business email shown on proposals">
                              {dealer.businessEmail}
                            </p>
                          )}
                          {dealer.gstNumber && (
                            <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              GST: {dealer.gstNumber}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-gray-600">
                          <p className="font-medium">{dealer.contactNumber || "No phone"}</p>
                          <p className="text-[11px] text-gray-400 truncate max-w-[200px]" title={dealer.address || ""}>
                            {dealer.address || "No address provided"}
                          </p>
                        </td>



                        <td className="px-4 py-3.5 text-center">
                          <button
                            onClick={() => handleOpenDiscountModal(dealer)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-bold transition text-xs cursor-pointer"
                            title="Click to change discount allocation"
                          >
                            <Percent size={12} />
                            <span>{dealer.discountAllocationPercent || 0}%</span>
                          </button>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                            <span className="px-2 py-0.5 rounded bg-gray-100 font-mono">
                              {stats.total} total
                            </span>
                            {stats.approved + stats.delivered > 0 && (
                              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">
                                {stats.approved + stats.delivered} confirmed
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-600 text-sm">
                          {formatCurrency(dealer.accumulatedEarnings || 0)}
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          {isSuperAdmin ? (
                            <button
                              onClick={() => handleToggleStatus(dealer)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer ${
                                dealer.isActive
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                                  : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                              }`}
                            >
                              {dealer.isActive ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                              <span>{dealer.isActive ? "Active" : "Inactive"}</span>
                            </button>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                                dealer.isActive
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}
                            >
                              {dealer.isActive ? "Active" : "Inactive"}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => handleOpenEditDealerModal(dealer)}
                              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                              title="Edit Company Name & Business Email (shown on proposals)"
                            >
                              <Building size={16} />
                            </button>
                            <Link
                              href={`/admin/quotations?dealerId=${dealer.id}`}
                              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
                              title="View Dealer Quotations"
                            >
                              <FileText size={16} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="lg:hidden divide-y divide-gray-100">
              {dealers.map((dealer) => {
                const stats = dealer.quotationStats;
                return (
                  <div key={dealer.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-gray-950 text-sm">{dealer.name}</h3>
                        {dealer.companyName && (
                          <p className="text-gray-600 text-xs font-medium">{dealer.companyName}</p>
                        )}
                        <p className="text-gray-400 text-xs">{dealer.email}</p>
                        {dealer.businessEmail && (
                          <p className="text-gray-400 text-xs">{dealer.businessEmail}</p>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          dealer.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {dealer.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl">
                      <div>
                        <span className="text-[10px] text-gray-400 block uppercase">Allocated Discount</span>
                        <span className="font-bold text-purple-700">{dealer.discountAllocationPercent || 0}%</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-400 block uppercase">Earnings</span>
                        <span className="font-bold text-emerald-600">{formatCurrency(dealer.accumulatedEarnings || 0)}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[10px] text-gray-400 block uppercase">Quotations</span>
                        <span className="font-medium text-gray-900">{stats.total} total</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
                      <button
                        onClick={() => handleOpenDiscountModal(dealer)}
                        className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg font-semibold hover:bg-purple-100 transition"
                      >
                        Set Discount
                      </button>
                      <button
                        onClick={() => handleOpenEditDealerModal(dealer)}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-semibold hover:bg-blue-100 transition"
                      >
                        Edit Details
                      </button>
                      <Link
                        href={`/admin/quotations?dealerId=${dealer.id}`}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition"
                      >
                        Quotations
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="p-3 border-t border-gray-200 bg-gray-50/50">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                pageSize={pageSize}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize);
                  setPage(1);
                }}
                total={total}
              />
            </div>
          </>
        )}
      </div>



      {/* Update Discount Allocation Modal */}
      {discountDealer && (
        <Modal
          isOpen={Boolean(discountDealer)}
          onClose={() => setDiscountDealer(null)}
          title={`Discount Allocation for ${discountDealer.name}`}
          size="md"
        >
          <div className="space-y-4 pt-2">
            <p className="text-xs text-gray-500">
              Sets the maximum customer discount percentage this Dealer is authorized to offer.
            </p>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Authorized Discount Allocation (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={newDiscountPercent}
                  onChange={(e) => setNewDiscountPercent(Number(e.target.value))}
                  className="w-full pl-3 pr-8 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-mono font-bold focus:outline-none focus:border-gray-950"
                  placeholder="e.g. 20"
                  autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">%</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Note: This change applies to new quotations created by this dealer. Existing quotations retain their original snapshotted allocation.
              </p>
            </div>

            {/* Allocation History Audit */}
            {discountDealer.discountAllocationHistory && discountDealer.discountAllocationHistory.length > 0 && (
              <div className="pt-3 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 mb-2">Allocation History</h4>
                <div className="space-y-1.5 max-h-36 overflow-y-auto text-[11px] text-gray-500">
                  {discountDealer.discountAllocationHistory.slice().reverse().map((hist, idx) => (
                    <div key={idx} className="flex justify-between py-1 border-b border-gray-50">
                      <span>{hist.previousPercent}% → <strong className="text-purple-700">{hist.allocatedPercent}%</strong></span>
                      <span className="text-gray-400">{formatDate(hist.changedAt)} ({hist.changedByName || "Staff"})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDiscountDealer(null)}
                disabled={savingDiscount}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveDiscount}
                loading={savingDiscount}
              >
                Save Allocation
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Dealer Details Modal — feeds the Authorized Dealer section on proposals */}
      {editDealer && (
        <Modal
          isOpen={Boolean(editDealer)}
          onClose={() => setEditDealer(null)}
          title={`Edit Details for ${editDealer.name}`}
          size="md"
        >
          <div className="space-y-4 pt-2">
            <p className="text-xs text-gray-500">
              Shown under &quot;Authorized Dealer&quot; on this dealer&apos;s proposal PDFs. The dealer&apos;s
              login email is never shown to clients — only the business email set here.
            </p>
            <Input
              label="Company Name"
              value={editCompanyName}
              onChange={(e) => setEditCompanyName(e.target.value)}
              placeholder="e.g. Shah Smart Homes"
              helperText="Leave blank to show the dealer's personal name instead."
            />
            <Input
              label="Business Email"
              value={editBusinessEmail}
              onChange={(e) => setEditBusinessEmail(e.target.value)}
              placeholder="e.g. sales@dealercompany.com"
              helperText="Leave blank to show no email on proposals."
            />

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditDealer(null)}
                disabled={savingDealerDetails}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveDealerDetails}
                loading={savingDealerDetails}
              >
                Save Details
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
