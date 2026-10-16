import { EditorCatalogProduct, EditorCatalogVariant, QuotationItem } from "@/types";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { normalizeFilterToken } from "@/lib/productFiltering";
import { buildVariantLabel as buildDimLabel, capitalize } from "@/lib/variant-dimension";

export interface VariantDimensionOption {
  value: string;
  label: string;
}

export interface ProductVariantAnalysis {
  variants: EditorCatalogVariant[];
  hasVariants: boolean;
  hasMultipleVariants: boolean;
  hasTiers: boolean;
  hasFinishes: boolean;
  availableTiers: VariantDimensionOption[];
  availableFinishes: VariantDimensionOption[];
  getFinishesForTier: (tier: string | null | undefined) => VariantDimensionOption[];
  findVariant: (tier: string | null | undefined, finish: string | null | undefined) => EditorCatalogVariant | null;
}

/**
 * Normalizes an raw dimension string for comparison and display.
 */
function cleanDimValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

/**
 * Extracts the automation tier / series identifier from a variant.
 */
export function extractVariantTier(v: EditorCatalogVariant): string | null {
  if (v.automationTier && v.automationTier.trim()) return v.automationTier.trim();
  const conf = v.config as Record<string, string> | undefined;
  if (conf?.series && conf.series.trim()) return conf.series.trim();
  if (conf?.tier && conf.tier.trim()) return conf.tier.trim();
  if (conf?.automationTier && conf.automationTier.trim()) return conf.automationTier.trim();
  return null;
}

/**
 * Extracts the surface finish identifier from a variant.
 */
export function extractVariantFinish(v: EditorCatalogVariant): string | null {
  if (v.surfaceFinish && v.surfaceFinish.trim()) return v.surfaceFinish.trim();
  const conf = v.config as Record<string, string> | undefined;
  if (conf?.finish && conf.finish.trim()) return conf.finish.trim();
  if (conf?.surfaceFinish && conf.surfaceFinish.trim()) return conf.surfaceFinish.trim();
  return null;
}

/**
 * Checks whether a variant matches the given tier (case- and token-insensitive).
 */
export function variantMatchesTier(v: EditorCatalogVariant, targetTier: string | null | undefined): boolean {
  if (!targetTier || targetTier.trim() === "") return true;
  const actualTier = extractVariantTier(v);
  if (!actualTier) return false;
  return normalizeFilterToken(actualTier) === normalizeFilterToken(targetTier);
}

/**
 * Checks whether a variant matches the given finish (case- and token-insensitive).
 */
export function variantMatchesFinish(v: EditorCatalogVariant, targetFinish: string | null | undefined): boolean {
  if (!targetFinish || targetFinish.trim() === "") return true;
  const actualFinish = extractVariantFinish(v);
  if (!actualFinish) return false;
  return normalizeFilterToken(actualFinish) === normalizeFilterToken(targetFinish);
}

/**
 * Analyzes an EditorCatalogProduct and its variants, extracting clean
 * available tiers, available finishes, and dynamic finish lookup.
 */
export function analyzeProductVariants(product: EditorCatalogProduct | undefined | null): ProductVariantAnalysis {
  if (!product) {
    return {
      variants: [],
      hasVariants: false,
      hasMultipleVariants: false,
      hasTiers: false,
      hasFinishes: false,
      availableTiers: [],
      availableFinishes: [],
      getFinishesForTier: () => [],
      findVariant: () => null,
    };
  }

  const activeVariants = (product.variants || []).filter((v) => v && v.isActive);

  // Collect distinct tiers
  const tierMap = new Map<string, string>();
  for (const v of activeVariants) {
    const t = extractVariantTier(v);
    if (t) {
      const normKey = normalizeFilterToken(t);
      if (!tierMap.has(normKey)) {
        tierMap.set(normKey, t);
      }
    }
  }

  const availableTiers: VariantDimensionOption[] = Array.from(tierMap.values()).map((t) => ({
    value: t,
    label: formatTierLabel(t) || capitalize(t),
  }));

  // Collect distinct finishes across all variants
  const finishMap = new Map<string, string>();
  for (const v of activeVariants) {
    const f = extractVariantFinish(v);
    if (f) {
      const normKey = normalizeFilterToken(f);
      if (!finishMap.has(normKey)) {
        finishMap.set(normKey, f);
      }
    }
  }

  const availableFinishes: VariantDimensionOption[] = Array.from(finishMap.values()).map((f) => ({
    value: f,
    label: formatFinishLabel(f) || capitalize(f),
  }));

  // Dynamic finishes scoped to a specific selected tier
  const getFinishesForTier = (tier: string | null | undefined): VariantDimensionOption[] => {
    const filteredVariants = tier
      ? activeVariants.filter((v) => variantMatchesTier(v, tier))
      : activeVariants;

    const scopedMap = new Map<string, string>();
    for (const v of filteredVariants) {
      const f = extractVariantFinish(v);
      if (f) {
        const normKey = normalizeFilterToken(f);
        if (!scopedMap.has(normKey)) {
          scopedMap.set(normKey, f);
        }
      }
    }

    return Array.from(scopedMap.values()).map((f) => ({
      value: f,
      label: formatFinishLabel(f) || capitalize(f),
    }));
  };

  const findVariant = (
    tier: string | null | undefined,
    finish: string | null | undefined
  ): EditorCatalogVariant | null => {
    if (activeVariants.length === 0) return null;

    // 1. Try exact match on both tier and finish
    const exact = activeVariants.find((v) => variantMatchesTier(v, tier) && variantMatchesFinish(v, finish));
    if (exact) return exact;

    // 2. Try match on tier alone if finish is not specified or not available
    if (tier) {
      const tierMatch = activeVariants.find((v) => variantMatchesTier(v, tier));
      if (tierMatch) return tierMatch;
    }

    // 3. Try match on finish alone
    if (finish) {
      const finishMatch = activeVariants.find((v) => variantMatchesFinish(v, finish));
      if (finishMatch) return finishMatch;
    }

    // 4. Fallback to first active variant
    return activeVariants[0] || null;
  };

  return {
    variants: activeVariants,
    hasVariants: activeVariants.length > 0,
    hasMultipleVariants: activeVariants.length > 1,
    hasTiers: availableTiers.length > 0,
    hasFinishes: availableFinishes.length > 0,
    availableTiers,
    availableFinishes,
    getFinishesForTier,
    findVariant,
  };
}

