import { QuotationStatus } from "@/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<QuotationStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-accent-light text-accent-foreground border-accent-border/60" },
  sent: { label: "Sent", className: "bg-neutral-100 text-neutral-800 border-neutral-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200/80" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200/80" },
  delivered: { label: "Delivered", className: "bg-purple-50 text-purple-700 border-purple-200/80" },
};

export default function StatusBadge({ status }: { status: QuotationStatus }) {
  const config = statusConfig[status] ?? statusConfig.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border select-none",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
