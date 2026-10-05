"use client";

import { useState } from "react";
import { Product, Category } from "@/types";
import { normalizeVariantOptions, formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { FolderTree } from "lucide-react";

interface Props {
  product: Product;
  categories: Category[];
}

function findCategory(categories: Category[], categoryId: number | null | undefined): Category | null {
  if (!categoryId) return null;
  for (const cat of categories) {
    if (cat.id === categoryId) return cat;
    if (cat.children && cat.children.length > 0) {
      const found = findCategory(cat.children, categoryId);
      if (found) return found;
    }
  }
  return null;
}

function getTierLabel(category: Category | null, value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  const tiers = normalizeVariantOptions(category?.variantTiers);
  const found = tiers.find((t) => t.value.toLowerCase() === trimmed.toLowerCase());
  if (found) return found.label;
  return formatTierLabel(trimmed);
}

function getFinishLabel(category: Category | null, value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  const finishes = normalizeVariantOptions(category?.variantFinishes);
  const found = finishes.find((f) => f.value.toLowerCase() === trimmed.toLowerCase());
  if (found) return found.label;
  return formatFinishLabel(trimmed);
}

export default function ProductCategoryConfigCell({ product, categories }: Props) {
  const [expanded, setExpanded] = useState(false);

  const category =
    product.category && typeof product.category === "object" && product.category.name
      ? product.category
      : findCategory(categories, product.categoryId);

  const categoryName = category?.name || (product.categoryId ? `Category #${product.categoryId}` : null);

  // Check if product is matrix with multiple active variants
  const activeVariants = product.variants?.filter((v) => v.isActive) ?? [];
  const variantList = activeVariants.length > 0 ? activeVariants : (product.variants ?? []);
  const isMultiVariant = product.isMatrix && variantList.length > 1;

  if (isMultiVariant) {
    const variantConfigs = variantList.map((v) => {
      const tierVal = v.automationTier || product.automationTier || null;
      const finishVal = v.surfaceFinish || product.surfaceFinish || null;
      const tierLabel = getTierLabel(category, tierVal);
      const finishLabel = getFinishLabel(category, finishVal);

      const extra = Object.entries((v.config as Record<string, string>) || {})
        .filter(([k]) => k !== "series" && k !== "finish" && k !== "tier")
        .map(([k, val]) => `${k}: ${val}`);

      return {
        id: v.id,
        tierLabel,
        finishLabel,
        extraLabel: extra.length > 0 ? extra.join(" · ") : null,
      };
    });

    const visibleConfigs = expanded ? variantConfigs : variantConfigs.slice(0, 2);

    return (
      <div className="text-xs">
        <div className="flex items-center gap-1.5 font-medium text-neutral-900">
          <FolderTree size={13} className="text-neutral-400 shrink-0" />
          <span className="font-semibold text-neutral-900">{categoryName || "Uncategorized"}</span>
        </div>

        <div className="mt-1.5 space-y-1">
          {visibleConfigs.map((cfg, idx) => (
            <div key={cfg.id || idx} className="flex items-center gap-1 text-[11px] text-neutral-600">
              <span className="text-neutral-400 font-mono text-[10px]">└─</span>
              <div className="flex flex-wrap items-center gap-1">
                {cfg.tierLabel && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
                    <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Tier:</span>
                    {cfg.tierLabel}
                  </span>
                )}
                {cfg.tierLabel && cfg.finishLabel && (
                  <span className="text-neutral-300 text-[10px]">·</span>
                )}
                {cfg.finishLabel && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
                    <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Finish:</span>
                    {cfg.finishLabel}
                  </span>
                )}
                {cfg.extraLabel && (
                  <span className="text-neutral-500 text-[10px] italic">({cfg.extraLabel})</span>
                )}
              </div>
            </div>
          ))}

          {variantConfigs.length > 2 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-[10px] font-medium text-neutral-500 hover:text-black hover:underline cursor-pointer pl-4 block transition-colors"
            >
              {expanded ? "Show less" : `+${variantConfigs.length - 2} more configurations`}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Single-variant or flat product
  const tierVal =
    product.automationTier ||
    product.variants?.[0]?.automationTier ||
    (product.variants?.[0]?.config as Record<string, string> | undefined)?.series ||
    (product.variants?.[0]?.config as Record<string, string> | undefined)?.tier ||
    null;

  const finishVal =
    product.surfaceFinish ||
    product.variants?.[0]?.surfaceFinish ||
    (product.variants?.[0]?.config as Record<string, string> | undefined)?.finish ||
    null;

  const tierLabel = getTierLabel(category, tierVal);
  const finishLabel = getFinishLabel(category, finishVal);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 font-medium text-neutral-900 min-w-0">
        <FolderTree size={13} className="text-neutral-400 shrink-0" />
        <span className="font-semibold text-neutral-900 truncate">{categoryName || "Uncategorized"}</span>
      </div>

      {/* Case 4: Category + Automation Tier + Surface Finish */}
      {tierLabel && finishLabel && (
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[11px] text-neutral-600">
            <span className="text-neutral-400 font-mono text-[10px] shrink-0">└─</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
              <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Tier:</span>
              {tierLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 pl-3 text-[11px] text-neutral-600">
            <span className="text-neutral-400 font-mono text-[10px] shrink-0">└─</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
              <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Finish:</span>
              {finishLabel}
            </span>
          </div>
        </div>
      )}

      {/* Case 2: Category + Automation Tier only */}
      {tierLabel && !finishLabel && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-600">
          <span className="text-neutral-400 font-mono text-[10px] shrink-0">└─</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
            <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Tier:</span>
            {tierLabel}
          </span>
        </div>
      )}

      {/* Case 3: Category + Surface Finish only */}
      {!tierLabel && finishLabel && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-600">
          <span className="text-neutral-400 font-mono text-[10px] shrink-0">└─</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80 whitespace-nowrap">
            <span className="text-neutral-400 mr-1 text-[9px] font-normal uppercase">Finish:</span>
            {finishLabel}
          </span>
        </div>
      )}

      {/* Case 1: Category only (no tier, no finish) */}
      {!tierLabel && !finishLabel && (
        <span className="text-neutral-400 text-xs mt-0.5 block pl-4">—</span>
      )}
    </div>
  );
}
