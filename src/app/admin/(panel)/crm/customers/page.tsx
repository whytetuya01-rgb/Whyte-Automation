"use client";

import { useState, useEffect, useCallback } from "react";
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
import { useConfirm } from "@/components/providers/ConfirmProvider";

export default function CustomersPage() {
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Filters
  const [search, setSearch] = useState("");
  const [customerType, setCustomerType] = useState<string>("all");

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

      const res = await apiJson.get<PaginatedResponse<Customer>>(`/api/crm/customers?${params.toString()}`);
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
  }, [page, pageSize, search, customerType]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

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
    <div className="space-y-5">
      <PageHeader
        title="Central Customer Directory"
        subtitle="Unified client records linked across proposals, projects, and pipeline opportunities"
        icon={Contact}
        actions={
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
              placeholder="Search by customer name, phone, email, GST, or address..."
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
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center">
            <LoadingSpinner />
          </div>
        ) : customers.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
              <Contact size={24} />
            </div>
            <h3 className="text-base font-bold text-neutral-900">No customers found</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              {search || customerType !== "all"
                ? "No customers match your search criteria."
                : "Add your first central customer or convert an existing lead."}
            </p>
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
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Contact Info</th>
                  <th className="py-3 px-4">Site / Billing Address</th>
                  <th className="py-3 px-4">Quotations</th>
                  <th className="py-3 px-4">Account Lead</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {customers.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-neutral-50/80 transition group"
                  >
                    {/* Name */}
                    <td className="py-3.5 px-4 min-w-[180px]">
                      <Link
                        href={`/admin/crm/customers/${c.id}`}
                        className="font-bold text-neutral-900 text-sm hover:text-accent transition flex items-center gap-1.5"
                      >
                        <span>{c.name}</span>
                        <ChevronRight size={14} className="text-neutral-400 group-hover:text-accent group-hover:translate-x-0.5 transition" />
                      </Link>
                      {c.gstNumber && (
                        <span className="font-mono text-[10px] text-neutral-400 font-medium block mt-0.5">
                          GST: {c.gstNumber}
                        </span>
                      )}
                    </td>

                    {/* Customer Type */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200">
                        {CUSTOMER_TYPE_LABELS[c.customerType] || c.customerType}
                      </span>
                    </td>

                    {/* Contact Info */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
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
                    <td className="py-3.5 px-4 max-w-[200px] text-neutral-600 truncate">
                      {c.siteAddress || c.billingAddress || "—"}
                    </td>

                    {/* Quotations Count */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-semibold text-neutral-800">
                        <FileText size={13} className="text-accent" />
                        <span>{c.quotationsCount ?? 0}</span>
                      </span>
                    </td>

                    {/* Account Lead */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-neutral-700 font-medium">
                      {c.assignedSales?.name || c.dealer?.companyName || "Direct"}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
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
                          title="Edit Customer"
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
                ))}
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
              onPageSizeChange={setPageSize}
              entityName="customers"
            />
          </div>
        )}
      </div>

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
