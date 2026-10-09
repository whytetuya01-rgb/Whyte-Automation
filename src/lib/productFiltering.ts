import { EditorCatalogProduct, EditorCatalogVariant } from "@/types";

export interface FilterOptions {
  categoryId?: number | null;
  subcategoryId?: number | null;
  subcategoryIds?: number[];
  automationTier?: string | null;
  surfaceFinish?: string | null;
  productType?: string | null;
  search?: string | null;
  configuredTiers?: Array<{ value: string; label: string }>;
  configuredFinishes?: Array<{ value: string; label: string }>;
  hasCategoryTiers?: boolean;
  hasCategoryFinishes?: boolean;
}

export interface FilteredProductResult {
  product: EditorCatalogProduct;
  eligibleVariants: EditorCatalogVariant[];
  minPrice: number;
  maxPrice: number;
  exactVariant: EditorCatalogVariant | null;
}

/**
 * Normalizes string tokens for robust case-insensitive and delimiter-agnostic comparison.
 */
export function normalizeFilterToken(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
}

/**
 * Checks whether an actual variant dimension value matches the selected filter value.
 * Supports exact match, configured tier/finish option mapping, and label matching.
 */
export function matchDimension(
  actual: string | null | undefined,
  selected: string | null | undefined,
  configuredOptions?: Array<{ value: string; label: string }>
): boolean {
  if (!selected || selected === "all" || selected.trim() === "") {
    return true; // No filter active for this dimension
  }
  if (!actual || actual.trim() === "") {
    return false; // Active filter, but variant has no dimension value
  }

  const normActual = normalizeFilterToken(actual);
  const normSelected = normalizeFilterToken(selected);

  if (normActual === normSelected) return true;

  // Check configured category options for value <-> label mapping
  if (configuredOptions && configuredOptions.length > 0) {
    const matchedOption = configuredOptions.find((opt) => {
      const optVal = normalizeFilterToken(opt.value);
      const optLabel = normalizeFilterToken(opt.label);
      return normSelected === optVal || normSelected === optLabel;
    });

    if (matchedOption) {
      const optVal = normalizeFilterToken(matchedOption.value);
      const optLabel = normalizeFilterToken(matchedOption.label);
      if (normActual === optVal || normActual === optLabel) return true;
      if (optVal.length >= 3 && (normActual.includes(optVal) || optVal.includes(normActual))) return true;
      if (optLabel.length >= 3 && (normActual.includes(optLabel) || optLabel.includes(normActual))) return true;
    }
  }

  // Delimiter / substring matching
  if (normActual.length >= 3 && normSelected.length >= 3) {
    if (normActual.includes(normSelected) || normSelected.includes(normActual)) {
      return true;
    }
  }

  return false;
}

/**
 * Retrieves the automation tier identifier from a variant using automationTier as source of truth.
 */
export function getVariantTier(v: EditorCatalogVariant): string | null {
  if (v.automationTier && v.automationTier.trim()) return v.automationTier.trim();
  return null;
}

/**
 * Retrieves the surface finish identifier from a variant using surfaceFinish as source of truth.
 */
export function getVariantFinish(v: EditorCatalogVariant): string | null {
  if (v.surfaceFinish && v.surfaceFinish.trim()) return v.surfaceFinish.trim();
  return null;
}

/**
 * Determines whether a variant satisfies the active automation tier and surface finish filters.
 */
export function isVariantEligible(
  variant: EditorCatalogVariant,
  filters: Pick<FilterOptions, "automationTier" | "surfaceFinish" | "configuredTiers" | "configuredFinishes">
): boolean {
  if (!variant.isActive) return false;

  const tier = getVariantTier(variant);
  const finish = getVariantFinish(variant);

  const tierMatches = matchDimension(tier, filters.automationTier, filters.configuredTiers);
  const finishMatches = matchDimension(finish, filters.surfaceFinish, filters.configuredFinishes);

  return tierMatches && finishMatches;
}

/**
 * Pure, non-mutating filter for the product catalog.
 * Applies Category, Subcategory, Tier, Finish, Search, and Device-Type with AND logic.
 * Produces filtered results where products remain visible only if at least one variant matches.
 */
