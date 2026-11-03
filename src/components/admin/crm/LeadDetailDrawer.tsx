"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Calendar,
  FileText,
  User,
  Building,
  Flame,
  ArrowRight,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { Lead, LeadPriority, LeadStatus } from "@/types/crm";
import { LEAD_PRIORITY_CONFIG, LEAD_STATUS_CONFIG } from "@/types/crm";
import ActivityTimeline from "./ActivityTimeline";
import { TagChips } from "./LeadTags";
import { formatCurrency } from "@/lib/utils";
import { effectiveProbability, weightedValue } from "@/lib/pipelineProbability";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";
import { normalizeWhatsAppNumber } from "@/lib/quotationDeliveryShared";

interface LeadDetailDrawerProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onLeadUpdated: () => void;
  onEditLead?: (lead: Lead) => void;
}

export default function LeadDetailDrawer({
  lead,
  isOpen,
  onClose,
  onLeadUpdated,
  onEditLead,
}: LeadDetailDrawerProps) {
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Escape closes the drawer, like any dialog.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !lead) return null;

  const priorityStyle = LEAD_PRIORITY_CONFIG[lead.priority] || LEAD_PRIORITY_CONFIG.medium;
  const statusStyle = LEAD_STATUS_CONFIG[lead.status] || LEAD_STATUS_CONFIG.new;

  const handleStatusChange = async (newStatus: LeadStatus) => {
    if (newStatus === lead.status) return;
    setUpdatingStatus(true);
    try {
      let lostReason: string | undefined = undefined;
      if (newStatus === "lost") {
        const reason = window.prompt("Reason for losing this deal (e.g. Price too high, Competitor chosen):");
        if (reason === null) {
          setUpdatingStatus(false);
          return;
        }
        lostReason = reason.trim() || undefined;
      }

      await apiJson.patch(`/api/crm/leads/${lead.id}/status`, {
        status: newStatus,
        lostReason,
      });

      notify.success("Status updated", `Lead moved to ${LEAD_STATUS_CONFIG[newStatus]?.label || newStatus}.`);
      onLeadUpdated();
    } catch (err) {
      notifyApiError(err, "Failed to update lead status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleConvert = async () => {
    // If already converted, open quotation directly
    if (lead.convertedQuotationId) {
      router.push(`/quotation/${lead.convertedQuotationId}`);
      return;
    }

    setConverting(true);
    try {
      const res = await apiJson.post<{
        quotationId: string;
        quotationNumber: string;
        alreadyConverted?: boolean;
      }>(`/api/crm/leads/${lead.id}/convert`, {});

      const qId = res?.quotationId;
      const qNum = res?.quotationNumber;

      notify.success("Quotation Created!", `Lead converted to quotation ${qNum || ""}.`);
      onLeadUpdated();
      if (qId) {
        router.push(`/quotation/${qId}`);
      }
    } catch (err) {
      notifyApiError(err, "Failed to convert lead to quotation");
    } finally {
      setConverting(false);
    }
  };

  // WhatsApp click handler
  const handleOpenWhatsApp = () => {
    const rawNumber = lead.whatsapp || lead.phone;
    if (!rawNumber) {
      notify.error("No phone number", "This lead does not have a phone or WhatsApp number.");
      return;
    }
    const cleanNumber = normalizeWhatsAppNumber(rawNumber);
    if (!cleanNumber) {
      notify.error("Invalid number", "Unable to format WhatsApp number.");
      return;
    }

    const message = encodeURIComponent(
      `Hello ${lead.customerName}, this is regarding your ${lead.projectType || "automation"} requirement.`
    );
    window.open(`https://api.whatsapp.com/send?phone=${cleanNumber}&text=${message}`, "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Lead ${lead.referenceNumber}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-200 border-l border-neutral-200">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-xs border-b border-neutral-200 px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-accent px-2 py-0.5 rounded-md bg-accent-light border border-accent-border">
                {lead.referenceNumber}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityStyle.dot}`} />
                {priorityStyle.label} Priority
              </span>
              {lead.isHotLead && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  <Flame size={12} className="text-amber-600 fill-amber-500" /> Hot Lead
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-neutral-900 mt-1 truncate">
              {lead.customerName}
            </h2>
            {lead.tags && lead.tags.length > 0 && (
              <div className="mt-1.5">
                <TagChips tags={lead.tags} max={6} size="sm" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onEditLead && (
              <Button type="button" variant="outline" size="sm" onClick={() => onEditLead(lead)}>
                Edit
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="p-5 space-y-6 flex-1">
          {/* Stage Progression & Action Bar */}
          <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                  Current Pipeline Stage
                </span>
                <span className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                  {statusStyle.label}
                </span>
              </div>

              {/* Status Selector */}
              <div className="flex items-center gap-2">
                <select
                  value={lead.status}
                  disabled={updatingStatus}
                  onChange={(e) => handleStatusChange(e.target.value as LeadStatus)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-800 shadow-2xs focus:ring-accent focus:border-accent cursor-pointer"
                >
                  <option value="new">1. New Lead</option>
                  <option value="contacted">2. Contacted</option>
                  <option value="site_visit">3. Site Visit</option>
                  <option value="quoted">4. Quoted</option>
                  <option value="negotiation">5. Negotiation</option>
                  <option value="won">6. Won 🎉</option>
                  <option value="lost">7. Lost</option>
                </select>
              </div>
            </div>

            {/* Main Conversion Callout */}
            <div className="pt-2 border-t border-neutral-200/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="text-xs text-neutral-600">
                {lead.convertedQuotationId ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                    <FileText size={14} /> Linked to quotation: <strong>{lead.convertedQuotation?.quotationNumber || "Quotation"}</strong>
                  </span>
                ) : (
                  <span>Ready to prepare technical scope & pricing proposal?</span>
                )}
              </div>

              <Button
                type="button"
                variant={lead.convertedQuotationId ? "outline" : "primary"}
                size="sm"
                loading={converting}
                onClick={handleConvert}
                className="shrink-0"
              >
                {lead.convertedQuotationId ? (
                  <>
                    <span>Open Quotation</span>
                    <ExternalLink size={14} className="ml-1" />
                  </>
                ) : (
                  <>
                    <Sparkles size={14} className="mr-1" />
                    <span>Convert to Quotation</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Quick Communication Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {lead.phone ? (
              <a
                href={`tel:${lead.phone}`}
                className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-800 font-semibold transition"
              >
                <Phone size={14} className="text-emerald-600" />
                <span>Call Client</span>
              </a>
            ) : null}

            {(lead.whatsapp || lead.phone) ? (
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-green-50/50 hover:border-green-200 text-neutral-800 font-semibold transition cursor-pointer"
              >
                <MessageCircle size={14} className="text-green-600" />
                <span>WhatsApp</span>
              </button>
            ) : null}

            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-800 font-semibold transition"
              >
                <Mail size={14} className="text-sky-600" />
                <span>Send Email</span>
              </a>
            ) : null}
          </div>

          {/* Key Overview Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 bg-neutral-50/60 rounded-xl border border-neutral-200 space-y-2">
              <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-[10px]">
                Project Scope
              </h4>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Project Type:</span>
                <strong className="text-neutral-900">{lead.projectType || "—"}</strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Location:</span>
                <strong className="text-neutral-900">{lead.location || "—"}</strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Estimated Budget:</span>
                <strong className="text-neutral-900">
                  {lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : "—"}
                </strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Closing Target:</span>
                <strong className="text-neutral-900">
                  {lead.expectedClosingDate ? new Date(lead.expectedClosingDate).toLocaleDateString("en-IN", { timeZone: "UTC" }) : "—"}
                </strong>
              </p>
              {lead.status !== "won" && lead.status !== "lost" && (
                <p className="flex items-center justify-between text-neutral-600" data-testid="drawer-probability">
                  <span>Win Probability:</span>
                  <strong className="text-neutral-900">
                    {effectiveProbability(lead.status, lead.probability)}%
                    {lead.estimatedBudget ? ` · ≈ ${formatCurrency(weightedValue(lead.estimatedBudget, effectiveProbability(lead.status, lead.probability)))}` : ""}
                  </strong>
                </p>
              )}
              {lead.referrer && (
                <p className="flex items-center justify-between gap-2 text-neutral-600" data-testid="drawer-referrer">
                  <span className="shrink-0">Via:</span>
                  <strong className="truncate text-right text-neutral-900">
                    {lead.referrer.name}
                    <span className="font-normal text-neutral-500"> ({CUSTOMER_TYPE_LABELS[lead.referrer.customerType]?.split(" / ")[0] ?? lead.referrer.customerType})</span>
                  </strong>
                </p>
              )}
            </div>

            <div className="p-3.5 bg-neutral-50/60 rounded-xl border border-neutral-200 space-y-2">
              <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-[10px]">
                Assignment & Source
              </h4>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Lead Source:</span>
                <strong className="text-neutral-900">{lead.sourceName || "Direct"}</strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Sales Executive:</span>
                <strong className="text-neutral-900">
                  {lead.assignedSales?.name || "Unassigned"}
                </strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Dealer:</span>
                <strong className="text-neutral-900">
                  {lead.dealer?.companyName || lead.dealer?.name || "Direct Company"}
                </strong>
              </p>
              <p className="flex items-center justify-between text-neutral-600">
                <span>Created Date:</span>
                <strong className="text-neutral-900">
                  {new Date(lead.createdAt).toLocaleDateString("en-IN")}
                </strong>
              </p>
            </div>
          </div>

          {/* Notes */}
          {lead.notes && (
            <div className="p-3.5 bg-neutral-50/60 rounded-xl border border-neutral-200 space-y-1 text-xs">
              <span className="font-bold text-neutral-900 uppercase tracking-wider text-[10px] block">
                Requirements & Notes
              </span>
              <p className="text-neutral-700 whitespace-pre-line leading-relaxed">
                {lead.notes}
              </p>
            </div>
          )}

          {/* Activity Timeline Feed */}
          <div className="pt-2 border-t border-neutral-200">
            <ActivityTimeline
              activities={lead.activities || []}
              leadId={lead.id}
              customerId={lead.customerId || undefined}
              quotationId={lead.convertedQuotationId || undefined}
              onActivityAdded={onLeadUpdated}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
