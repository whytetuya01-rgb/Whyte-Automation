import type { Product, ProductVariant } from "@/types";
import { formatFinishLabel, formatTierLabel } from "@/lib/categoryConfig";
import { formatCurrency } from "@/lib/utils";

/* ------------------------------------------------------------------ types -- */

export interface ProductTypeMeta {
  label: string;
  badgeClass: string;
}

export interface CatalogFilterOption {
  value: string;
  label: string;
}

/** Filter options for the Type control, in display order. */
export const PRODUCT_TYPE_FILTERS: CatalogFilterOption[] = [
  { value: "switch_board", label: "Switch Board" },
  { value: "accessory", label: "Accessory" },
  { value: "curtain", label: "Curtain" },
  { value: "smart_lock", label: "Smart Lock" },
  { value: "vdp", label: "VDP" },
  { value: "other", label: "Other" },
];

export const PRODUCT_TYPE_META: Record<string, ProductTypeMeta> = {
  switch_board: { label: "Switch Board", badgeClass: "bg-slate-100 text-slate-700 border-slate-200" },
  accessory: { label: "Accessory", badgeClass: "bg-neutral-100 text-neutral-600 border-neutral-200" },
  curtain: { label: "Curtain", badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  smart_lock: { label: "Smart Lock", badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  vdp: { label: "VDP", badgeClass: "bg-sky-50 text-sky-700 border-sky-100" },
  other: { label: "Other", badgeClass: "bg-neutral-100 text-neutral-500 border-neutral-200" },
};

export function getProductTypeMeta(type: string | null | undefined): ProductTypeMeta {
  return PRODUCT_TYPE_META[type ?? ""] ?? PRODUCT_TYPE_META.other;
}

export interface MetaPair {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Walks the category parent chain so the catalog can show a "Series" line.
 */
export function getCategorySeries(category: Product["category"]): string | null {
  let cursor = category?.parent ?? null;
  while (cursor?.parent) cursor = cursor.parent;
  return cursor?.name?.trim() || null;
}

/**
 * Clean metadata for a product: Category, SKU/Code, Module.
 * Internal migration notes / catalog fields are hidden to remove visual noise.
 */
export function getProductMetaPairs(product: Product): MetaPair[] {
  const pairs: MetaPair[] = [];

  const moduleSize = product.moduleSize?.trim();
  if (moduleSize) pairs.push({ label: "Module", value: moduleSize, mono: true });

  const code = product.code?.trim();
  if (code && !code.startsWith("MIG_")) pairs.push({ label: "Code", value: code, mono: true });

  const category = product.category?.name?.trim();
  if (category) pairs.push({ label: "Category", value: category });

  return pairs;
}

export interface VariantRow {
  variant: ProductVariant;
  index: number;
  displayName: string;
  tierLabel: string | null;
  finishLabel: string | null;
  hasAnyDimension: boolean;
  code: string | null;
  priceText: string;
  isActive: boolean;
}

function readConfigValue(
  config: Record<string, string> | undefined,
  key: string
): string | null {
  const raw = config?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function getVariantRows(variants: ProductVariant[]): VariantRow[] {
  return variants.map((variant, index) => {
    const tierLabel = formatTierLabel(variant.automationTier);
    const finishLabel = formatFinishLabel(variant.surfaceFinish);

    const parts: string[] = [];
    if (tierLabel) parts.push(tierLabel);
    if (finishLabel) parts.push(finishLabel);

    const fallbackName = variant.name?.trim();
    const displayName = parts.length > 0 ? parts.join(" · ") : fallbackName || "Standard";

    const code =
      variant.variantCode?.trim() ||
      variant.code?.trim() ||
      readConfigValue(variant.config, "variantCode") ||
      readConfigValue(variant.config, "code");

    return {
      variant,
      index,
      displayName,
      tierLabel,
      finishLabel,
      hasAnyDimension: Boolean(tierLabel || finishLabel),
      code: code && !code.startsWith("MIG_") ? code : null,
      priceText: Number.isFinite(Number(variant.price)) ? formatCurrency(variant.price) : "—",
      isActive: variant.isActive,
    };
  });
}

export interface CatalogStatCard {
  id: string;
  label: string;
  value: number;
  tone: "neutral" | "success" | "accent" | "info";
}

export type CatalogStatTone = CatalogStatCard["tone"];

export const STAT_TONE_CLASSES: Record<CatalogStatTone, { icon: string; value: string }> = {
  neutral: { icon: "bg-neutral-100 text-neutral-600", value: "text-neutral-900" },
  success: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-700" },
  accent: { icon: "bg-pink-50 text-pink-600", value: "text-pink-700" },
  info: { icon: "bg-violet-50 text-violet-600", value: "text-violet-700" },
};