export function filterProductCatalog(
  products: EditorCatalogProduct[],
  options: FilterOptions
): FilteredProductResult[] {
  const {
    categoryId,
    subcategoryId,
    subcategoryIds = [],
    automationTier,
    surfaceFinish,
    productType = "all",
    search = "",
    configuredTiers = [],
    configuredFinishes = [],
    hasCategoryTiers = false,
    hasCategoryFinishes = false,
  } = options;

  const isTierActive = Boolean(automationTier && automationTier !== "all" && automationTier.trim() !== "");
  const isFinishActive = Boolean(surfaceFinish && surfaceFinish !== "all" && surfaceFinish.trim() !== "");
  const normSearch = search ? search.trim().toLowerCase() : "";

  const results: FilteredProductResult[] = [];

  for (const product of products) {
    if (!product.isActive) continue;

    const prodCatId = product.categoryId ? Number(product.categoryId) : null;

    // 1. Category and Subcategory matching
    if (subcategoryId) {
      if (prodCatId !== Number(subcategoryId)) continue;
    } else if (categoryId) {
      const targetCatId = Number(categoryId);
      const isDirectMatch = prodCatId === targetCatId;
      const isSubMatch = prodCatId !== null && subcategoryIds.includes(prodCatId);
      if (!isDirectMatch && !isSubMatch) continue;
    }

    // 2. Product Type matching
    if (productType && productType !== "all") {
      if (product.type !== productType) continue;
    }

    // 3. Search matching
    if (normSearch) {
      const nameMatch = product.name ? product.name.toLowerCase().includes(normSearch) : false;
      const codeMatch = product.code ? product.code.toLowerCase().includes(normSearch) : false;
      const descMatch = product.description ? product.description.toLowerCase().includes(normSearch) : false;
      const variantMatch = Array.isArray(product.variants) && product.variants.some((v) => {
        const vCode = v.code || v.variantCode;
        return (
          (vCode && vCode.toLowerCase().includes(normSearch)) ||
          (v.name && v.name.toLowerCase().includes(normSearch))
        );
      });

      if (!nameMatch && !codeMatch && !descMatch && !variantMatch) {
        continue;
      }
    }

    // 4. Variant / Tier / Finish matching
    const activeVariants = Array.isArray(product.variants)
      ? product.variants.filter((v) => v.isActive)
      : [];

    let eligibleVariants: EditorCatalogVariant[] = [];

    if (activeVariants.length > 0) {
      eligibleVariants = activeVariants.filter((v) =>
        isVariantEligible(v, {
          automationTier,
          surfaceFinish,
          configuredTiers,
          configuredFinishes,
        })
      );

      // If tier or finish filter is active, the product must have at least one eligible variant!
      if ((isTierActive || isFinishActive) && eligibleVariants.length === 0) {
        continue;
      }
    } else {
      // Flat product without variants
      if (isTierActive) {
        const tier = product.automationTier || null;
        if (hasCategoryTiers) {
          if (!tier || !matchDimension(tier, automationTier, configuredTiers)) {
            continue;
          }
        }
      }

      if (isFinishActive) {
        const finish = product.surfaceFinish || null;
        if (hasCategoryFinishes) {
          if (!finish || !matchDimension(finish, surfaceFinish, configuredFinishes)) {
            continue;
          }
        }
      }
    }

    // Calculate price information based on eligible variants or base price
    let minPrice = 0;
    let maxPrice = 0;
    let exactVariant: EditorCatalogVariant | null = null;

    if (eligibleVariants.length > 0) {
      const prices = eligibleVariants.map((v) => Number(v.price || 0));
      minPrice = Math.min(...prices);
      maxPrice = Math.max(...prices);
      if (eligibleVariants.length === 1) {
        exactVariant = eligibleVariants[0];
      }
    } else {
      const allPrices = (product.variants || [])
        .map((v) => Number(v.price || 0))
        .filter((p) => p > 0);
      const p = allPrices.length > 0 ? Math.min(...allPrices) : Number(product.price || 0);
      minPrice = p;
      maxPrice = p;
    }

    results.push({
      product,
      eligibleVariants,
      minPrice,
      maxPrice,
      exactVariant,
    });
  }

  return results;
}
