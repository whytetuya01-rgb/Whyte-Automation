import { TrendingUp } from "lucide-react";
import { DEALER_TIERS, DEALER_TIER_STYLE, type DealerTierKey } from "@/lib/dealerTiers";

interface DealerTierSummaryProps {
  dealersByCategory: Record<DealerTierKey, number>;
  upgradesInPeriod: number;
  periodLabel: string;
}

/** Real numbers only: active dealers per category, and how many dealers moved up in the selected period. */
export default function DealerTierSummary({ dealersByCategory, upgradesInPeriod, periodLabel }: DealerTierSummaryProps) {
  const total = DEALER_TIERS.reduce((sum, tier) => sum + (dealersByCategory[tier.key] ?? 0), 0);
  return (
    <div className="space-y-4" data-testid="dealer-tier-summary">
      <ul className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {DEALER_TIERS.map((tier) => {
          const count = dealersByCategory[tier.key] ?? 0;
          return (
            <li key={tier.key} className={`rounded-xl border px-3 py-3 ${DEALER_TIER_STYLE[tier.key].badge}`} data-testid={`dealer-tier-${tier.key}`}>
              <p className="text-[11px] font-bold uppercase tracking-wider">{tier.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{count}</p>
              <p className="text-[11px] opacity-80">{tier.minQualified}+ delivered</p>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-2 text-xs text-[#8A8A93]">
        <TrendingUp size={14} aria-hidden />
        <span data-testid="dealer-tier-upgrades">
          <strong className="text-[#111111]">{upgradesInPeriod}</strong> category {upgradesInPeriod === 1 ? "upgrade" : "upgrades"} {periodLabel.toLowerCase()} · {total} active {total === 1 ? "dealer" : "dealers"}
        </span>
      </p>
    </div>
  );
}
