import { getCategoryVariantMatrix } from "@/lib/categoryConfig";
import type { ApiErrorCode } from "@/lib/api-response";

/**
 * Pure (database-free) variant matrix rules, shared by the API routes and the
 * admin UI so validation logic exists in exactly one place.
 *
 * The category master data is authoritative: a submitted final matrix must
 * match the category's configured combinations exactly. No arbitrary
 * automationTier / surfaceFinish combinations are ever invented or accepted.
 */

export interface MatrixRuleError {
  code: ApiErrorCode;
  message: string;
  field?: string;
}

export interface NormalizedVariantRow {
  automationTier: string | null;
  surfaceFinish: string | null;
  displayName: string;
  variantCode: string;
  price: number;
  sortOrder: number;
}

export type MatrixValidationResult =
  | { valid: true }
  | { valid: false; error: MatrixRuleError };

/** Message for the "category has no configured matrix" business-rule gap. */
export const NO_MATRIX_CATEGORY_MESSAGE =
  "This category has no configured variant matrix, so no variants can be created. " +
  "Variants are currently required for pricing and quotations — ask an administrator " +
  "to configure automation tiers or surface finishes for this category.";

export const NO_VARIANTS_MESSAGE =
  "A product must have at least one variant, so the variant list cannot be empty.";

export const MINIMUM_VARIANT_MESSAGE =
  "This is the only variant left for this product. A product must always keep at least one variant.";

function combinationKey(automationTier: string | null, surfaceFinish: string | null): string {
  return `${automationTier ?? ""}|${surfaceFinish ?? ""}`;
}

function buildCombinationSet(category: {
  variantTiers?: unknown;
  variantFinishes?: unknown;
} | null | undefined): {
  allowed: Set<string>;
  displayNames: Map<string, string>;
} {
  const matrix = getCategoryVariantMatrix(category);
  const allowed = new Set<string>();
  const displayNames = new Map<string, string>();

  for (const combination of matrix.combinations) {
    const key = combinationKey(combination.automationTier, combination.surfaceFinish);
    allowed.add(key);
    displayNames.set(key, combination.displayName);
  }

  return { allowed, displayNames };
}

/**
 * Validates that the submitted final variant matrix only contains combinations
 * the category actually defines:
 *  - the category has at least one configured combination (otherwise: business-rule gap)
 *  - the submission is not empty (a product always keeps >= 1 variant)
 *  - every row maps to a configured combination (no arbitrary values)
 *  - no combination is duplicated
 *
 * The submitted set is the FINAL matrix and is persisted exactly as submitted:
 * a user may deliberately leave a configured combination out. The category
 * master data decides which combinations are legal, never which ones are
 * forced to exist.
 */
export function validateFinalVariantMatrix(params: {
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null | undefined;
  submittedRows: Array<{
    automationTier?: unknown;
    surfaceFinish?: unknown;
    variantCode?: unknown;
    price?: unknown;
  }>;
}): MatrixValidationResult {
  const { category, submittedRows } = params;
  const { allowed, displayNames } = buildCombinationSet(category);

  if (allowed.size === 0) {
    return {
      valid: false,
      error: { code: "VALIDATION_ERROR", message: NO_MATRIX_CATEGORY_MESSAGE, field: "variants" },
    };
  }

  if (!Array.isArray(submittedRows) || submittedRows.length === 0) {
    return {
      valid: false,
      error: { code: "REQUIRED_FIELD", message: NO_VARIANTS_MESSAGE, field: "variants" },
    };
  }

  const seen = new Set<string>();

  for (let index = 0; index < submittedRows.length; index += 1) {
    const row = submittedRows[index];
    const rowLabel = `Variant ${index + 1}`;

    const rawTier =
      row.automationTier === undefined || row.automationTier === null
        ? ""
        : String(row.automationTier).trim();
    const rawFinish =
      row.surfaceFinish === undefined || row.surfaceFinish === null
        ? ""
        : String(row.surfaceFinish).trim();

    const key = combinationKey(rawTier || null, rawFinish || null);

    if (!allowed.has(key)) {
      return {
        valid: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `${rowLabel} does not match any configured combination for this category. Allowed combinations: ${[
            ...displayNames.values(),
          ].join(" · ")}`,
          field: `variants.${index}`,
        },
      };
    }

    if (seen.has(key)) {
      return {
        valid: false,
        error: {
          code: "DUPLICATE_RECORD",
          message: `${rowLabel} duplicates the combination "${displayNames.get(key)}". Each combination may only appear once.`,
          field: `variants.${index}`,
        },
      };
    }

    seen.add(key);
  }

  return { valid: true };
}