export interface ResolvedSelection {
  tier: string | null;
  finish: string | null;
  variant: EditorCatalogVariant | null;
  variantId: number | null;
  variantLabel: string | null;
  price: number;
  isPreservedTier: boolean;
  isPreservedFinish: boolean;
}

/**
 * Resolves the initial or updated variant and finish selection for a product.
 * Respects existing item compatibility:
 * - If target product supports the current product's tier, preserves it!
 * - If target product supports the current product's finish for that tier, preserves it!
 * - Otherwise falls back to quotation defaults or first available option.
 */
export function resolveCompatibleSelection(params: {
  product: EditorCatalogProduct;
  existingItem?: QuotationItem | null;
  quotationDefaults?: { defaultTier?: string | null; defaultFinish?: string | null };
  desiredTier?: string | null;
  desiredFinish?: string | null;
}): ResolvedSelection {
  const { product, existingItem, quotationDefaults, desiredTier, desiredFinish } = params;
  const analysis = analyzeProductVariants(product);

  const existingTier =
    desiredTier !== undefined
      ? desiredTier
      : existingItem?.productVariant?.automationTier ||
        (existingItem?.variantConfig as Record<string, string> | undefined)?.series ||
        (existingItem?.variantConfig as Record<string, string> | undefined)?.tier ||
        null;

  const existingFinish =
    desiredFinish !== undefined
      ? desiredFinish
      : existingItem?.productVariant?.surfaceFinish ||
        (existingItem?.variantConfig as Record<string, string> | undefined)?.finish ||
        (existingItem?.variantConfig as Record<string, string> | undefined)?.surfaceFinish ||
        null;

  let resolvedTier: string | null = null;
  let isPreservedTier = false;

  if (analysis.hasTiers) {
    if (existingTier) {
      const matchedTier = analysis.availableTiers.find(
        (t) => normalizeFilterToken(t.value) === normalizeFilterToken(existingTier)
      );
      if (matchedTier) {
        resolvedTier = matchedTier.value;
        isPreservedTier = true;
      }
    }

    if (!resolvedTier && quotationDefaults?.defaultTier) {
      const defaultMatch = analysis.availableTiers.find(
        (t) => normalizeFilterToken(t.value) === normalizeFilterToken(quotationDefaults.defaultTier)
      );
      if (defaultMatch) {
        resolvedTier = defaultMatch.value;
      }
    }

    if (!resolvedTier && analysis.availableTiers.length > 0) {
      resolvedTier = analysis.availableTiers[0].value;
    }
  }

  // Resolve finish based on selected tier
  const tierFinishes = analysis.getFinishesForTier(resolvedTier);
  let resolvedFinish: string | null = null;
  let isPreservedFinish = false;

  if (tierFinishes.length > 0) {
    if (existingFinish) {
      const matchedFinish = tierFinishes.find(
        (f) => normalizeFilterToken(f.value) === normalizeFilterToken(existingFinish)
      );
      if (matchedFinish) {
        resolvedFinish = matchedFinish.value;
        isPreservedFinish = true;
      }
    }

    if (!resolvedFinish && quotationDefaults?.defaultFinish) {
      const defaultFinishMatch = tierFinishes.find(
        (f) => normalizeFilterToken(f.value) === normalizeFilterToken(quotationDefaults.defaultFinish)
      );
      if (defaultFinishMatch) {
        resolvedFinish = defaultFinishMatch.value;
      }
    }

    if (!resolvedFinish && tierFinishes.length > 0) {
      resolvedFinish = tierFinishes[0].value;
    }
  }

  const variant = analysis.findVariant(resolvedTier, resolvedFinish);
  const variantId = variant ? Number(variant.id ?? (variant as any)._id) : null;
  const price = variant ? Number(variant.price) : Number(product.price || 0);

  // Generate label
  const tierLabel = resolvedTier ? (formatTierLabel(resolvedTier) || capitalize(resolvedTier)) : null;
  const finishLabel = resolvedFinish ? (formatFinishLabel(resolvedFinish) || capitalize(resolvedFinish)) : null;
  const variantLabel =
    tierLabel || finishLabel
      ? [tierLabel, finishLabel].filter(Boolean).join(" + ")
      : variant
      ? buildDimLabel(variant)
      : null;

  return {
    tier: resolvedTier,
    finish: resolvedFinish,
    variant,
    variantId,
    variantLabel,
    price,
    isPreservedTier,
    isPreservedFinish,
  };
}
