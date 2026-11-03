"use client";

import { CalendarClock, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui";
import { cn, formatCurrency } from "@/lib/utils";
import { followUpLabel } from "@/lib/crmCustomerInsights";
import { useUserTimeZone } from "@/lib/useUserTimeZone";
import { LEAD_PRIORITY_CONFIG, LEAD_STATUS_CONFIG, type CustomerProfile } from "@/types/crm";
import { EmptyState, formatDate } from "./shared";

type ProfileLead = CustomerProfile["leads"][number];

/** Projects this contact (an architect, builder, contractor or dealer) is named on, as the lead's referring contact. */
export function ReferredLeads({ leads, onOpen }: { leads: NonNullable<CustomerProfile["referredLeads"]>; onOpen: (leadId: string) => void }) {
  if (leads.length === 0) return null;
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xs" data-testid="referred-leads">
      <header className="border-b border-neutral-100 bg-neutral-50/70 px-5 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Projects brought in or shared by this contact</h3>
      </header>
      <ul className="divide-y divide-neutral-100">
        {leads.map((lead) => {
          const status = LEAD_STATUS_CONFIG[lead.status] || LEAD_STATUS_CONFIG.new;
          return (
            <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-testid="referred-lead">
              <div className="min-w-0">
                <button type="button" onClick={() => onOpen(lead.id)} className="font-mono text-sm font-bold text-neutral-950 hover:text-accent hover:underline">
                  {lead.referenceNumber}
                </button>
                <p className="truncate text-xs text-neutral-500">
                  {lead.customerName}
                  {lead.projectType ? ` · ${lead.projectType}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", status.bg, status.text, status.border)}>{status.label}</span>
                <span className="text-sm font-bold text-neutral-950">{lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : "—"}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Props {
  leads: CustomerProfile["leads"];
  onOpen: (leadId: string) => void;
  onNewEnquiry: () => void;
}

function StageBadge({ status }: { status: ProfileLead["status"] }) {
  const config = LEAD_STATUS_CONFIG[status] || LEAD_STATUS_CONFIG.new;
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", config.bg, config.text, config.border)}>{config.label}</span>;
}

function PriorityBadge({ priority }: { priority: ProfileLead["priority"] }) {
  const config = LEAD_PRIORITY_CONFIG[priority] || LEAD_PRIORITY_CONFIG.low;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold", config.bg, config.text, config.border)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} aria-hidden="true" />
      {config.label}
    </span>
  );
}

function FollowUp({ lead }: { lead: ProfileLead }) {
  const timeZone = useUserTimeZone();
  if (lead.status === "won" || lead.status === "lost") {
    return lead.status === "lost" && lead.lostReason ? <span className="text-xs text-neutral-500">Lost: {lead.lostReason}</span> : <span className="text-xs text-neutral-300">—</span>;
  }
  if (!lead.nextFollowUpAt) return <span className="text-xs text-neutral-400">Not scheduled</span>;
  const info = followUpLabel(lead.nextFollowUpAt, Date.now(), timeZone);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold", info.overdue ? "bg-rose-50 text-rose-700" : info.today ? "bg-amber-50 text-amber-800" : "bg-neutral-100 text-neutral-600")}>
      <CalendarClock size={11} aria-hidden="true" />
      {info.text}
    </span>
  );
}

export default function LeadsTab({ leads, onOpen, onNewEnquiry }: Props) {
  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-xs">
        <EmptyState
          icon={TrendingUp}
          title="No enquiries recorded"
          text="No active or past enquiries are linked to this customer."
          action={
            <Button type="button" variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={onNewEnquiry}>
              New enquiry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xs" data-testid="leads-tab">
      <div className="hidden md:block">
        <table className="w-full text-left text-sm" data-testid="leads-table">
          <thead className="bg-neutral-50/70 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            <tr>
              <th scope="col" className="px-5 py-3">Enquiry</th>
              <th scope="col" className="px-4 py-3">Project</th>
              <th scope="col" className="px-4 py-3">Stage</th>
              <th scope="col" className="px-4 py-3">Priority</th>
              <th scope="col" className="px-4 py-3">Follow-up</th>
              <th scope="col" className="px-4 py-3">Expected close</th>
              <th scope="col" className="px-5 py-3 text-right">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="transition hover:bg-neutral-50/60" data-testid="lead-row">
                <td className="whitespace-nowrap px-5 py-3.5">
                  <button type="button" onClick={() => onOpen(lead.id)} className="font-mono font-bold text-neutral-950 transition hover:text-accent hover:underline">
                    {lead.referenceNumber}
                  </button>
                  <p className="text-[11px] text-neutral-400">{formatDate(lead.createdAt)}</p>
                </td>
                <td className="px-4 py-3.5 font-medium text-neutral-700">{lead.projectType || <span className="text-neutral-400">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-3.5"><StageBadge status={lead.status} /></td>
                <td className="whitespace-nowrap px-4 py-3.5"><PriorityBadge priority={lead.priority} /></td>
                <td className="whitespace-nowrap px-4 py-3.5"><FollowUp lead={lead} /></td>
                <td className="whitespace-nowrap px-4 py-3.5 text-xs text-neutral-500">{formatDate(lead.expectedClosingDate)}</td>
                <td className="whitespace-nowrap px-5 py-3.5 text-right font-bold text-neutral-950">{lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-neutral-100 md:hidden" data-testid="leads-cards">
        {leads.map((lead) => (
          <li key={lead.id} className="space-y-2.5 p-4" data-testid="lead-card">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => onOpen(lead.id)} className="font-mono text-sm font-bold text-neutral-950">
                {lead.referenceNumber}
              </button>
              <StageBadge status={lead.status} />
            </div>
            <p className="text-sm text-neutral-700">{lead.projectType || "No project type"}</p>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge priority={lead.priority} />
              <FollowUp lead={lead} />
            </div>
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Closing {formatDate(lead.expectedClosingDate)}</span>
              <span className="text-sm font-bold text-neutral-950">{lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : "—"}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
