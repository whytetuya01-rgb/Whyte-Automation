"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Mail,
  Phone,
  MapPin,
  Receipt,
  Calendar,
  Edit2,
  Eye,
  UserPlus,
  EyeOff,
  Sparkles,
  Lock,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError, safeMessage } from "@/lib/apiClient";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Pagination from "@/components/shared/Pagination";
import { Input, Button, Select, Textarea } from "@/components/ui";
import { SearchableSelect, type SelectOption } from "@/components/ui/SearchableSelect";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  companyId?: number;
  assignedCompanyName?: string | null;
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
  const router = useRouter();

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

  // Selected Dealer for Detailed View Modal
  const [selectedDealer, setSelectedDealer] = useState<DealerItem | null>(null);

  // Discount Allocation Modal
  const [discountDealer, setDiscountDealer] = useState<DealerItem | null>(null);
  const [newDiscountPercent, setNewDiscountPercent] = useState<number>(0);
  const [savingDiscount, setSavingDiscount] = useState(false);

  // Edit Dealer Modal
  const [editDealer, setEditDealer] = useState<DealerItem | null>(null);
  const [savingDealer, setSavingDealer] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    contactNumber: "",
    companyName: "",
    businessEmail: "",
    gstNumber: "",
    address: "",
    discountAllocationPercent: 0,
    companyId: 0,
  });

  // Create Dealer Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [creatingDealer, setCreatingDealer] = useState(false);
  const [createForm, setCreateForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    contactNumber: "",
    companyName: "",
    businessEmail: "",
    gstNumber: "",
    address: "",
    discountAllocationPercent: 0,
    companyId: 0,
  });

  // Multi-tenant companies list for Super Admin
  const [platformCompanies, setPlatformCompanies] = useState<Array<{ id: number; name: string; slug: string }>>([]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetch("/api/platform/companies")
        .then((res) => res.json())
        .then((json) => {
          if (json?.data) setPlatformCompanies(json.data);
        })
        .catch(() => {});
    }
  }, [isSuperAdmin]);

  // Memoized company options for SearchableSelect with primary default option
  const companySelectOptions: SelectOption[] = useMemo(() => {
    return [
      {
        value: "0",
        label: "Default Company (Whyte Automations)",
        subLabel: "Primary system tenant",
      },
      ...platformCompanies.map((c) => ({
        value: String(c.id),
        label: `${c.name} (ID: ${c.id})`,
        subLabel: c.slug,
      })),
    ];
  }, [platformCompanies]);

  // Keep selectedDealer in sync when dealers data is updated/refreshed
  useEffect(() => {
    if (selectedDealer) {
      const refreshed = dealers.find((d) => d.id === selectedDealer.id);
      if (refreshed) {
        setSelectedDealer(refreshed);
      }
    }
  }, [dealers]);

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
    setEditForm({
      firstName: dealer.firstName || dealer.name.split(" ")[0] || "",
      lastName: dealer.lastName || dealer.name.split(" ").slice(1).join(" ") || "",
      email: dealer.email || "",
      password: "",
      contactNumber: dealer.contactNumber || "",
      companyName: dealer.companyName || "",
      businessEmail: dealer.businessEmail || "",
      gstNumber: dealer.gstNumber || "",
      address: dealer.address || "",
      discountAllocationPercent: dealer.discountAllocationPercent || 0,
      companyId: dealer.companyId || 0,
    });
    setShowEditPassword(false);
  };

  const handleSaveDealer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDealer) return;
    if (!editForm.firstName.trim()) {
      notify.error("First Name required", "Please enter the dealer's first name.");
      return;
    }
    if (!editForm.lastName.trim()) {
      notify.error("Last Name required", "Please enter the dealer's last name.");
      return;
    }
    if (!editForm.email.trim()) {
      notify.error("Email required", "Please enter a valid login email.");
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      notify.error("Password too short", "Password must be at least 8 characters.");
      return;
    }

    setSavingDealer(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim().toLowerCase(),
        contactNumber: editForm.contactNumber.trim() || undefined,
        companyName: editForm.companyName.trim() || null,
        businessEmail: editForm.businessEmail.trim() || null,
        gstNumber: editForm.gstNumber.trim().toUpperCase() || null,
        address: editForm.address.trim() || null,
        discountAllocationPercent: Number(editForm.discountAllocationPercent) || 0,
      };

      if (editForm.password && editForm.password.trim().length >= 8) {
        payload.password = editForm.password;
      }

      if (isSuperAdmin && editForm.companyId > 0) {
        payload.companyId = editForm.companyId;
      }

      await apiJson.patch(`/api/admin/dealers/${editDealer.id}`, payload);
      notify.success(
        "Dealer Updated Successfully",
        `Account and profile details for ${editForm.firstName} ${editForm.lastName} have been saved.`
      );
      setEditDealer(null);
      fetchDealers();
    } catch (err: unknown) {
      notifyApiError(err, "Update failed", "Could not update dealer account.");
    } finally {
      setSavingDealer(false);
    }
  };

  const handleGeneratePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let generated = "";
    for (let i = 0; i < 12; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCreateForm((prev) => ({ ...prev, password: generated }));
    setShowPassword(true);
  };

  const handleGenerateEditPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let generated = "";
    for (let i = 0; i < 12; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setEditForm((prev) => ({ ...prev, password: generated }));
    setShowEditPassword(true);
  };

  const handleCreateDealer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.firstName.trim()) {
      notify.error("First Name required", "Please enter the dealer's first name.");
      return;
    }
    if (!createForm.lastName.trim()) {
      notify.error("Last Name required", "Please enter the dealer's last name.");
      return;
    }
    if (!createForm.email.trim()) {
      notify.error("Email required", "Please enter a valid login email address.");
      return;
    }
    if (!createForm.password || createForm.password.length < 8) {
      notify.error("Password required", "Password must be at least 8 characters.");
      return;
    }
    if (!createForm.contactNumber.trim()) {
      notify.error("Phone required", "Please enter a contact mobile number.");
      return;
    }

    setCreatingDealer(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: createForm.firstName.trim(),
        lastName: createForm.lastName.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        contactNumber: createForm.contactNumber.trim(),
        companyName: createForm.companyName.trim() || null,
        businessEmail: createForm.businessEmail.trim() || null,
        gstNumber: createForm.gstNumber.trim().toUpperCase() || null,
        address: createForm.address.trim() || null,
        discountAllocationPercent: Number(createForm.discountAllocationPercent) || 0,
      };

      if (isSuperAdmin && createForm.companyId > 0) {
        payload.companyId = createForm.companyId;
      }

      const res = await apiJson.post<{ data: DealerItem }>("/api/admin/dealers", payload);
      notify.success(
        "Dealer Created Successfully",
        `Account for ${res.data.name} (${res.data.email}) has been provisioned and is ready for use.`
      );
      setIsCreateModalOpen(false);
      setCreateForm({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        contactNumber: "",
        companyName: "",
        businessEmail: "",
        gstNumber: "",
        address: "",
        discountAllocationPercent: 0,
        companyId: 0,
      });
      fetchDealers();
    } catch (err: unknown) {
      notifyApiError(err, "Failed to create dealer", "Could not create dealer account.");
    } finally {
      setCreatingDealer(false);
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Top Header */}
      <PageHeader
        title="Dealer Management"
        icon={Users}
        subtitle={`${total} registered partner${total !== 1 ? "s" : ""} recorded in system`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRefreshing(true);
                fetchDealers();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin text-[var(--color-admin-primary,#D85B83)]" : ""} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => {
                setCreateForm({
                  firstName: "",
                  lastName: "",
                  email: "",
                  password: "",
                  contactNumber: "",
                  companyName: "",
                  businessEmail: "",
                  gstNumber: "",
                  address: "",
                  discountAllocationPercent: 0,
                  companyId: 0,
                });
                setShowPassword(false);
                setIsCreateModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-gray-900 rounded-xl hover:bg-black transition shadow-2xs cursor-pointer"
            >
              <UserPlus size={14} />
              <span>Create Dealer</span>
            </button>
          </div>
        }
      />

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
                      <tr
                        key={dealer.id}
                        onClick={() => router.push(`/admin/quotations?dealerId=${dealer.id}`)}
                        className="hover:bg-gray-50/70 transition-colors cursor-pointer group"
                        title="Click to view dealer's quotations"
                      >
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-gray-950 text-sm group-hover:text-black">{dealer.name}</p>
                          {dealer.companyName && (
                            <p className="text-gray-600 text-xs font-medium">{dealer.companyName}</p>
                          )}
                          <p className="text-gray-400 text-xs">{dealer.email}</p>
                          {dealer.businessEmail && (
                            <p className="text-gray-400 text-xs" title="Business email shown on proposals">
                              {dealer.businessEmail}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {dealer.gstNumber && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                GST: {dealer.gstNumber}
                              </span>
                            )}
                            {isSuperAdmin && dealer.assignedCompanyName && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                                <Building size={10} />
                                <span>{dealer.assignedCompanyName}</span>
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-gray-600">
                          <p className="font-medium">{dealer.contactNumber || "No phone"}</p>
                          <p className="text-[11px] text-gray-400 truncate max-w-[200px]" title={dealer.address || ""}>
                            {dealer.address || "No address provided"}
                          </p>
                        </td>



                        <td className="px-4 py-3.5 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDiscountModal(dealer);
                            }}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStatus(dealer);
                              }}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDealer(dealer);
                              }}
                              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                              title="View Dealer Details"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditDealerModal(dealer);
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                              title="Edit Dealer Account & Profile"
                            >
                              <Edit2 size={16} />
                            </button>
                            <Link
                              href={`/admin/quotations?dealerId=${dealer.id}`}
                              onClick={(e) => e.stopPropagation()}
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
                  <div
                    key={dealer.id}
                    onClick={() => router.push(`/admin/quotations?dealerId=${dealer.id}`)}
                    className="p-4 space-y-3 hover:bg-gray-50/70 transition-colors cursor-pointer"
                    title="Click to view dealer's quotations"
                  >
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

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDealer(dealer);
                        }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded-lg font-semibold hover:bg-gray-200 transition cursor-pointer"
                      >
                        View Details
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDiscountModal(dealer);
                        }}
                        className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg font-semibold hover:bg-purple-100 transition cursor-pointer"
                      >
                        Set Discount
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditDealerModal(dealer);
                        }}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-semibold hover:bg-blue-100 transition cursor-pointer"
                      >
                        Edit Dealer
                      </button>
                      <Link
                        href={`/admin/quotations?dealerId=${dealer.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 bg-gray-900 text-white rounded-lg font-semibold hover:bg-black transition"
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

      {/* Comprehensive Edit Dealer Modal */}
      {editDealer && (
        <Modal
          isOpen={Boolean(editDealer)}
          onClose={() => {
            if (!savingDealer) setEditDealer(null);
          }}
          title={`Edit Dealer: ${editDealer.name}`}
          size="2xl"
        >
          <form onSubmit={handleSaveDealer} className="space-y-5 pt-1">
            {/* Section 1: Account Credentials */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                1. Account & Login Credentials
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  placeholder="e.g. Ramesh"
                  required
                />
                <Input
                  label="Last Name"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  placeholder="e.g. Patel"
                  required
                />
                <Input
                  label="Login Email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="e.g. ramesh@dealer.com"
                  helperText="Primary email used to sign into the Whyte portal."
                  required
                />
                <Input
                  label="Mobile Contact Number"
                  type="tel"
                  value={editForm.contactNumber}
                  onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                  placeholder="10-digit mobile number"
                  helperText="Required for portal notifications & SMS."
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Reset Password <span className="text-gray-400 font-normal">(Leave blank to keep existing)</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateEditPassword}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    title="Generate secure password"
                  >
                    <Sparkles size={12} className="text-amber-500" />
                    <span>Auto-generate</span>
                  </button>
                </div>
                <Input
                  type={showEditPassword ? "text" : "password"}
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Enter new password (min. 8 characters) or leave blank"
                  helperText="Only fill this if you want to update the dealer's login password."
                  leftIcon={<Lock size={15} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      className="p-1 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                      title={showEditPassword ? "Hide password" : "Show password"}
                    >
                      {showEditPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
              </div>
            </div>

            {/* Section 2: Business & Commercial Profile */}
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                2. Business Profile & Quotation Branding
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Company / Agency Name"
                  value={editForm.companyName}
                  onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                  placeholder="e.g. Patel Smart Living"
                  helperText="Appears under Authorized Dealer on proposal PDFs."
                />
                <Input
                  label="Business Email for Proposals"
                  type="email"
                  value={editForm.businessEmail}
                  onChange={(e) => setEditForm({ ...editForm, businessEmail: e.target.value })}
                  placeholder="e.g. sales@patelsmart.com"
                  helperText="Public contact email shown on client proposals."
                />
                <Input
                  label="GST Number"
                  value={editForm.gstNumber}
                  onChange={(e) => setEditForm({ ...editForm, gstNumber: e.target.value.toUpperCase() })}
                  placeholder="15-character GSTIN"
                  maxLength={15}
                />
                <Input
                  label="Discount Allocation (%)"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={editForm.discountAllocationPercent}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      discountAllocationPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  rightIcon={<Percent size={14} className="text-gray-400" />}
                  helperText="Max discount this dealer can pass on to clients (0-100%)."
                />
              </div>

              <Textarea
                label="Business Address"
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                placeholder="Office / Showroom address..."
                rows={2}
              />

              {/* Super Admin: Organization Reassignment */}
              {isSuperAdmin && (
                <div className="pt-2 border-t border-gray-100">
                  <SearchableSelect
                    label="Assigned Tenant Organization (Super Admin Control)"
                    value={String(editForm.companyId || "0")}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        companyId: Number(e.target.value) || 0,
                      })
                    }
                    options={companySelectOptions}
                    placeholder="Select tenant organization"
                    searchPlaceholder="Search company by name or ID..."
                    helperText="Reassigning tenant organization moves this dealer under another company."
                    direction="auto"
                  />
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditDealer(null)}
                disabled={savingDealer}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={savingDealer}
              >
                Save Changes
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Dealer Details Modal */}
      {selectedDealer && (
        <Modal
          isOpen={Boolean(selectedDealer)}
          onClose={() => setSelectedDealer(null)}
          title="Dealer Details"
          size="2xl"
        >
          <div className="space-y-5 pt-1">
            {/* Dealer Header Profile Card */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-br from-gray-50 via-gray-50 to-gray-100/70 border border-gray-200/80">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white font-bold text-lg flex items-center justify-center shrink-0 shadow-xs">
                  {selectedDealer.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-950 text-base truncate">{selectedDealer.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                        selectedDealer.isActive
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {selectedDealer.isActive ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {selectedDealer.isActive ? "Active Partner" : "Inactive Partner"}
                    </span>
                  </div>
                  {selectedDealer.companyName && (
                    <p className="text-xs font-medium text-gray-600 flex items-center gap-1.5 mt-0.5 truncate">
                      <Building size={13} className="text-gray-400 shrink-0" />
                      <span>{selectedDealer.companyName}</span>
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                    <Calendar size={12} className="text-gray-400 shrink-0" />
                    <span>Registered: {formatDate(selectedDealer.createdAt)}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenEditDealerModal(selectedDealer)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                >
                  <Edit2 size={13} />
                  <span>Edit Dealer</span>
                </button>
                <Link
                  href={`/admin/quotations?dealerId=${selectedDealer.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gray-900 rounded-xl hover:bg-black transition shadow-2xs"
                >
                  <FileText size={13} />
                  <span>Quotations</span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            </div>

            {/* Performance & Commercial Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Discount Allocation */}
              <div className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/50">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700">Allocated Discount</span>
                  <button
                    type="button"
                    onClick={() => handleOpenDiscountModal(selectedDealer)}
                    className="text-[10px] font-bold text-purple-700 hover:text-purple-900 underline cursor-pointer"
                  >
                    Change
                  </button>
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-mono font-bold text-purple-950">
                    {selectedDealer.discountAllocationPercent || 0}%
                  </span>
                </div>
                <p className="text-[11px] text-purple-700/80 mt-0.5">Max customer discount</p>
              </div>

              {/* Accumulated Earnings */}
              <div className="p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/50">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Accumulated Earnings</span>
                <div className="mt-1">
                  <span className="text-xl font-mono font-bold text-emerald-950">
                    {formatCurrency(selectedDealer.accumulatedEarnings || 0)}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-700/80 mt-0.5">From confirmed orders</p>
              </div>

              {/* Quotations Count */}
              <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/70">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Total Quotations</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-mono font-bold text-gray-950">
                    {selectedDealer.quotationStats.total}
                  </span>
                  <span className="text-xs text-gray-500">proposals</span>
                </div>
                <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                  {selectedDealer.quotationStats.approved + selectedDealer.quotationStats.delivered} confirmed
                </p>
              </div>
            </div>

            {/* Quotations Pipeline Breakdown */}
            <div className="p-3.5 rounded-xl border border-gray-200/80 bg-white space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
                Quotations Pipeline Breakdown
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-center">
                <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
                  <p className="text-xs text-gray-500">Draft</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{selectedDealer.quotationStats.draft}</p>
                </div>
                <div className="p-2 rounded-lg bg-blue-50/60 border border-blue-100">
                  <p className="text-xs text-blue-700">Sent</p>
                  <p className="text-sm font-bold text-blue-900 mt-0.5">{selectedDealer.quotationStats.sent}</p>
                </div>
                <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
                  <p className="text-xs text-emerald-700">Approved</p>
                  <p className="text-sm font-bold text-emerald-900 mt-0.5">{selectedDealer.quotationStats.approved}</p>
                </div>
                <div className="p-2 rounded-lg bg-teal-50/60 border border-teal-100">
                  <p className="text-xs text-teal-700">Delivered</p>
                  <p className="text-sm font-bold text-teal-900 mt-0.5">{selectedDealer.quotationStats.delivered}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50/60 border border-red-100 col-span-2 sm:col-span-1">
                  <p className="text-xs text-red-700">Rejected</p>
                  <p className="text-sm font-bold text-red-900 mt-0.5">{selectedDealer.quotationStats.rejected}</p>
                </div>
              </div>
            </div>

            {/* Detailed Contact and Business Information */}
            <div className="p-4 rounded-xl border border-gray-200/80 bg-white space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
                Contact & Partner Credentials
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-gray-50/60 border border-gray-100">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Login Email</span>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-gray-900">
                    <Mail size={13} className="text-gray-400 shrink-0" />
                    <span className="truncate">{selectedDealer.email}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/60 border border-gray-100">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Business Email (Proposals)</span>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-gray-900">
                    <Mail size={13} className="text-gray-400 shrink-0" />
                    <span className="truncate">{selectedDealer.businessEmail || "Same as login email"}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/60 border border-gray-100">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Contact Phone</span>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-gray-900">
                    <Phone size={13} className="text-gray-400 shrink-0" />
                    <span>{selectedDealer.contactNumber || "Not provided"}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/60 border border-gray-100">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">GST Number</span>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-gray-900 font-mono">
                    <Receipt size={13} className="text-gray-400 shrink-0" />
                    <span>{selectedDealer.gstNumber || "Not registered"}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/60 border border-gray-100 sm:col-span-2">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Company Address</span>
                  <div className="flex items-start gap-1.5 mt-1 font-medium text-gray-900">
                    <MapPin size={13} className="text-gray-400 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-line">{selectedDealer.address || "No address provided"}</span>
                  </div>
                </div>

                {selectedDealer.assignedCompanyName && (
                  <div className="p-2.5 rounded-lg bg-purple-50/60 border border-purple-100 sm:col-span-2">
                    <span className="text-purple-600 block text-[10px] uppercase font-bold">Assigned Tenant Organization</span>
                    <div className="flex items-center gap-1.5 mt-1 font-semibold text-purple-950">
                      <Building size={13} className="text-purple-500 shrink-0" />
                      <span>{selectedDealer.assignedCompanyName}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-200">
              {isSuperAdmin ? (
                <button
                  type="button"
                  onClick={() => handleToggleStatus(selectedDealer)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border cursor-pointer ${
                    selectedDealer.isActive
                      ? "text-red-700 bg-red-50 hover:bg-red-100 border-red-200"
                      : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200"
                  }`}
                >
                  {selectedDealer.isActive ? "Deactivate Account" : "Activate Account"}
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedDealer(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Dealer Modal */}
      {isCreateModalOpen && (
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => {
            if (!creatingDealer) setIsCreateModalOpen(false);
          }}
          title="Create New Dealer Account"
          size="2xl"
        >
          <form onSubmit={handleCreateDealer} className="space-y-5 pt-1">
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900 leading-relaxed">
              <span className="font-semibold">Administrator Provisioning:</span> Dealer self-registration is disabled. Enter credentials and business profile to create this dealer. They can immediately log in with the assigned email and password.
            </div>

            {/* Section 1: Account Credentials */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                1. Account & Login Credentials
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                  placeholder="e.g. Ramesh"
                  required
                />
                <Input
                  label="Last Name"
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                  placeholder="e.g. Patel"
                  required
                />
                <Input
                  label="Login Email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="e.g. ramesh@dealer.com"
                  helperText="Primary email used to sign into the Whyte portal."
                  required
                />
                <Input
                  label="Mobile Contact Number"
                  type="tel"
                  value={createForm.contactNumber}
                  onChange={(e) => setCreateForm({ ...createForm, contactNumber: e.target.value })}
                  placeholder="10-digit mobile number"
                  helperText="Required for portal notifications & SMS."
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Initial Password <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    title="Generate secure password"
                  >
                    <Sparkles size={12} className="text-amber-500" />
                    <span>Auto-generate</span>
                  </button>
                </div>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="Minimum 8 characters"
                  helperText="Provide this password to the dealer so they can log in."
                  required
                  leftIcon={<Lock size={15} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
              </div>
            </div>

            {/* Section 2: Business & Commercial Profile */}
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                2. Business Profile & Quotation Branding (Optional)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Company / Agency Name"
                  value={createForm.companyName}
                  onChange={(e) => setCreateForm({ ...createForm, companyName: e.target.value })}
                  placeholder="e.g. Patel Smart Living"
                  helperText="Appears under Authorized Dealer on proposal PDFs."
                />
                <Input
                  label="Business Email for Proposals"
                  type="email"
                  value={createForm.businessEmail}
                  onChange={(e) => setCreateForm({ ...createForm, businessEmail: e.target.value })}
                  placeholder="e.g. sales@patelsmart.com"
                  helperText="Public contact email shown on client proposals."
                />
                <Input
                  label="GST Number"
                  value={createForm.gstNumber}
                  onChange={(e) => setCreateForm({ ...createForm, gstNumber: e.target.value.toUpperCase() })}
                  placeholder="15-character GSTIN"
                  maxLength={15}
                />
                <Input
                  label="Discount Allocation (%)"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={createForm.discountAllocationPercent}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      discountAllocationPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  rightIcon={<Percent size={14} className="text-gray-400" />}
                  helperText="Max discount this dealer can pass on to clients (0-100%)."
                />
              </div>

              <Textarea
                label="Business Address"
                value={createForm.address}
                onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
                placeholder="Office / Showroom address..."
                rows={2}
              />

              {/* Super Admin: Organization Assignment */}
              {isSuperAdmin && (
                <div className="pt-2 border-t border-gray-100">
                  <SearchableSelect
                    label="Assigned Tenant Organization (Super Admin Control)"
                    value={String(createForm.companyId || "0")}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        companyId: Number(e.target.value) || 0,
                      })
                    }
                    options={companySelectOptions}
                    placeholder="Select tenant organization"
                    searchPlaceholder="Search company by name or ID..."
                    helperText="Select which company organization this dealer will be created under."
                    direction="auto"
                  />
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={creatingDealer}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={creatingDealer}
              >
                Create Dealer
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
