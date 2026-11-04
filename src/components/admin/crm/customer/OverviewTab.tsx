"use client";

import Link from "next/link";
import { ArrowRight, Building2, FileText, IdCard, Mail, MapPin, MessageCircle, Phone, StickyNote, UserRound, Users, Activity, Home } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { relativeTime, parseCustomerNotes } from "@/lib/crmCustomerInsights";
import { CUSTOMER_TYPE_LABELS, type CrmActivityType, type CustomerProfile } from "@/types/crm";
import { CopyButton, EmptyState, QuotationStatusBadge, SectionCard, formatDate } from "./shared";

const ACTIVITY_LABEL: Record<CrmActivityType, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  site_visit: "Site visit",
  meeting: "Meeting",
  quotation_sent: "Quotation sent",
  quotation_viewed: "Quotation viewed",
  follow_up: "Follow-up",
  note: "Note",
  status_change: "Update",
};

function DetailRow({ icon: Icon, label, value, copy, href }: { icon: React.ElementType; label: string; value: string | null | undefined; copy?: string; href?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon size={15} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-neutral-900">
          {value ? (
            href ? (
              <a href={href} className="font-medium hover:text-accent hover:underline">
                {value}
              </a>
            ) : (
              <span className="font-medium">{value}</span>
            )
          ) : (
            <span className="text-neutral-400">Not provided</span>
          )}
        </dd>
      </div>
      {value && copy && <CopyButton text={copy} label={label.toLowerCase()} />}
    </div>
  );
}

interface Props {
  customer: CustomerProfile;
  onShowTab: (tab: "quotations" | "leads" | "timeline") => void;
  onEdit: () => void;
}

export default function OverviewTab({ customer, onShowTab, onEdit }: Props) {
  const quotations = customer.quotations ?? [];
  const activities = customer.activities ?? [];
  const owner = customer.assignedSales?.name || customer.dealer?.companyName || customer.dealer?.name || null;
  const ownerLine = customer.assignedSales?.email || customer.assignedSales?.contactNumber || customer.dealer?.contactNumber || null;
  const parsedNotes = parseCustomerNotes(customer.notes);

  return (
    <div className="grid gap-5 lg:grid-cols-3" data-testid="overview-tab">
      <div className="space-y-5 lg:col-span-2">
        <SectionCard
          title="Recent quotations"
          action={
            quotations.length > 3 && (
              <button type="button" onClick={() => onShowTab("quotations")} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                View all {quotations.length} <ArrowRight size={12} aria-hidden="true" />
              </button>
            )
          }
        >
          {quotations.length === 0 ? (
            <EmptyState icon={FileText} title="No quotations yet" text="Proposals created for this customer will appear here." />
          ) : (
            <ul className="-my-2 divide-y divide-neutral-100">
              {quotations.slice(0, 3).map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                  <div className="min-w-0">
                    <Link href={`/quotation/${q.id}/preview`} className="font-mono text-sm font-bold text-neutral-950 hover:text-accent">
                      {q.quotationNumber}
                    </Link>
                    <p className="text-xs text-neutral-400">{formatDate(q.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <QuotationStatusBadge status={q.status} />
                    <span className="min-w-[5.5rem] text-right text-sm font-bold text-neutral-950">{formatCurrency(q.grandTotal || 0)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          action={
            activities.length > 0 && (
              <button type="button" onClick={() => onShowTab("timeline")} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                Open timeline <ArrowRight size={12} aria-hidden="true" />
              </button>
            )
          }
        >
          {activities.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Nothing logged yet"
              text="Log calls, visits and notes on the timeline to keep the whole team up to date."
              action={
                <button type="button" onClick={() => onShowTab("timeline")} className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                  Log an activity
                </button>
              }
            />
          ) : (
            <ol className="relative -my-1 space-y-4 border-l border-neutral-200 pl-5">
              {activities.slice(0, 5).map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[1.62rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-400 ring-1 ring-neutral-200" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-semibold text-neutral-900">
                      {a.title} <span className="ml-1 text-[11px] font-medium text-neutral-400">{ACTIVITY_LABEL[a.type] ?? a.type}</span>
                    </p>
                    <time className="text-xs text-neutral-400" dateTime={a.performedAt}>
                      {relativeTime(a.performedAt)}
                    </time>
                  </div>
                  {a.description && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{a.description}</p>}
                  {a.performedByName && <p className="mt-0.5 text-[11px] text-neutral-400">by {a.performedByName}</p>}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard title="Contact details">
          <dl className="-my-2 divide-y divide-neutral-100">
            <DetailRow icon={Phone} label="Phone" value={customer.phone} copy={customer.phone ?? undefined} href={customer.phone ? `tel:${customer.phone}` : undefined} />
            <DetailRow icon={MessageCircle} label="WhatsApp" value={customer.whatsapp || customer.phone} copy={(customer.whatsapp || customer.phone) ?? undefined} />
            <DetailRow icon={Mail} label="Email" value={customer.email} copy={customer.email ?? undefined} href={customer.email ? `mailto:${customer.email}` : undefined} />
            <DetailRow icon={Home} label="Site address" value={customer.siteAddress} copy={customer.siteAddress ?? undefined} />
            <DetailRow icon={MapPin} label="Billing address" value={customer.billingAddress} copy={customer.billingAddress ?? undefined} />
            <DetailRow icon={IdCard} label="GSTIN" value={customer.gstNumber} copy={customer.gstNumber ?? undefined} />
            <DetailRow icon={Building2} label="Customer type" value={CUSTOMER_TYPE_LABELS[customer.customerType] ?? customer.customerType} />
          </dl>
        </SectionCard>

        <SectionCard title="Account owner">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
              {owner ? <UserRound size={18} aria-hidden="true" /> : <Users size={18} aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{owner || "Direct / admin managed"}</p>
              <p className="truncate text-xs text-neutral-500">{ownerLine || (owner ? "Assigned" : "No salesperson or dealer assigned")}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Notes"
          action={
            <button type="button" onClick={onEdit} className="text-xs font-semibold text-accent hover:underline">
              {parsedNotes.userNotes ? "Edit" : "Add"}
            </button>
          }
        >
          <div className="space-y-3">
            {parsedNotes.migrationInfo && (
              <div className="flex items-start gap-2.5 rounded-xl border border-neutral-200/90 bg-neutral-50/80 p-3 text-xs">
                <FileText size={15} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-800">
                    Imported from Historical Proposal
                  </p>
                  <p className="mt-0.5 text-neutral-500">
                    Linked Quotation:{" "}
                    <span className="font-medium text-neutral-700">
                      {parsedNotes.migrationInfo.quotationNumbers.join(", ") || "Historical Proposal"}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {parsedNotes.userNotes ? (
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-neutral-700" data-testid="customer-notes">
                {parsedNotes.userNotes}
              </p>
            ) : (
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <StickyNote size={15} aria-hidden="true" />
                No notes yet.
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
