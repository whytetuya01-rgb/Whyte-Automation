"use client";

import Link from "next/link";
import useSWR from "swr";
import { CalendarClock, FilePlus2, MessageCircle, Phone, Users } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { followUpLabel } from "@/lib/crmCustomerInsights";
import { normalizeWhatsAppNumber, whatsappShareUrl } from "@/lib/quotationDeliveryShared";
import { LEAD_PRIORITY_CONFIG, LEAD_STATUS_CONFIG, type LeadPriority, type LeadStatus } from "@/types/crm";

interface MyLead {
  id: string;
  referenceNumber: string;
  customerName: string;
  phone: string | null;
  whatsapp: string | null;
  projectType: string | null;
  estimatedBudget: number | null;
  status: LeadStatus;
  priority: LeadPriority;
  nextFollowUpAt: string | null;
  createdAt: string;
}

async function fetchMyLeads(url: string): Promise<MyLead[]> {
  const response = await fetch(url, { headers: { "x-skip-api-loader": "true" } });
  if (!response.ok) throw new Error("Could not load your leads.");
  const json = await response.json();
  return (json?.data?.items as MyLead[] | undefined) ?? [];
}

/** A Sales Executive's own leads: who to call next and where each enquiry stands. */
export default function MyLeadsPage() {
  const { data, error, isLoading } = useSWR<MyLead[]>("/api/my/leads", fetchMyLeads, { revalidateOnFocus: true });
  const leads = data ?? [];
  const open = leads.filter((lead) => lead.status !== "won" && lead.status !== "lost");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-3 py-5 sm:px-4 md:px-6" data-testid="my-leads">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">
          <Users size={20} className="text-gray-500" aria-hidden="true" />
          My leads
        </h1>
        <p className="mt-1 text-xs text-gray-500 sm:text-sm">
          Enquiries assigned to you. {isLoading ? "" : `${open.length} open · ${leads.length} in total.`}
        </p>
      </div>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error.message}</p>}
      {isLoading && <p className="text-sm text-gray-500">Loading your leads…</p>}
      {!isLoading && !error && leads.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center" data-testid="my-leads-empty">
          <p className="text-sm font-semibold text-gray-800">No leads assigned to you yet</p>
          <p className="mt-1 text-xs text-gray-500">New enquiries will appear here and you will get a notification.</p>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {leads.map((lead) => {
          const status = LEAD_STATUS_CONFIG[lead.status];
          const priority = LEAD_PRIORITY_CONFIG[lead.priority];
          const followUp = lead.nextFollowUpAt && lead.status !== "won" && lead.status !== "lost" ? followUpLabel(lead.nextFollowUpAt) : null;
          const whatsapp = normalizeWhatsAppNumber(lead.whatsapp || lead.phone || "");
          return (
            <li key={lead.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs" data-testid="my-lead" data-lead-id={lead.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-950">{lead.customerName}</p>
                  <p className="font-mono text-[11px] text-gray-500">{lead.referenceNumber}</p>
                </div>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", status.bg, status.text, status.border)}>{status.label}</span>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                {lead.projectType ?? "Project not specified"}
                {lead.estimatedBudget ? ` · ${formatCurrency(lead.estimatedBudget)}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold", priority.bg, priority.text, priority.border)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} aria-hidden="true" />
                  {priority.label}
                </span>
                {followUp && (
                  <span className={cn("inline-flex items-center gap-1 font-semibold", followUp.overdue ? "text-rose-700" : followUp.today ? "text-amber-700" : "text-gray-600")}>
                    <CalendarClock size={12} aria-hidden="true" />
                    {followUp.text}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50" aria-label={`Call ${lead.customerName}`}>
                    <Phone size={13} aria-hidden="true" /> Call
                  </a>
                )}
                {whatsapp && (
                  <a href={whatsappShareUrl(whatsapp, `Hello ${lead.customerName}, `)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" aria-label={`WhatsApp ${lead.customerName}`}>
                    <MessageCircle size={13} aria-hidden="true" /> WhatsApp
                  </a>
                )}
                <Link href="/quotation/new" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-950 px-2.5 text-xs font-semibold text-white hover:bg-gray-800">
                  <FilePlus2 size={13} aria-hidden="true" /> Quotation
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