/**
 * Normalises a validated matrix into rows ready for persistence.
 * Assumes validateFinalVariantMatrix has already passed.
 */
export function normalizeVariantRows(rows: Array<{
  automationTier?: unknown;
  surfaceFinish?: unknown;
  variantCode?: unknown;
  price?: unknown;
  sortOrder?: unknown;
}>): NormalizedVariantRow[] {
  return rows.map((row, index) => {
    const automationTier =
      row.automationTier === undefined || row.automationTier === null
        ? null
        : String(row.automationTier).trim() || null;
    const surfaceFinish =
      row.surfaceFinish === undefined || row.surfaceFinish === null
        ? null
        : String(row.surfaceFinish).trim() || null;

    return {
      automationTier,
      surfaceFinish,
      displayName: buildVariantDisplayName(automationTier, surfaceFinish),
      variantCode: String(row.variantCode ?? "").trim(),
      price: Number(row.price ?? 0),
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : index,
    };
  });
}

export function buildVariantDisplayName(
  automationTier: string | null,
  surfaceFinish: string | null
): string {
  if (automationTier && surfaceFinish) return `${automationTier} · ${surfaceFinish}`;
  return automationTier ?? surfaceFinish ?? "Standard";
}

export interface VariantCodeRule {
  maxLength: number;
  pattern: RegExp;
  patternDescription: string;
}

export const VARIANT_CODE_RULE: VariantCodeRule = {
  maxLength: 60,
  pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
  patternDescription: "letters, numbers, dot, dash, underscore or slash",
};

export type VariantCodeResult =
  | { valid: true; value: string }
  | { valid: false; message: string };

/**
 * Validates a variant code for a NEW write or an edit.
 * Legacy variants that already exist with a null code are never touched; this
 * rule only applies to writes.
 */
export function validateVariantCode(raw: unknown, fieldLabel = "Variant code"): VariantCodeResult {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { valid: false, message: `${fieldLabel} is required.` };
  }

  const value = String(raw).trim();

  if (value.length > VARIANT_CODE_RULE.maxLength) {
    return {
      valid: false,
      message: `${fieldLabel} must be ${VARIANT_CODE_RULE.maxLength} characters or fewer.`,
    };
  }

  if (!VARIANT_CODE_RULE.pattern.test(value)) {
    return {
      valid: false,
      message: `${fieldLabel} may only contain ${VARIANT_CODE_RULE.patternDescription}.`,
    };
  }

  return { valid: true, value };
}

/** Case-insensitive uniqueness of codes within one product. */
export function findDuplicateVariantCode(
  entries: Array<{ id?: number | null; variantCode: string }>
): { id?: number | null; variantCode: string; firstId: number | null } | null {
  const byCode = new Map<string, number | null>();

  for (const entry of entries) {
    const code = entry.variantCode.trim();
    if (!code) continue;

    const key = code.toUpperCase();
    if (byCode.has(key)) {
      return { id: entry.id ?? null, variantCode: code, firstId: byCode.get(key) ?? null };
    }
    byCode.set(key, entry.id ?? null);
  }

  return null;
}

/** Optional UI helper: proposes a code for a new variant. Never overwrites an entered value. */
export function suggestVariantCode(params: {
  productCode: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  existingCodes?: string[];
}): string {
  const segments = [
    params.productCode,
    params.automationTier,
    params.surfaceFinish,
  ]
    .map((segment) => (segment ? String(segment).trim().toUpperCase() : ""))
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""));

  const base = segments.join("-") || "VARIANT";
  const taken = new Set((params.existingCodes ?? []).map((code) => code.toUpperCase()));

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Variants matrix status (ACTIVE / REMOVED / NOT ADDED)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a category-matrix combination relates to a single Product right now.
 *
 *  - `active`    the Product has a live ProductVariant for this combination
 *  - `removed`   the combination was hard-deleted from this Product and the
 *                deletion is recorded in ProductVariantHistory (restorable)
 *  - `not_added` the combination is valid for the category but this Product has
 *                never had a variant for it
 */
export type VariantMatrixStatus = "active" | "removed" | "not_added";

export interface VariantMatrixActiveVariant {
  id: number;
  variantCode: string;
  code: string;
  name: string | null;
  price: string;
  isActive: boolean;
  sortOrder: number;
}

export interface VariantMatrixHistorySnapshot {
  historyId: number;
  /** The _id the deleted variant used to have. Restores get a NEW id. */
  previousVariantId: number;
  variantCode: string | null;
  price: string | null;
  name: string | null;
  reason: string;
  deletedAt: string;
  deletedBy: string | null;
}

