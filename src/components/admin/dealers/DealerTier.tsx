"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Award, History, ShieldCheck } from "lucide-react";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import notify from "@/lib/notify";
import CustomDropdown from "@/components/shared/CustomDropdown";
import { DEALER_TIERS, DEALER_TIER_STYLE, tierLabel, type DealerTierKey } from "@/lib/dealerTiers";

/** What the dealer APIs return for a dealer's category (all calculated on the server). */
export interface DealerTierInfo {
  category: DealerTierKey;
  categoryLabel: string;
  qualifiedCount: number;
  nextCategory: DealerTierKey | null;
  nextCategoryLabel: string | null;
  quotationsRequiredForNextCategory: number;
  progressPercent: number;
  categoryAchievedAt: string | null;
  lastCategoryEvaluationAt: string | null;
}

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function TierBadge({ category, label }: { category: DealerTierKey; label?: string }) {
  return (
    <span
      data-testid="dealer-tier-badge"
      data-category={category}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${DEALER_TIER_STYLE[category].badge}`}
    >
      <Award size={11} aria-hidden />
      {label ?? tierLabel(category)}
    </span>
  );
}

/** One line for lists: how many quotations qualified and what is left to the next category. */
export function TierLine({ tier }: { tier: DealerTierInfo }) {
  return (
    <p className="text-[11px] text-gray-500" data-testid="dealer-tier-line">
      <span className="font-semibold text-gray-700">{tier.qualifiedCount}</span> delivered
      {tier.nextCategory ? (
        <>
          {" · "}
          <span className="font-semibold text-gray-700">{tier.quotationsRequiredForNextCategory}</span> more for {tier.nextCategoryLabel}
        </>
      ) : (
        " · top category"
      )}
    </p>
  );
}

export function TierProgress({ tier }: { tier: DealerTierInfo }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
        <span>{tier.categoryLabel}</span>
        <span>{tier.nextCategory ? `${tier.nextCategoryLabel}` : "Top category"}</span>
      </div>
      <div
        role="progressbar"
        aria-label={tier.nextCategory ? `Progress from ${tier.categoryLabel} to ${tier.nextCategoryLabel}` : `${tier.categoryLabel}, the top category`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={tier.progressPercent}
        className="h-2 rounded-full bg-gray-200 overflow-hidden"
      >
        <div className={`h-full rounded-full ${DEALER_TIER_STYLE[tier.category].bar}`} style={{ width: `${tier.progressPercent}%` }} />
      </div>
    </div>
  );
}

interface DealerPerformanceDetail extends DealerTierInfo {
  history: Array<{
    id: string;
    fromCategory: DealerTierKey | null;
    toCategory: DealerTierKey;
    source: "automatic" | "manual";
    qualifiedCount: number;
    quotationId: string | null;
    reason: string | null;
    performedByName: string | null;
    createdAt: string;
  }>;
  qualifyingQuotations: Array<{ id: string; quotationNumber: string; clientName: string; deliveredAt: string | null }>;
  qualifyingQuotationsHidden: number;
}

/**
 * The dealer's category, progress, the delivered quotations that count, and the history of category changes. A
 * Super Admin also gets the correction form. Everything comes from the server; nothing is calculated here.
 */
export function DealerPerformancePanel({ dealerId, canCorrect, onChanged }: { dealerId: number; canCorrect: boolean; onChanged: () => void }) {
  const [performance, setPerformance] = useState<DealerPerformanceDetail | null | undefined>(undefined);
  const [category, setCategory] = useState<DealerTierKey>("silver");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/dealers/${dealerId}`, { headers: { "x-skip-api-loader": "true" } });
      const json = await response.json().catch(() => null);
      setPerformance(response.ok ? ((json?.performance as DealerPerformanceDetail | null) ?? null) : null);
    } catch {
      setPerformance(null);
    }
  }, [dealerId]);

  useEffect(() => {
    setPerformance(undefined);
    void load();
  }, [load]);

  const numberFor = (quotationId: string | null) => performance?.qualifyingQuotations.find((q) => q.id === quotationId)?.quotationNumber ?? null;

  const correct = async () => {
    setSaving(true);
    try {
      await apiJson.post(`/api/admin/dealers/${dealerId}/category`, { category, reason });
      notify.success("Category corrected", "The change is recorded in the dealer's history.");
      setReason("");
      await load();
      onChanged();
    } catch (error) {
      notifyApiError(error, "Could not correct the category");
    } finally {
      setSaving(false);
    }
  };

  if (performance === undefined) return <div className="p-3.5 rounded-xl border border-gray-200/80 bg-white text-xs text-gray-500">Loading performance…</div>;
  if (performance === null) return null;

  return (
    <div className="p-3.5 rounded-xl border border-gray-200/80 bg-white space-y-3" data-testid="dealer-performance">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Performance &amp; Category</span>
        <TierBadge category={performance.category} label={performance.categoryLabel} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-[10px] uppercase text-gray-400">Qualified</p>
          <p className="text-sm font-bold text-gray-900" data-testid="dealer-qualified-count">{performance.qualifiedCount}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-[10px] uppercase text-gray-400">Reached</p>
          <p className="text-sm font-bold text-gray-900">{shortDate(performance.categoryAchievedAt)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-[10px] uppercase text-gray-400">Next</p>
          <p className="text-sm font-bold text-gray-900">{performance.nextCategoryLabel ?? "—"}</p>
        </div>
      </div>
      <TierProgress tier={performance} />
      <p className="text-[11px] text-gray-500">
        {performance.nextCategory
          ? `${performance.quotationsRequiredForNextCategory} more delivered ${performance.quotationsRequiredForNextCategory === 1 ? "quotation" : "quotations"} for ${performance.nextCategoryLabel}.`
          : "This dealer has reached the top category."}{" "}
        Only quotations that were approved and then delivered count. A category earned is never lowered automatically.
      </p>
      <p className="text-[11px] text-gray-400">
        Categories: {DEALER_TIERS.map((tier) => `${tier.label} ${tier.minQualified}+`).join(" · ")}
      </p>

      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1 mb-1.5">
          <History size={12} aria-hidden /> Category history
        </span>
        {performance.history.length === 0 ? (
          <p className="text-xs text-gray-500">No category changes yet.</p>
        ) : (
          <ol className="space-y-1.5" data-testid="dealer-tier-history">
            {performance.history.map((event) => (
              <li key={event.id} className="text-xs text-gray-700 flex flex-wrap items-center gap-1.5">
                <span className="text-gray-400 w-24 shrink-0">{shortDate(event.createdAt)}</span>
                <TierBadge category={event.fromCategory ?? "bronze"} />→<TierBadge category={event.toCategory} />
                <span className="text-gray-500">
                  {event.source === "manual"
                    ? `corrected by ${event.performedByName ?? "Super Admin"}: ${event.reason ?? ""}`
                    : `at ${event.qualifiedCount} delivered${numberFor(event.quotationId) ? `, after ${numberFor(event.quotationId)}` : ""}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
          Qualifying quotations ({performance.qualifiedCount})
        </span>
        {performance.qualifyingQuotations.length === 0 ? (
          <p className="text-xs text-gray-500">No delivered quotations yet.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100" data-testid="dealer-qualifying-quotations">
            {performance.qualifyingQuotations.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                <Link href={`/quotation/${q.id}/preview`} className="font-mono font-semibold text-gray-900 hover:underline">
                  {q.quotationNumber}
                </Link>
                <span className="truncate text-gray-500">{q.clientName}</span>
                <span className="shrink-0 text-gray-400">{shortDate(q.deliveredAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {performance.qualifyingQuotationsHidden > 0 && (
          <p className="text-[11px] text-gray-400 mt-1">{performance.qualifyingQuotationsHidden} more count but are not shown because you cannot access them.</p>
        )}
      </div>

      {canCorrect && (
        <details className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-amber-900 flex items-center gap-1">
            <ShieldCheck size={13} aria-hidden /> Correct category (Super Admin)
          </summary>
          <div className="mt-2 space-y-2">
            <div className="text-[11px] font-semibold text-gray-700">
              <span>Category</span>
              <CustomDropdown
                value={category}
                onChange={(next) => setCategory(next as DealerTierKey)}
                options={DEALER_TIERS.map((tier) => ({ value: tier.key, label: tier.label }))}
                ariaLabel="Category"
                testId="dealer-category-select"
                className="mt-1 block w-full"
                triggerClassName="h-9 w-full rounded-lg px-2.5 font-normal text-gray-900"
              />
            </div>
            <label className="block text-[11px] font-semibold text-gray-700">
              Reason (kept in the history)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={() => void correct()} disabled={saving || reason.trim().length < 5} className="px-3 py-1.5 rounded-lg bg-gray-950 text-white text-xs font-semibold disabled:opacity-50">
              {saving ? "Saving…" : "Apply correction"}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
