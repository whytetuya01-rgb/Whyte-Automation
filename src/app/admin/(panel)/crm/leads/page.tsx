"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  UserCheck,
  Plus,
  Search,
  RefreshCw,
  Kanban,
  Phone,
  MessageCircle,
  Mail,
  Calendar,
  Sparkles,
  Flame,
  ArrowRight,
  MoreHorizontal,
  Trash2,
  Edit2,
  ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Pagination from "@/components/shared/Pagination";
import { Button, Input, Select } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Lead, LeadPriority, LeadStatus, PaginatedResponse } from "@/types/crm";
import { LEAD_PRIORITY_CONFIG, LEAD_STATUS_CONFIG } from "@/types/crm";
import LeadModal from "@/components/admin/crm/LeadModal";
import LeadDetailDrawer from "@/components/admin/crm/LeadDetailDrawer";
import { useConfirm } from "@/components/providers/ConfirmProvider";

export default function LeadsPage() {
  const confirm = useConfirm();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");

  // Modals & Drawers
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      if (status !== "all") params.set("status", status);
      if (priority !== "all") params.set("priority", priority);

      const res = await apiJson.get<PaginatedResponse<Lead>>(`/api/crm/leads?${params.toString()}`);
      if (res) {
        setLeads(res.data || []);
        setTotal(res.pagination.total);
        setTotalPages(res.pagination.totalPages);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status, priority]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleOpenDrawer = (lead: Lead) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };

  const handleEditLead = (lead: Lead) => {
    setEditingLead(lead);
    setLeadModalOpen(true);
  };

  const handleDeleteLead = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: `Archive Lead ${lead.referenceNumber}?`,
      message: `Are you sure you want to archive the lead for ${lead.customerName}? Historical quotation links will remain safe.`,
      confirmText: "Archive Lead",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await apiJson.delete(`/api/crm/leads/${lead.id}`);
      notify.success("Lead archived", `Lead ${lead.referenceNumber} was archived.`);
      fetchLeads();
      if (selectedLead?.id === lead.id) {
        setDrawerOpen(false);
      }
    } catch (err) {
      notifyApiError(err, "Failed to archive lead");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads Management"
        subtitle="Capture inquiries, track client requirements, and drive quotations through the pipeline"
        icon={UserCheck}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/crm/pipeline"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-xl transition shadow-2xs"
            >
              <Kanban size={14} className="text-neutral-500" />
              <span>Pipeline Board</span>
            </Link>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingLead(null);
                setLeadModalOpen(true);
              }}
            >
              <Plus size={15} className="mr-1" />
              <span>New Lead</span>
            </Button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-3">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: "all", label: "All Leads" },
            { id: "new", label: "New" },
            { id: "contacted", label: "Contacted" },
            { id: "site_visit", label: "Site Visit" },
            { id: "quoted", label: "Quoted" },
            { id: "negotiation", label: "Negotiation" },
            { id: "won", label: "Won 🎉" },
            { id: "lost", label: "Lost" },
          ].map((st) => {
            const isActive = status === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => {
                  setStatus(st.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer shrink-0 ${
                  isActive
                    ? "bg-neutral-900 text-white shadow-2xs"
                    : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 border border-neutral-200"
                }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        {/* Search & Select Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          <div className="sm:col-span-2">
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by client name, ref LD-..., phone, email, project..."
              className="text-xs"
            />
          </div>

          <Select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All Priorities" },
              { value: "urgent", label: "Urgent Priority" },
              { value: "high", label: "High Priority" },
              { value: "medium", label: "Medium Priority" },
              { value: "low", label: "Low Priority" },
            ]}
          />

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchLeads}
              className="w-full justify-center"
            >
              <RefreshCw size={13} className="mr-1.5" />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Leads Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center">
            <LoadingSpinner />
          </div>
        ) : leads.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
              <UserCheck size={24} />
            </div>
            <h3 className="text-base font-bold text-neutral-900">No leads found</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              {search || status !== "all"
                ? "No leads match your current search or filter parameters."
                : "Start building your sales pipeline by adding your first lead."}
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingLead(null);
                setLeadModalOpen(true);
              }}
            >
              <Plus size={14} className="mr-1" />
              <span>Create First Lead</span>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Ref #</th>
                  <th className="py-3 px-4">Customer & Project</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Est. Value</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">Quotation</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {leads.map((lead) => {
                  const priorityStyle = LEAD_PRIORITY_CONFIG[lead.priority] || LEAD_PRIORITY_CONFIG.medium;
                  const statusStyle = LEAD_STATUS_CONFIG[lead.status] || LEAD_STATUS_CONFIG.new;

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => handleOpenDrawer(lead)}
                      className="hover:bg-neutral-50/80 transition cursor-pointer group"
                    >
                      {/* Ref */}
                      <td className="py-3.5 px-4 font-mono font-bold text-neutral-800">
                        {lead.referenceNumber}
                      </td>

                      {/* Customer & Project */}
                      <td className="py-3.5 px-4 min-w-[180px]">
                        <div className="font-bold text-neutral-900 text-sm flex items-center gap-1.5">
                          <span>{lead.customerName}</span>
                          {lead.isHotLead && (
                            <span title="Hot Lead — Quotation viewed multiple times">
                              <Flame size={13} className="text-amber-500 fill-amber-500 shrink-0" />
                            </span>
                          )}
                        </div>
                        {lead.projectType && (
                          <div className="text-[11px] text-neutral-500 font-medium mt-0.5">
                            {lead.projectType} {lead.location ? `• ${lead.location}` : ""}
                          </div>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {lead.phone && (
                          <div className="flex items-center gap-1.5 text-neutral-700 font-medium">
                            <Phone size={12} className="text-neutral-400" />
                            <span>{lead.phone}</span>
                          </div>
                        )}
                        {lead.email && (
                          <div className="flex items-center gap-1.5 text-neutral-500 text-[11px] mt-0.5">
                            <Mail size={12} className="text-neutral-400" />
                            <span>{lead.email}</span>
                          </div>
                        )}
                      </td>

                      {/* Value */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono font-semibold text-neutral-900">
                        {lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : "—"}
                      </td>

                      {/* Priority */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${priorityStyle.dot}`} />
                          {priorityStyle.label}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                        >
                          {statusStyle.label}
                        </span>
                      </td>

                      {/* Assignee */}
                      <td className="py-3.5 px-4 text-neutral-700 whitespace-nowrap font-medium">
                        {lead.assignedSales?.name || lead.dealer?.companyName || "Direct"}
                      </td>

                      {/* Quotation Link */}
                      <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {lead.convertedQuotationId ? (
                          <Link
                            href={`/quotation/${lead.convertedQuotationId}`}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"
                          >
                            <span>{lead.convertedQuotation?.quotationNumber || "Quotation"}</span>
                            <ExternalLink size={11} />
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenDrawer(lead)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition cursor-pointer"
                          >
                            <Sparkles size={11} className="text-accent" />
                            <span>Convert</span>
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditLead(lead)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition"
                            title="Edit Lead"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteLead(lead, e)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            title="Archive Lead"
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

        {/* Pagination footer */}
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
              entityName="leads"
            />
          </div>
        )}
      </div>

      {/* Lead Create / Edit Modal */}
      <LeadModal
        isOpen={leadModalOpen}
        lead={editingLead}
        onClose={() => {
          setLeadModalOpen(false);
          setEditingLead(null);
        }}
        onSaved={fetchLeads}
      />

      {/* Lead Detail Slide-over Drawer */}
      <LeadDetailDrawer
        isOpen={drawerOpen}
        lead={selectedLead}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedLead(null);
        }}
        onLeadUpdated={() => {
          fetchLeads();
          if (selectedLead) {
            // refresh active lead details
            apiJson.get<Lead>(`/api/crm/leads/${selectedLead.id}`).then((r) => {
              if (r) setSelectedLead(r);
            });
          }
        }}
        onEditLead={(l) => {
          setDrawerOpen(false);
          handleEditLead(l);
        }}
      />
    </div>
  );
}