export interface VariantMatrixRow {
  /** Stable key for the combination, safe for React keys and DOM ids. */
  key: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  tierLabel: string | null;
  finishLabel: string | null;
  displayName: string;
  status: VariantMatrixStatus;
  /** Populated only when status === "active". */
  variant: VariantMatrixActiveVariant | null;
  /** Populated only when status === "removed". */
  history: VariantMatrixHistorySnapshot | null;
}

/** A live variant whose combination is not (or no longer) part of the matrix. */
export interface UnsupportedVariant {
  id: number;
  displayName: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  variantCode: string;
  price: string;
  reason: "not_in_matrix" | "duplicate_combination";
}

export interface VariantMatrixSummary {
  total: number;
  active: number;
  removed: number;
  notAdded: number;
}

export interface VariantMatrixSnapshot {
  rows: VariantMatrixRow[];
  summary: VariantMatrixSummary;
  /** Live variants the matrix does not account for — still deletable, never hidden. */
  unsupportedVariants: UnsupportedVariant[];
}

interface RawVariant {
  id?: number | null;
  _id?: number | null;
  automationTier?: unknown;
  surfaceFinish?: unknown;
  variantCode?: unknown;
  code?: unknown;
  name?: unknown;
  config?: unknown;
  price?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
}

interface RawHistory {
  id?: number | null;
  _id?: number | null;
  variantId?: number | null;
  automationTier?: unknown;
  surfaceFinish?: unknown;
  variantCode?: unknown;
  price?: unknown;
  name?: unknown;
  reason?: unknown;
  deletedAt?: unknown;
  deletedBy?: unknown;
}

function asTrimmedOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function readLegacyConfig(config: unknown): { series: string | null; finish: string | null } {
  if (!config || typeof config !== "object") return { series: null, finish: null };
  const record = config as { series?: unknown; finish?: unknown };
  return {
    series: asTrimmedOrNull(record.series),
    finish: asTrimmedOrNull(record.finish),
  };
}

/**
 * Resolves the combination a record represents, falling back to the legacy
 * `config.series` / `config.finish` keys so old rows still line up with the
 * category matrix.
 */
export function resolveVariantCombination(record: {
  automationTier?: unknown;
  surfaceFinish?: unknown;
  config?: unknown;
}): { automationTier: string | null; surfaceFinish: string | null } {
  const legacy = readLegacyConfig(record.config);
  return {
    automationTier: asTrimmedOrNull(record.automationTier) ?? legacy.series,
    surfaceFinish: asTrimmedOrNull(record.surfaceFinish) ?? legacy.finish,
  };
}

function toPriceString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") return new Date(value).toISOString();
  return new Date(0).toISOString();
}

/**
 * Merges the category's authoritative matrix, the Product's live variants and
 * its ProductVariantHistory rows into one row per valid combination.
 *
 * Rules:
 *  - the category matrix decides which combinations exist at all
 *  - a live variant always wins over history (ACTIVE beats REMOVED)
 *  - only the most recent history row per combination is surfaced
 *  - live variants the matrix does not account for are returned separately so
 *    the UI can still show (and delete) them
 */
