import { VariantOption } from "@/types";

/**
 * Normalizes category variant options (tiers or finishes) into a clean VariantOption array.
 * Supports both { value, label } objects and plain strings.
 */
export function normalizeVariantOptions(opts: unknown): VariantOption[] {
  if (!Array.isArray(opts)) return [];
  const result: VariantOption[] = [];

  for (const item of opts) {
    if (typeof item === "string" && item.trim()) {
      result.push({ value: item.trim(), label: item.trim() });
    } else if (item && typeof item === "object" && "value" in item) {
      const rawVal = (item as { value?: unknown; label?: unknown }).value;
      const rawLabel = (item as { value?: unknown; label?: unknown }).label;
      const value = typeof rawVal === "string" ? rawVal.trim() : String(rawVal ?? "").trim();
      const label = typeof rawLabel === "string" ? rawLabel.trim() : String(rawLabel ?? value).trim();
      if (value) {
        result.push({ value, label: label || value });
      }
    }
  }

  return result;
}

export interface CategoryConfig {
  configuredTiers: VariantOption[];
  configuredFinishes: VariantOption[];
  hasAutomationTiers: boolean;
  hasSurfaceFinishes: boolean;
  validTierValues: string[];
  validFinishValues: string[];
}

/**
 * Extracts and inspects the active variant configuration for a category.
 */
export function getCategoryConfig(
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null | undefined
): CategoryConfig {
  if (!category) {
    return {
      configuredTiers: [],
      configuredFinishes: [],
      hasAutomationTiers: false,
      hasSurfaceFinishes: false,
      validTierValues: [],
      validFinishValues: [],
    };
  }

  const configuredTiers = normalizeVariantOptions(category.variantTiers);
  const configuredFinishes = normalizeVariantOptions(category.variantFinishes);

  return {
    configuredTiers,
    configuredFinishes,
    hasAutomationTiers: configuredTiers.length > 0,
    hasSurfaceFinishes: configuredFinishes.length > 0,
    validTierValues: configuredTiers.map((t) => t.value),
    validFinishValues: configuredFinishes.map((f) => f.value),
  };
}

export type CategoryConfigValidationResult =
  | { valid: true; automationTier: string | null; surfaceFinish: string | null }
  | { valid: false; error: string };

/**
 * Validates automationTier and surfaceFinish against a category's configured options.
 *
 * Rules:
 * 1. Category must exist.
 * 2. If category has Automation Tiers:
 *    - automation tier is mandatory
 *    - value must be one of the category's configured tiers
 * 3. If category has Surface Finishes:
 *    - surface finish is mandatory
 *    - value must be one of the category's configured finishes
 * 4. If category does NOT have Automation Tiers:
 *    - automation tier must be empty/null (arbitrary values rejected)
 * 5. If category does NOT have Surface Finishes:
 *    - surface finish must be empty/null (arbitrary values rejected)
 */
export function validateProductCategoryConfig(params: {
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null | undefined;
  automationTier?: unknown;
  surfaceFinish?: unknown;
}): CategoryConfigValidationResult {
  const { category, automationTier, surfaceFinish } = params;

  if (!category) {
    return { valid: false, error: "Category is required" };
  }

  const config = getCategoryConfig(category);

  // 1. Automation Tier validation
  let finalTier: string | null = null;
  const rawTier = automationTier !== undefined && automationTier !== null ? String(automationTier).trim() : "";

  if (config.hasAutomationTiers) {
    if (!rawTier) {
      return { valid: false, error: "Automation Tier is required for this category" };
    }
    if (!config.validTierValues.includes(rawTier)) {
      return {
        valid: false,
        error: `Invalid automation tier "${rawTier}". Configured tiers: ${config.validTierValues.join(", ")}`,
      };
    }
    finalTier = rawTier;
  } else {
    if (rawTier) {
      return { valid: false, error: "Automation Tier is not configured for this category" };
    }
    finalTier = null;
  }

  // 2. Surface Finish validation
  let finalFinish: string | null = null;
  const rawFinish = surfaceFinish !== undefined && surfaceFinish !== null ? String(surfaceFinish).trim() : "";

  if (config.hasSurfaceFinishes) {
    if (!rawFinish) {
      return { valid: false, error: "Surface Finish is required for this category" };
    }
    if (!config.validFinishValues.includes(rawFinish)) {
      return {
        valid: false,
        error: `Invalid surface finish "${rawFinish}". Configured finishes: ${config.validFinishValues.join(", ")}`,
      };
    }
    finalFinish = rawFinish;
  } else {
    if (rawFinish) {
      return { valid: false, error: "Surface Finish is not configured for this category" };
    }
    finalFinish = null;
  }

  return {
    valid: true,
    automationTier: finalTier,
    surfaceFinish: finalFinish,
  };
}

export interface VariantMatrixItem {
  automationTier: string | null;
  surfaceFinish: string | null;
  tierLabel: string | null;
  finishLabel: string | null;
  displayName: string;
}

export interface CategoryVariantMatrix {
  configuredTiers: VariantOption[];
  configuredFinishes: VariantOption[];
  hasAutomationTiers: boolean;
  hasSurfaceFinishes: boolean;
  hasMatrix: boolean;
  totalCombinations: number;
  combinations: VariantMatrixItem[];
}

/**
 * Derives the authoritative category variant matrix of valid combinations
 * (automationTier × surfaceFinish).
 */
export function getCategoryVariantMatrix(
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null | undefined
): CategoryVariantMatrix {
  const config = getCategoryConfig(category);
  const combinations: VariantMatrixItem[] = [];

  if (config.hasAutomationTiers && config.hasSurfaceFinishes) {
    for (const tier of config.configuredTiers) {
      for (const finish of config.configuredFinishes) {
        combinations.push({
          automationTier: tier.value,
          surfaceFinish: finish.value,
          tierLabel: tier.label,
          finishLabel: finish.label,
          displayName: `${tier.label} · ${finish.label}`,
        });
      }
    }
  } else if (config.hasAutomationTiers) {
    for (const tier of config.configuredTiers) {
      combinations.push({
        automationTier: tier.value,
        surfaceFinish: null,
        tierLabel: tier.label,
        finishLabel: null,
        displayName: tier.label,
      });
    }
  } else if (config.hasSurfaceFinishes) {
    for (const finish of config.configuredFinishes) {
      combinations.push({
        automationTier: null,
        surfaceFinish: finish.value,
        tierLabel: null,
        finishLabel: finish.label,
        displayName: finish.label,
      });
    }
  }

  return {
    configuredTiers: config.configuredTiers,
    configuredFinishes: config.configuredFinishes,
    hasAutomationTiers: config.hasAutomationTiers,
    hasSurfaceFinishes: config.hasSurfaceFinishes,
    hasMatrix: combinations.length > 0,
    totalCombinations: combinations.length,
    combinations,
  };
}

