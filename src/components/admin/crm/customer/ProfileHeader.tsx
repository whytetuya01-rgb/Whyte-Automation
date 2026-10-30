"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, Clock, Edit2, FilePlus2, Mail, MessageCircle, Phone, Plus, Trash2, TrendingUp, Trophy, Wallet, FileText } from "lucide-react";
import { Button } from "@/components/ui";
import { cn, formatCurrency } from "@/lib/utils";
import { normalizeWhatsAppNumber, whatsappShareUrl } from "@/lib/quotationDeliveryShared";
import { SEGMENT_LABELS, followUpLabel, relativeTime, type CustomerSegment, type CustomerStats } from "@/lib/crmCustomerInsights";
import { CUSTOMER_TYPE_LABELS, type CustomerProfile } from "@/types/crm";

const SEGMENT_STYLE: Record<CustomerSegment, string> = {
  repeat: "border-emerald-200 bg-emerald-50 text-emerald-700",
  customer: "border-emerald-200 bg-emerald-50 text-emerald-700",
  prospect: "border-amber-200 bg-amber-50 text-amber-800",
  new: "border-neutral-200 bg-neutral-100 text-neutral-600",
};

function StatTile({ icon: Icon, label, value, hint, tone }: { icon: typeof Wallet; label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-neutral-200/80 bg-white p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone)}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
        <p className="truncate text-xl font-semibold leading-tight tracking-tight text-neutral-950">{value}</p>
        <p className="truncate text-xs text-neutral-400">{hint}</p>
      </div>
    </div>
  );
}

interface Props {
  customer: CustomerProfile;
  stats: CustomerStats;
  newQuotationUrl: string;
  onEdit: () => void;
  onArchive: () => void;
  onNewEnquiry: () => void;
}

/** The profile's top card: who the customer is, how to reach them, what to do next, and the headline numbers. */
export default function ProfileHeader({ customer, stats, newQuotationUrl, onEdit, onArchive, onNewEnquiry }: Props) {
  const typeLabel = CUSTOMER_TYPE_LABELS[customer.customerType] ?? "Customer";
  const whatsappNumber = normalizeWhatsAppNumber(customer.whatsapp || customer.phone || "");
  const whatsappUrl = whatsappNumber ? whatsappShareUrl(whatsappNumber, `Hello ${customer.name}, `) : null;
  const initials = customer.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const since = new Date(customer.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const followUp = stats.nextFollowUp ? followUpLabel(stats.nextFollowUp.at) : null;

  const quickAction = "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <header className="space-y-4" data-testid="customer-header">
      <Link href="/admin/crm/customers" className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 transition hover:text-neutral-900">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to customers
      </Link>

      <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xs">
        <div className="relative h-24 bg-neutral-950 sm:h-28" aria-hidden="true" data-testid="customer-banner">
          <div className="absolute inset-0 bg-[radial-gradient(60rem_20rem_at_85%_-20%,var(--color-accent,#d4537e)_0%,transparent_60%)] opacity-40" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06)_0%,transparent_45%)]" />
        </div>

        <div className="relative px-5 pb-6 pt-4 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
              <div className="-mt-14 flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white text-2xl font-semibold tracking-tight text-neutral-950 shadow-md ring-4 ring-white sm:-mt-16 sm:h-24 sm:w-24 sm:text-3xl" aria-hidden="true">
                <span className="flex h-full w-full items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-neutral-900 to-neutral-700 text-white">{initials}</span>
              </div>
              <div className="min-w-0 pt-1 sm:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-neutral-950 sm:text-[1.75rem]" data-testid="customer-name">
                    {customer.name}
                  </h1>
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", SEGMENT_STYLE[stats.segment])} data-testid="customer-segment">
                    {SEGMENT_LABELS[stats.segment]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                  <span className="font-mono font-semibold text-neutral-600">#CUST-{customer.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{typeLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>Customer since {since}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} aria-hidden="true" />
                    Last activity {relativeTime(stats.lastActivityAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className={cn(quickAction, "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")} aria-label={`Call ${customer.name}`}>
                  <Phone size={14} className="text-neutral-500" aria-hidden="true" />
                  <span className="hidden sm:inline">Call</span>
                </a>
              )}
              {whatsappUrl && (
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={cn(quickAction, "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100")} aria-label={`WhatsApp ${customer.name}`}>
                  <MessageCircle size={14} className="text-emerald-600" aria-hidden="true" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}`} className={cn(quickAction, "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")} aria-label={`Email ${customer.name}`}>
                  <Mail size={14} className="text-neutral-500" aria-hidden="true" />
                  <span className="hidden sm:inline">Email</span>
                </a>
              )}
              <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={14} />} onClick={onNewEnquiry} data-testid="new-enquiry">
                New enquiry
              </Button>
              <Link href={newQuotationUrl} className={cn(quickAction, "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800")} data-testid="create-quotation">
                <FilePlus2 size={14} aria-hidden="true" />
                Create quotation
              </Link>
              <Button type="button" variant="ghost" size="sm" onClick={onEdit} leftIcon={<Edit2 size={13} />} data-testid="edit-customer">
                Edit
              </Button>
              <button
                type="button"
                onClick={onArchive}
                aria-label="Archive customer"
                title="Archive customer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Next follow-up strip */}
          {stats.nextFollowUp && followUp && (
            <div
              className={cn(
                "mt-5 flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm",
                followUp.overdue ? "border-rose-200 bg-rose-50 text-rose-800" : followUp.today ? "border-amber-200 bg-amber-50 text-amber-900" : "border-neutral-200 bg-neutral-50 text-neutral-700"
              )}
              data-testid="next-follow-up"
            >
              <CalendarClock size={15} aria-hidden="true" />
              <span className="font-semibold">Next follow-up: {followUp.text}</span>
              <span className="text-xs opacity-80">
                for {stats.nextFollowUp.referenceNumber} · {new Date(stats.nextFollowUp.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="customer-stats">
            <StatTile icon={Wallet} label="Approved value" value={formatCurrency(stats.approvedValue)} hint={`${stats.approvedCount} approved · avg ${formatCurrency(stats.averageOrderValue)}`} tone="bg-emerald-50 text-emerald-600" />
            <StatTile icon={TrendingUp} label="Open pipeline" value={formatCurrency(stats.openPipelineValue)} hint={`${stats.openLeadCount} open ${stats.openLeadCount === 1 ? "enquiry" : "enquiries"}`} tone="bg-sky-50 text-sky-600" />
            <StatTile
              icon={FileText}
              label="Quotations"
              value={String(stats.quotationCount)}
              hint={stats.approvalRate === null ? `${formatCurrency(stats.quotationValue)} quoted` : `${Math.round(stats.approvalRate * 100)}% approved · ${formatCurrency(stats.quotationValue)} quoted`}
              tone="bg-amber-50 text-amber-600"
            />
            <StatTile icon={Trophy} label="Enquiries" value={String(stats.leadCount)} hint={`${stats.wonLeadCount} won · ${stats.lostLeadCount} lost`} tone="bg-violet-50 text-violet-600" />
          </div>
        </div>
      </div>
    </header>
  );
}