export function buildVariantMatrixSnapshot(params: {
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null | undefined;
  variants: RawVariant[];
  history: RawHistory[];
}): VariantMatrixSnapshot {
  const matrix = getCategoryVariantMatrix(params.category);
  const allowed = new Set<string>();
  const matrixMeta = new Map<
    string,
    {
      automationTier: string | null;
      surfaceFinish: string | null;
      tierLabel: string | null;
      finishLabel: string | null;
      displayName: string;
    }
  >();

  for (const combination of matrix.combinations) {
    const key = combinationKey(combination.automationTier, combination.surfaceFinish);
    allowed.add(key);
    matrixMeta.set(key, {
      automationTier: combination.automationTier,
      surfaceFinish: combination.surfaceFinish,
      tierLabel: combination.tierLabel,
      finishLabel: combination.finishLabel,
      displayName: combination.displayName,
    });
  }

  // Live variants, indexed by combination. First one (lowest sortOrder) wins.
  const activeByKey = new Map<string, VariantMatrixActiveVariant>();
  const unsupportedVariants: UnsupportedVariant[] = [];
  const claimedKeys = new Set<string>();

  const sortedVariants = [...(params.variants ?? [])].sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.id ?? a._id ?? 0) - Number(b.id ?? b._id ?? 0);
  });

  for (const variant of sortedVariants) {
    const id = Number(variant.id ?? variant._id ?? 0);
    const combination = resolveVariantCombination(variant);
    const key = combinationKey(combination.automationTier, combination.surfaceFinish);
    const code = String(variant.variantCode ?? variant.code ?? "").trim();

    if (!allowed.has(key)) {
      unsupportedVariants.push({
        id,
        displayName: buildVariantDisplayName(combination.automationTier, combination.surfaceFinish),
        automationTier: combination.automationTier,
        surfaceFinish: combination.surfaceFinish,
        variantCode: code,
        price: toPriceString(variant.price),
        reason: "not_in_matrix",
      });
      continue;
    }

    if (claimedKeys.has(key)) {
      unsupportedVariants.push({
        id,
        displayName: buildVariantDisplayName(combination.automationTier, combination.surfaceFinish),
        automationTier: combination.automationTier,
        surfaceFinish: combination.surfaceFinish,
        variantCode: code,
        price: toPriceString(variant.price),
        reason: "duplicate_combination",
      });
      continue;
    }

    claimedKeys.add(key);
    activeByKey.set(key, {
      id,
      variantCode: code,
      code: String(variant.code ?? "").trim(),
      name: asTrimmedOrNull(variant.name),
      price: toPriceString(variant.price),
      isActive: variant.isActive !== false,
      sortOrder: typeof variant.sortOrder === "number" ? variant.sortOrder : 0,
    });
  }

  // Most recent history row per combination.
  const historyByKey = new Map<string, VariantMatrixHistorySnapshot>();
  for (const entry of params.history ?? []) {
    const combination = resolveVariantCombination(entry);
    const key = combinationKey(combination.automationTier, combination.surfaceFinish);
    const deletedAt = toDateString(entry.deletedAt);
    const existing = historyByKey.get(key);
    if (existing && existing.deletedAt > deletedAt) continue;

    historyByKey.set(key, {
      historyId: Number(entry.id ?? entry._id ?? 0),
      previousVariantId: Number(entry.variantId ?? 0),
      variantCode: asTrimmedOrNull(entry.variantCode),
      price: toPriceString(entry.price) || null,
      name: asTrimmedOrNull(entry.name),
      reason: typeof entry.reason === "string" ? entry.reason : "hard_delete",
      deletedAt,
      deletedBy: asTrimmedOrNull(entry.deletedBy),
    });
  }

  const rows: VariantMatrixRow[] = [];
  let activeCount = 0;
  let removedCount = 0;
  let notAddedCount = 0;

  for (const combination of matrix.combinations) {
    const key = combinationKey(combination.automationTier, combination.surfaceFinish);
    const meta = matrixMeta.get(key);
    if (!meta) continue;

    const variant = activeByKey.get(key) ?? null;
    const history = variant ? null : historyByKey.get(key) ?? null;
    const status: VariantMatrixStatus = variant ? "active" : history ? "removed" : "not_added";

    if (status === "active") activeCount += 1;
    else if (status === "removed") removedCount += 1;
    else notAddedCount += 1;

    rows.push({
      key,
      automationTier: meta.automationTier,
      surfaceFinish: meta.surfaceFinish,
      tierLabel: meta.tierLabel,
      finishLabel: meta.finishLabel,
      displayName: meta.displayName,
      status,
      variant,
      history,
    });
  }

  return {
    rows,
    summary: {
      total: rows.length,
      active: activeCount,
      removed: removedCount,
      notAdded: notAddedCount,
    },
    unsupportedVariants,
  };
}

/** Case-insensitive existence check of a code against a product's live variants. */
export function findVariantCodeOwner(
  entries: Array<{ id: number; variantCode: string | null }>,
  candidate: string
): number | null {
  const key = candidate.trim().toUpperCase();
  if (!key) return null;
  for (const entry of entries) {
    if (String(entry.variantCode ?? "").trim().toUpperCase() === key) return entry.id;
  }
  return null;
}

/**
 * Plain, JSON-safe representation of a single ProductVariant.
 *
 * Used by the Add and Restore endpoints so a freshly created variant is returned
 * in the same shape the matrix screen already renders: the numeric `_id` becomes
 * `id` and the Decimal128 price becomes a plain string instead of the
 * `{$numberDecimal: "..."}` object a raw document would serialize to.
 */
export function serializeVariant(
  variant: RawVariant & { _id?: unknown; id?: unknown }
): VariantMatrixActiveVariant {
  const id = Number(variant.id ?? variant._id ?? 0);
  const variantCode = String(variant.variantCode ?? variant.code ?? "").trim();
  const combination = resolveVariantCombination(variant);

  return {
    id,
    variantCode,
    code: String(variant.code ?? variantCode).trim(),
    name: asTrimmedOrNull(variant.name) ?? buildVariantDisplayName(combination.automationTier, combination.surfaceFinish),
    price: toPriceString(variant.price),
    isActive: variant.isActive !== false,
    sortOrder: typeof variant.sortOrder === "number" ? variant.sortOrder : 0,
  };
}
