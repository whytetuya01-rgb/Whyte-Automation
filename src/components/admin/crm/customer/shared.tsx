"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import notify from "@/lib/notify";
import { cn } from "@/lib/utils";

export const QUOTATION_STATUS_STYLE: Record<string, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "border-neutral-200 bg-neutral-100 text-neutral-700", dot: "bg-neutral-400" },
  sent: { label: "Sent", className: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  approved: { label: "Approved", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  delivered: { label: "Delivered", className: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  rejected: { label: "Rejected", className: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};

export function QuotationStatusBadge({ status }: { status: string }) {
  const style = QUOTATION_STATUS_STYLE[status] ?? QUOTATION_STATUS_STYLE.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", style.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** A small icon button that copies text and says so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          notify.success("Copied", `${label} copied to the clipboard.`);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          notify.error("Could not copy", "Your browser blocked clipboard access.");
        }
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {copied ? <Check size={13} className="text-emerald-600" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

export function SectionCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-neutral-200 bg-white shadow-xs", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3.5">
        <h2 className="text-sm font-bold tracking-tight text-neutral-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: React.ElementType; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
        <Icon size={22} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-neutral-900">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-neutral-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const formatDate = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
