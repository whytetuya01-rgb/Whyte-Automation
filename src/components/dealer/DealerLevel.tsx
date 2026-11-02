"use client";

import Link from "next/link";
import useSWR from "swr";
import { Award, Check, Lock, Sparkles } from "lucide-react";
import { DEALER_TIER_STYLE, type DealerTierKey } from "@/lib/dealerTiers";

/** What GET /api/dealer/tier returns (all worked out on the server). */
export interface MyDealerLevel {
  category: DealerTierKey;
  categoryLabel: string;
  qualifiedCount: number;
  nextCategory: DealerTierKey | null;
  nextCategoryLabel: string | null;
  quotationsRequiredForNextCategory: number;
  progressPercent: number;
  categoryAchievedAt: string | null;
  ladder: Array<{ key: DealerTierKey; label: string; minQualified: number; state: "reached" | "current" | "upcoming" }>;
}

async function fetchLevel(url: string): Promise<MyDealerLevel | null> {
  const response = await fetch(url, { headers: { "x-skip-api-loader": "true" } });
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  return (json?.data as MyDealerLevel | undefined) ?? null;
}

/** The signed-in dealer's level; null while loading or when it cannot be read (the screens then show nothing). */
export function useMyDealerLevel() {
  const { data } = useSWR<MyDealerLevel | null>("/api/dealer/tier", fetchLevel, { revalidateOnFocus: false, shouldRetryOnError: false });
  return data ?? null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A small level badge for the header, next to the dealer's name. Links to the full level on the profile page. */
export function DealerLevelChip() {
  const level = useMyDealerLevel();
  if (!level) return null;
  const summary = level.nextCategoryLabel
    ? `${plural(level.qualifiedCount, "delivered quotation")} · ${level.quotationsRequiredForNextCategory} more for ${level.nextCategoryLabel}`
    : `${plural(level.qualifiedCount, "delivered quotation")} · top level`;
  return (
    <Link
      href="/profile#dealer-level"
      title={`${level.categoryLabel} dealer: ${summary}`}
      aria-label={`Your level: ${level.categoryLabel}. ${summary}`}
      data-testid="dealer-level-chip"
      data-category={level.category}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-bold leading-tight ${DEALER_TIER_STYLE[level.category].badge}`}
    >
      <Award size={10} aria-hidden="true" />
      {level.categoryLabel}
    </Link>
  );
}

/** "My level": the level, how far to the next, and the whole ladder with what each level needs. */
export function DealerLevelCard() {
  const level = useMyDealerLevel();
  if (!level) return null;
  const style = DEALER_TIER_STYLE[level.category];
  const top = level.nextCategory === null;

  return (
    <section id="dealer-level" aria-labelledby="dealer-level-title" className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs" data-testid="dealer-level-card" data-category={level.category}>
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${style.badge}`}>
            <Award size={26} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="dealer-level-title" className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Your dealer level
            </h2>
            <p className="text-2xl font-semibold tracking-tight text-gray-950" data-testid="dealer-level-name">
              {level.categoryLabel}
            </p>
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-800">{plural(level.qualifiedCount, "delivered quotation")}</span>
              {top ? " · you are at the top level" : ` · ${level.quotationsRequiredForNextCategory} more to reach ${level.nextCategoryLabel}`}
            </p>
          </div>
        </div>

        <div className="w-full lg:max-w-sm">
          <div className="mb-1 flex items-center justify-between text-[11px] text-gray-600">
            <span className="font-semibold">{level.categoryLabel}</span>
            <span>{top ? "Top level" : level.nextCategoryLabel}</span>
          </div>
          <div
            role="progressbar"
            aria-label={top ? `${level.categoryLabel}, the top level` : `Progress from ${level.categoryLabel} to ${level.nextCategoryLabel}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level.progressPercent}
            className="h-2.5 overflow-hidden rounded-full bg-gray-100"
          >
            <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${level.progressPercent}%` }} />
          </div>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50/60 p-4 sm:grid-cols-5 sm:p-5" aria-label="Dealer levels" data-testid="dealer-level-ladder">
        {level.ladder.map((step) => {
          const stepStyle = DEALER_TIER_STYLE[step.key];
          return (
            <li
              key={step.key}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`rounded-xl border p-3 ${step.state === "current" ? `${stepStyle.badge} shadow-xs` : step.state === "reached" ? "border-gray-200 bg-white" : "border-dashed border-gray-200 bg-transparent"}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-sm font-semibold ${step.state === "upcoming" ? "text-gray-400" : "text-gray-900"}`}>{step.label}</span>
                {step.state === "reached" && <Check size={14} className="text-emerald-600" aria-label="Reached" />}
                {step.state === "current" && <Sparkles size={14} aria-label="Your level" />}
                {step.state === "upcoming" && <Lock size={13} className="text-gray-300" aria-label="Not reached yet" />}
              </div>
              <p className={`mt-0.5 text-[11px] ${step.state === "upcoming" ? "text-gray-400" : "text-gray-600"}`}>{step.minQualified === 0 ? "Starting level" : `${step.minQualified}+ delivered`}</p>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-gray-100 px-5 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
        A quotation counts towards your level once it has been <span className="font-semibold text-gray-700">approved and delivered</span>. Drafts, sent quotations and rejected ones do not count, and a level you have reached is never lowered automatically.
      </p>
    </section>
  );
}
