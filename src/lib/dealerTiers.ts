/**
 * Dealer tiers: the ONE place the categories, their thresholds and the definition of a "qualified quotation" live.
 * Pure (no database, no server imports), so the server logic and the screens read the same rules.
 *
 * A dealer's tier comes from their lifetime count of QUALIFIED quotations. The existing quotation lifecycle is
 * draft → sent → approved | rejected, then approved → delivered. A quotation qualifies when it has been delivered:
 * the only way to "delivered" is through "approved", so a qualified quotation has been both approved and completed.
 * Draft, sent, approved-but-not-yet-delivered and rejected quotations never count.
 */

export const DEALER_TIERS = [
  { key: "bronze", label: "Bronze", minQualified: 0 },
  { key: "silver", label: "Silver", minQualified: 5 },
  { key: "gold", label: "Gold", minQualified: 10 },
  { key: "platinum", label: "Platinum", minQualified: 20 },
  { key: "diamond", label: "Diamond", minQualified: 40 },
] as const;

export type DealerTierKey = (typeof DEALER_TIERS)[number]["key"];
export const DEALER_TIER_KEYS: readonly DealerTierKey[] = DEALER_TIERS.map((tier) => tier.key);

/** The status a quotation must have reached to count (see the note above). */
export const QUALIFYING_QUOTATION_STATUS = "delivered" as const;

export function isDealerTierKey(value: unknown): value is DealerTierKey {
  return typeof value === "string" && (DEALER_TIER_KEYS as readonly string[]).includes(value);
}

export function tierRank(key: DealerTierKey): number {
  return DEALER_TIER_KEYS.indexOf(key);
}

export function tierLabel(key: DealerTierKey): string {
  return DEALER_TIERS[tierRank(key)].label;
}

/** The tier a lifetime qualified count earns. */
export function tierForCount(qualifiedCount: number): DealerTierKey {
  const count = Number.isFinite(qualifiedCount) ? Math.max(0, Math.floor(qualifiedCount)) : 0;
  let earned: DealerTierKey = DEALER_TIERS[0].key;
  for (const tier of DEALER_TIERS) if (count >= tier.minQualified) earned = tier.key;
  return earned;
}

export interface DealerTierProgress {
  category: DealerTierKey;
  categoryLabel: string;
  qualifiedCount: number;
  nextCategory: DealerTierKey | null;
  nextCategoryLabel: string | null;
  /** Qualified quotations still needed for the next category (0 at the top). */
  quotationsRequiredForNextCategory: number;
  /** 0 to 100: how far through the current band towards the next category (100 at the top). */
  progressPercent: number;
}

/**
 * Where a dealer stands. `category` is the category the dealer HAS (it may be above what the count alone would give,
 * because an earned category is never lowered automatically); progress towards the next one is measured from the count.
 */
export function describeTierProgress(category: DealerTierKey, qualifiedCount: number): DealerTierProgress {
  const count = Number.isFinite(qualifiedCount) ? Math.max(0, Math.floor(qualifiedCount)) : 0;
  const rank = tierRank(category);
  const next = DEALER_TIERS[rank + 1] ?? null;
  const bandStart = DEALER_TIERS[rank].minQualified;
  let progressPercent = 100;
  let required = 0;
  if (next) {
    required = Math.max(0, next.minQualified - count);
    const span = next.minQualified - bandStart;
    progressPercent = span > 0 ? Math.min(100, Math.max(0, Math.round(((count - bandStart) / span) * 100))) : 0;
  }
  return {
    category,
    categoryLabel: DEALER_TIERS[rank].label,
    qualifiedCount: count,
    nextCategory: next ? next.key : null,
    nextCategoryLabel: next ? next.label : null,
    quotationsRequiredForNextCategory: required,
    progressPercent,
  };
}

/**
 * Badge colours (text on background, both from the same hue family, all at a readable contrast on white and on dark
 * surfaces because each badge carries its own background and border).
 */
export const DEALER_TIER_STYLE: Record<DealerTierKey, { badge: string; bar: string }> = {
  bronze: { badge: "bg-amber-100 text-amber-900 border-amber-300", bar: "bg-amber-600" },
  silver: { badge: "bg-slate-100 text-slate-800 border-slate-300", bar: "bg-slate-500" },
  gold: { badge: "bg-yellow-100 text-yellow-900 border-yellow-400", bar: "bg-yellow-500" },
  platinum: { badge: "bg-sky-100 text-sky-900 border-sky-300", bar: "bg-sky-600" },
  diamond: { badge: "bg-cyan-100 text-cyan-900 border-cyan-400", bar: "bg-cyan-500" },
};
