"use client";

import { AlertTriangle } from "lucide-react";

export type UnavailabilityReason = "product" | "variant" | "roomType" | null | undefined;

const MESSAGES: Record<"product" | "variant" | "roomType", string> = {
  product: "This product is unavailable because it has been deleted from the catalog.",
  variant: "This product variant is unavailable.",
  roomType: "This room is unavailable because its room type has been deleted.",
};

/**
 * The one yellow warning every "this item/room references a soft-deleted
 * catalog record" case renders — Phase 4 of the soft-delete rollout. Never
 * shown for an Approved/Delivered quotation (its caller is responsible for
 * that check — see `isLocked`/`isProtectedQuotationStatus`): those keep
 * their historical totals unconditionally, so a warning here would wrongly
 * imply the already-confirmed amount has changed.
 */
export default function UnavailabilityWarning({
  reason,
  label,
  className = "",
  compact = false,
}: {
  reason: UnavailabilityReason;
  /** The item/room's own stored name, e.g. "Smart Switch 4M" or "Master Bedroom". */
  label?: string | null;
  className?: string;
  /**
   * A single-line inline pill instead of the full bordered box — for a
   * dense table row (the PDF/proposal line-item table) where the block
   * version would break column widths. Same message, same icon, same
   * color, just laid out to fit inline.
   */
  compact?: boolean;
}) {
  if (!reason) return null;

  if (compact) {
    return (
      <span
        role="alert"
        title={`${label ? `${label}: ` : ""}${MESSAGES[reason]}`}
        className={`inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 whitespace-nowrap ${className}`}
      >
        <AlertTriangle size={10} className="shrink-0 text-amber-600" aria-hidden="true" />
        Unavailable
      </span>
    );
  }

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ${className}`}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <span>
        {label ? <span className="font-semibold">{label}: </span> : null}
        {MESSAGES[reason]}
        {reason !== "roomType" ? " It is excluded from this quotation's totals." : " It and its products are excluded from this quotation's totals."}
      </span>
    </div>
  );
}
