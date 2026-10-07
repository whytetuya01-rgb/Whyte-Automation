"use client";

import { useEffect, useState } from "react";
import { ChevronDown, History } from "lucide-react";
import type { Quotation, QuotationActivityEvent } from "@/types";
import { cn } from "@/lib/utils";

/** "07 Oct 2026, 10:30" in the viewer's own time zone. */
function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day}, ${time}`;
}

function capitalize(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function readText(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
}

function describeEvent(event: QuotationActivityEvent): string {
  const by = event.performedByName ? ` by ${event.performedByName}` : "";
  const previousDealer = readText(event.previousValue, "dealerName");
  const nextDealer = readText(event.newValue, "dealerName");

  switch (event.action) {
    case "quotation_created":
      return `Quotation created${by}`;
    case "quotation_cloned": {
      const source = readText(event.metadata, "clonedFromQuotationNumber");
      return `Quotation cloned${source ? ` from ${source}` : ""}${by}`;
    }
    case "quotation_assigned":
      return `Assigned to ${nextDealer || "a dealer"}${by}`;
    case "quotation_reassigned":
      return `Reassigned from ${previousDealer || "a dealer"} to ${nextDealer || "a dealer"}${by}`;
    case "quotation_unassigned":
      return `Unassigned from ${previousDealer || "the dealer"}${by}`;
    case "status_changed":
      return `Status changed ${capitalize(readText(event.previousValue, "status"))} → ${capitalize(readText(event.newValue, "status"))}`;
    case "quotation_approved":
      return `Quotation approved${by}`;
    case "quotation_rejected":
      return `Quotation rejected${by}`;
    case "quotation_delivered":
      return `Marked as delivered${by}`;
    default:
      return "Quotation updated";
  }
}

/**
 * Compact "who created / who it is assigned to" summary plus a collapsible
 * Activity timeline. Raw ids are never shown, and nothing is rendered for an
 * unassigned quotation's assignment line.
 */
export default function QuotationOwnership({ quotation }: { quotation: Quotation }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<QuotationActivityEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Refresh whenever the quotation (status, assignment) changes while open.
    if (!open || !quotation.id) return;
    let cancelled = false;
    fetch(`/api/quotations/${quotation.id}/activity`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((json) => {
        if (cancelled) return;
        const list = (json?.data ?? json) as QuotationActivityEvent[];
        setEvents(Array.isArray(list) ? list : []);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quotation.id, quotation.status, quotation.dealerId, quotation.assignedOn]);

  const creatorName = quotation.createdByUser?.name ?? null;
  const dealerName = quotation.dealer?.name ?? null;
  const createdOn = mounted ? formatDateTime(quotation.createdAt) : "";
  const assignedOn = mounted ? formatDateTime(quotation.assignedOn) : "";

  if (!quotation.id || (!creatorName && !dealerName)) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <dl className="flex flex-col sm:flex-row sm:flex-wrap gap-x-8 gap-y-1.5 text-xs">
          {creatorName && (
            <div>
              <dt className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">Created by</dt>
              <dd className="text-gray-900 font-medium">
                {creatorName}
                {createdOn && <span className="text-gray-400 font-normal"> · {createdOn}</span>}
              </dd>
            </div>
          )}
          {dealerName && (
            <div>
              <dt className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">Assigned to</dt>
              <dd className="text-gray-900 font-medium">
                {dealerName}
                {assignedOn && <span className="text-gray-400 font-normal"> · {assignedOn}</span>}
              </dd>
            </div>
          )}
        </dl>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto text-xs font-semibold text-gray-600 hover:text-gray-950 transition cursor-pointer"
        >
          <History size={14} />
          Activity
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {failed ? (
            <p className="text-xs text-gray-500">Activity could not be loaded.</p>
          ) : events === null ? (
            <p className="text-xs text-gray-400">Loading activity…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-gray-500">No activity recorded for this quotation.</p>
          ) : (
            <ol className="space-y-2.5">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 text-xs">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                  <div>
                    <p className="text-gray-400">{formatDateTime(event.performedOn)}</p>
                    <p className="text-gray-900 font-medium">{describeEvent(event)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
