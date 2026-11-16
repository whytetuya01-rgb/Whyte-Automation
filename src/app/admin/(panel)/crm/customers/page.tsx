"use client";

import { useState, useEffect, useCallback } from "react";
import EmptyState from "@/components/admin/EmptyState";
import Link from "next/link";
import {
  Contact,
  Plus,
  Search,
  RefreshCw,
  Phone,
  Mail,
  Building,
  FileText,
  Edit2,
  Trash2,
  ChevronRight,
  ExternalLink,
  Download,
  Users,
  Tag,
  Check,
  X,
  Zap,
  SlidersHorizontal,
  FolderSync,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Pagination from "@/components/shared/Pagination";
import { Button, Input, Select } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { Customer, CustomerType, PaginatedResponse } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";
import CustomerModal from "@/components/admin/crm/CustomerModal";
import BulkCustomerActionsModal, { type BulkActionType } from "@/components/admin/crm/BulkCustomerActionsModal";
import { TagChip, TagChips } from "@/components/admin/crm/LeadTags";
import type { TagCount } from "@/lib/leadTags";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { exportCustomersToExcel } from "@/lib/crmCustomerExport";

interface QuickEditDraft {
  name: string;
  customerType: CustomerType;
  companyName: string;
  phone: string;
  email: string;
  tags: string[];
}

export default function CustomersPage() {
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [search, setSearch] = useState("");
  const [customerType, setCustomerType] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);

  // Selection & Bulk Actions
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkModalAction, setBulkModalAction] = useState<BulkActionType>(null);
  const [exporting, setExporting] = useState(false);

  // Inline Quick Edit
  const [quickEditId, setQuickEditId] = useState<number | null>(null);
  const [quickEditDraft, setQuickEditDraft] = useState<QuickEditDraft | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      if (customerType !== "all") params.set("customerType", customerType);
      if (tagFilter) params.set("tag", tagFilter);

      const [res, tagRes] = await Promise.all([
        apiJson.get<PaginatedResponse<Customer>>(`/api/crm/customers?${params.toString()}`),
        apiJson.get<{ tags: TagCount[] }>("/api/crm/customer-tags").catch(() => null),
      ]);
      if (tagRes && Array.isArray(tagRes.tags)) setTagCounts(tagRes.tags);
      if (res) {
        setCustomers(res.data || []);
        setTotal(res.pagination.total);
        setTotalPages(res.pagination.totalPages);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, customerType, tagFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Clear selections when page changes
  useEffect(() => {
    setSelectedIds(new Set());
    setQuickEditId(null);
  }, [page, pageSize, search, customerType, tagFilter]);

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === customers.length && customers.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map((c) => c.id)));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Inline Quick Edit Handlers
  const startQuickEdit = (customer: Customer, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setQuickEditId(customer.id);
    setQuickEditDraft({
      name: customer.name || "",
      customerType: customer.customerType || "individual",
      companyName: customer.companyName || "",
      phone: customer.phone || "",
      email: customer.email || "",
      tags: [...(customer.tags || [])],
    });
    setNewTagInput("");
  };

  const cancelQuickEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setQuickEditId(null);
    setQuickEditDraft(null);
  };

  const saveQuickEdit = async (customerId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!quickEditDraft) return;

    if (!quickEditDraft.name.trim()) {
      notify.error("Validation error", "Customer name cannot be empty.");
      return;
    }

    setSavingQuickEdit(true);
    try {
      await apiJson.patch(`/api/crm/customers/${customerId}`, {
        name: quickEditDraft.name.trim(),
        customerType: quickEditDraft.customerType,
        companyName: quickEditDraft.companyName.trim() || null,
        phone: quickEditDraft.phone.trim() || null,
        email: quickEditDraft.email.trim() || null,
        tags: quickEditDraft.tags,
      });

      // Optimistically update table
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId
            ? {
                ...c,
                name: quickEditDraft.name.trim(),
                customerType: quickEditDraft.customerType,
                companyName: quickEditDraft.companyName.trim() || null,
                phone: quickEditDraft.phone.trim() || null,
                email: quickEditDraft.email.trim() || null,
                tags: quickEditDraft.tags,
              }
            : c
        )
      );

      notify.success("Quick saved", "Customer details updated successfully.");
      setQuickEditId(null);
      setQuickEditDraft(null);
    } catch (err) {
      notifyApiError(err, "Failed to quick update customer");
    } finally {
      setSavingQuickEdit(false);
    }
  };

  // Export handlers
  const handleExportSelected = async () => {
    const toExport = customers.filter((c) => selectedIds.has(c.id));
    if (toExport.length === 0) return;
    setExporting(true);
    try {
      await exportCustomersToExcel(toExport, `selected-customers-${toExport.length}.xlsx`);
      notify.success("Export complete", `Exported ${toExport.length} customers to Excel.`);
    } catch (err) {
      notify.error("Export failed", "Could not generate Excel spreadsheet.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      // Fetch all matching customers for export
      const params = new URLSearchParams({ page: "1", pageSize: "5000" });
      if (search.trim()) params.set("search", search.trim());
      if (customerType !== "all") params.set("customerType", customerType);
      if (tagFilter) params.set("tag", tagFilter);

      const res = await apiJson.get<PaginatedResponse<Customer>>(`/api/crm/customers?${params.toString()}`);
      const allCustomers = res?.data || customers;
      await exportCustomersToExcel(allCustomers, `whyte-customers-directory-${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify.success("Export complete", `Downloaded ${allCustomers.length} customers to Excel.`);
    } catch (err) {
      notifyApiError(err, "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleEdit = (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCustomer(customer);
    setModalOpen(true);
  };

  const handleDelete = async (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: `Archive Customer ${customer.name}?`,
      message: `Are you sure you want to archive ${customer.name}? Historical quotation documents will remain intact.`,
      confirmText: "Archive Customer",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await apiJson.delete(`/api/crm/customers/${customer.id}`);
      notify.success("Customer archived", `${customer.name}'s profile was archived.`);
      fetchCustomers();
    } catch (err) {
      notifyApiError(err, "Failed to archive customer");
    }
  };

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title="Central Customer Directory"
        subtitle="Unified client records linked across proposals, projects, and pipeline opportunities"
        icon={Contact}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportAll}
              loading={exporting}
              title="Download entire filtered customer database to Excel (.xlsx)"
            >
              <Download size={14} className="mr-1.5" />
              <span>Export All</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingCustomer(null);
                setModalOpen(true);
              }}
            >
              <Plus size={15} className="mr-1" />
              <span>New Customer</span>
            </Button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          <div className="sm:col-span-2">
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name, firm, phone, email, GST, or address..."
              className="text-xs"
            />
          </div>

          <Select
            value={customerType}
            onChange={(e) => {
              setCustomerType(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All Customer Types" },
              ...Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
            ]}
          />

          <Button type="button" variant="outline" size="sm" onClick={fetchCustomers} className="justify-center">
            <RefreshCw size={13} className="mr-1.5" />
            <span>Refresh</span>
          </Button>
        </div>
        {tagCounts.length > 0 && (
          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3" data-testid="tag-filter">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Tags</span>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              {tagCounts.slice(0, 20).map((entry) => (
                <span key={entry.tag} className="inline-flex shrink-0 items-center gap-1">
                  <TagChip
                    tag={entry.tag}
                    active={tagFilter?.toLowerCase() === entry.tag.toLowerCase()}
                    onClick={() => {
                      setTagFilter(tagFilter?.toLowerCase() === entry.tag.toLowerCase() ? null : entry.tag);
                      setPage(1);
                    }}
                  />
                  <span className="text-[10px] font-medium text-neutral-400">{entry.count}</span>
                </span>
              ))}
            </div>
            {tagFilter && (
              <button
                type="button"
                onClick={() => {
                  setTagFilter(null);
                  setPage(1);
                }}
                className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center">
            <LoadingSpinner />
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            icon={Contact}
            title="No customers found"
            text={
              search || customerType !== "all"
                ? "No customers match your search criteria."
                : "Add your first central customer or convert an existing lead."
            }
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingCustomer(null);
                  setModalOpen(true);
                }}
              >
                <Plus size={14} className="mr-1" />
                <span>Add Customer</span>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === customers.length && customers.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-neutral-300 text-accent focus:ring-accent cursor-pointer h-3.5 w-3.5"
                      title="Select all on this page"
                    />
                  </th>
                  <th className="py-3 px-3">Customer Name</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Contact Info</th>
                  <th className="py-3 px-3">Site / Billing Address</th>
                  <th className="py-3 px-3">Quotations</th>
                  <th className="py-3 px-3">Account Lead</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {customers.map((c) => {
                  const isSelected = selectedIds.has(c.id);
                  const isQuickEditing = quickEditId === c.id;

                  if (isQuickEditing && quickEditDraft) {
                    return (
                      <tr key={c.id} className="bg-amber-50/40 border-y-2 border-amber-300 transition">
                        <td className="py-3 px-3.5 text-center align-middle">
                          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                        </td>

                        {/* Editable Name & Company */}
                        <td className="py-3 px-3 min-w-[200px]">
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={quickEditDraft.name}
                              onChange={(e) => setQuickEditDraft({ ...quickEditDraft, name: e.target.value })}
                              placeholder="Full Name *"
                              className="w-full px-2 py-1 text-xs font-bold rounded border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                              autoFocus
                            />
                            <input
                              type="text"
                              value={quickEditDraft.companyName}
                              onChange={(e) => setQuickEditDraft({ ...quickEditDraft, companyName: e.target.value })}
                              placeholder="Company / Firm Name"
                              className="w-full px-2 py-1 text-[11px] rounded border border-neutral-200 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            {/* Inline Tag Manager */}
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              {quickEditDraft.tags.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 text-neutral-800"
                                >
                                  <span>{t}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setQuickEditDraft({
                                        ...quickEditDraft,
                                        tags: quickEditDraft.tags.filter((x) => x !== t),
                                      })
                                    }
                                    className="hover:text-rose-600"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              <div className="inline-flex items-center">
                                <input
                                  type="text"
                                  value={newTagInput}
                                  onChange={(e) => setNewTagInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && newTagInput.trim()) {
                                      e.preventDefault();
                                      if (!quickEditDraft.tags.includes(newTagInput.trim())) {
                                        setQuickEditDraft({
                                          ...quickEditDraft,
                                          tags: [...quickEditDraft.tags, newTagInput.trim()],
                                        });
                                      }
                                      setNewTagInput("");
                                    }
                                  }}
                                  placeholder="+ Tag"
                                  className="w-14 px-1 py-0.5 text-[10px] rounded border border-dashed border-neutral-300 bg-white"
                                />
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Editable Category */}
                        <td className="py-3 px-3">
                          <select
                            value={quickEditDraft.customerType}
                            onChange={(e) =>
                              setQuickEditDraft({
                                ...quickEditDraft,
                                customerType: e.target.value as CustomerType,
                              })
                            }
                            className="px-2 py-1 text-xs rounded border border-neutral-300 bg-white font-medium focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            {Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Editable Phone & Email */}
                        <td className="py-3 px-3">
                          <div className="space-y-1.5 min-w-[150px]">
                            <input
                              type="text"
                              value={quickEditDraft.phone}
                              onChange={(e) => setQuickEditDraft({ ...quickEditDraft, phone: e.target.value })}
                              placeholder="Phone (+91...)"
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-200 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <input
                              type="email"
                              value={quickEditDraft.email}
                              onChange={(e) => setQuickEditDraft({ ...quickEditDraft, email: e.target.value })}
                              placeholder="Email Address"
                              className="w-full px-2 py-1 text-[11px] rounded border border-neutral-200 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                        </td>

                        {/* Address (Read-only during quick edit) */}
                        <td className="py-3 px-3 max-w-[180px] text-neutral-500 truncate text-[11px]">
                          {c.siteAddress || c.billingAddress || "—"}
                        </td>

                        {/* Quotations */}
                        <td className="py-3 px-3 text-neutral-700 font-semibold">
                          {c.quotationsCount ?? 0}
                        </td>

                        {/* Lead */}
                        <td className="py-3 px-3 text-neutral-600 text-[11px]">
                          {c.assignedSales?.name || c.dealer?.companyName || "Direct"}
                        </td>

                        {/* Quick Save / Cancel Buttons */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => saveQuickEdit(c.id, e)}
                              disabled={savingQuickEdit}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold shadow-2xs transition"
                              title="Save Inline Changes"
                            >
                              <Check size={12} strokeWidth={2.5} />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={cancelQuickEdit}
                              disabled={savingQuickEdit}
                              className="inline-flex items-center px-2 py-1 bg-white hover:bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-xs font-medium transition"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-neutral-50/80 transition group ${
                        isSelected ? "bg-accent/5" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-3.5 text-center align-middle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(c.id)}
                          className="rounded border-neutral-300 text-accent focus:ring-accent cursor-pointer h-3.5 w-3.5"
                        />
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-3 min-w-[180px]">
                        <Link
                          href={`/admin/crm/customers/${c.id}`}
                          className="font-bold text-neutral-900 text-sm hover:text-accent transition flex items-center gap-1.5"
                        >
                          <span>{c.name}</span>
                          <ChevronRight
                            size={14}
                            className="text-neutral-400 group-hover:text-accent group-hover:translate-x-0.5 transition"
                          />
                        </Link>
                        {(c.companyName || c.designation) && (
                          <span className="block text-[11px] text-neutral-500 mt-0.5" data-testid="customer-firm">
                            {[c.designation, c.companyName].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        {c.gstNumber && (
                          <span className="font-mono text-[10px] text-neutral-400 font-medium block mt-0.5">
                            GST: {c.gstNumber}
                          </span>
                        )}
                        {c.tags && c.tags.length > 0 && (
                          <div className="mt-1">
                            <TagChips tags={c.tags} max={3} />
                          </div>
                        )}
                      </td>

                      {/* Customer Type */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200">
                          {CUSTOMER_TYPE_LABELS[c.customerType] || c.customerType}
                        </span>
                      </td>

                      {/* Contact Info */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {c.phone && (
                          <div className="flex items-center gap-1.5 text-neutral-800 font-medium">
                            <Phone size={12} className="text-neutral-400" />
                            <span>{c.phone}</span>
                          </div>
                        )}
                        {c.email && (
                          <div className="flex items-center gap-1.5 text-neutral-500 text-[11px] mt-0.5">
                            <Mail size={12} className="text-neutral-400" />
                            <span>{c.email}</span>
                          </div>
                        )}
                      </td>

                      {/* Address */}
                      <td className="py-3.5 px-3 max-w-[200px] text-neutral-600 truncate">
                        {c.siteAddress || c.billingAddress || "—"}
                      </td>

                      {/* Quotations Count */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-neutral-800">
                          <FileText size={13} className="text-accent" />
                          <span>{c.quotationsCount ?? 0}</span>
                        </span>
                      </td>

                      {/* Account Lead */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-neutral-700 font-medium">
                        {c.assignedSales?.name || c.dealer?.companyName || "Direct"}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={(e) => startQuickEdit(c, e)}
                            className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition"
                            title="Quick Inline Edit (No Modal)"
                          >
                            <Zap size={13} />
                          </button>
                          <Link
                            href={`/admin/crm/customers/${c.id}`}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition"
                            title="View Profile & History"
                          >
                            <ExternalLink size={13} />
                          </Link>
                          <button
                            type="button"
                            onClick={(e) => handleEdit(c, e)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition"
                            title="Full Edit Modal"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(c, e)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            title="Archive Customer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!loading && total > 0 && (
          <div className="border-t border-neutral-100 px-4 py-2">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              entityName="customers"
            />
          </div>
        )}
      </div>

      {/* Sticky Floating Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-neutral-900/95 text-white backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl border border-neutral-700/60 flex items-center gap-3.5 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-2 pr-2 border-r border-neutral-700">
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            <span className="text-xs font-bold whitespace-nowrap">
              {selectedIds.size} Selected
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBulkModalAction("assign")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            >
              <Users size={13} />
              <span>Assign</span>
            </button>

            <button
              type="button"
              onClick={() => setBulkModalAction("tag")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            >
              <Tag size={13} />
              <span>Tag</span>
            </button>

            <button
              type="button"
              onClick={() => setBulkModalAction("updateType")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            >
              <FolderSync size={13} />
              <span>Category</span>
            </button>

            <button
              type="button"
              onClick={handleExportSelected}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            >
              <Download size={13} />
              <span>Export</span>
            </button>

            <button
              type="button"
              onClick={() => setBulkModalAction("delete")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition"
            >
              <Trash2 size={13} />
              <span>Archive</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-neutral-400 hover:text-white p-1 rounded-lg ml-1"
            title="Deselect All"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Modals */}
      <BulkCustomerActionsModal
        action={bulkModalAction}
        selectedIds={Array.from(selectedIds)}
        onClose={() => setBulkModalAction(null)}
        onSuccess={() => {
          setSelectedIds(new Set());
          fetchCustomers();
        }}
      />

      <CustomerModal
        isOpen={modalOpen}
        customer={editingCustomer}
        onClose={() => {
          setModalOpen(false);
          setEditingCustomer(null);
        }}
        onSaved={fetchCustomers}
      />
    </div>
  );
}
