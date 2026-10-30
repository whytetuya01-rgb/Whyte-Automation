/**
 * Category-driven product specifications (#3, batch 3).
 *
 * A category defines specification fields (text, number with a unit, or a dropdown); every product in that category,
 * or in any of its sub-categories, fills them in. Values are stored on the product (`Product.specs`, keyed by the
 * field's stable `key`). Each field says whether it shows in the product picker and on the quotation PDF.
 *
 * Per-variant values are a planned extension: `scope` is reserved for it and `resolveItemSpecs` already accepts
 * variant values that override the product's, so adding them later needs no change to stored data.
 *
 * Pure helpers shared by the server (validation, APIs) and the screens.
 */

export type SpecFieldType = "text" | "number" | "select";
export const SPEC_FIELD_TYPES: readonly SpecFieldType[] = ["text", "number", "select"];
export const SPEC_FIELD_TYPE_LABELS: Record<SpecFieldType, string> = { text: "Text", number: "Number", select: "Dropdown" };

export const SPEC_LIMITS = { fields: 30, key: 40, label: 60, unit: 12, options: 30, option: 60, text: 200 } as const;
export const SPEC_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export interface SpecField {
  /** Stable identifier the values are stored under; never changes once created (labels can). */
  key: string;
  label: string;
  type: SpecFieldType;
  /** Shown after the value, e.g. "A", "W", "mm". */
  unit: string | null;
  /** Dropdown choices (dropdown fields only). */
  options: string[];
  required: boolean;
  showInPicker: boolean;
  showOnPdf: boolean;
  /** Where values live: "product" today. Reserved for per-variant values later. */
  scope: "product";
}

export type SpecValue = string | number;
export type ProductSpecs = Record<string, SpecValue>;

/** A category's own fields plus the fields it inherits, as the screens receive them. */
export interface CategorySpecSource {
  id: number;
  parentId: number | null;
  name?: string;
  specFields?: unknown;
}

const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** A label turned into a key: "Load Current (A)" -> "load_current_a". Never empty; never starts with a digit. */
export function specKeyFromLabel(label: string, taken: Iterable<string> = []): string {
  const base = (label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field").slice(0, SPEC_LIMITS.key - 4);
  const start = /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, SPEC_LIMITS.key - 4);
  const used = new Set(taken);
  let key = start;
  for (let n = 2; used.has(key); n += 1) key = `${start}_${n}`;
  return key;
}

/** Stored fields read back safely: valid fields only, each key once, in their stored order. Always fresh objects. */
export function normalizeSpecFields(stored: unknown): SpecField[] {
  if (!Array.isArray(stored)) return [];
  const fields: SpecField[] = [];
  const seen = new Set<string>();
  for (const row of stored) {
    if (!row || typeof row !== "object") continue;
    const source = row as Record<string, unknown>;
    const key = typeof source.key === "string" ? source.key : "";
    const label = cleanText(source.label, SPEC_LIMITS.label);
    const type = SPEC_FIELD_TYPES.includes(source.type as SpecFieldType) ? (source.type as SpecFieldType) : null;
    if (!SPEC_KEY_PATTERN.test(key) || !label || !type || seen.has(key)) continue;
    const options = type === "select" && Array.isArray(source.options)
      ? [...new Set(source.options.map((option) => cleanText(option, SPEC_LIMITS.option)).filter((option): option is string => Boolean(option)))].slice(0, SPEC_LIMITS.options)
      : [];
    if (type === "select" && options.length === 0) continue;
    seen.add(key);
    fields.push({
      key,
      label,
      type,
      unit: type === "select" ? null : cleanText(source.unit, SPEC_LIMITS.unit),
      options,
      required: source.required === true,
      showInPicker: source.showInPicker === true,
      showOnPdf: source.showOnPdf === true,
      scope: "product",
    });
    if (fields.length >= SPEC_LIMITS.fields) break;
  }
  return fields;
}

/** The ancestor chain of a category, top-level first (unknown parents and cycles stop safely). */
export function categoryChain<T extends CategorySpecSource>(categoryId: number | null | undefined, categories: ReadonlyArray<T>): T[] {
  if (categoryId === null || categoryId === undefined) return [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const chain: T[] = [];
  const seen = new Set<number>();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}

export interface ApplicableSpecField extends SpecField {
  /** The category that defines the field (the product's own category or one above it). */
  categoryId: number;
  categoryName: string | null;
}

/** The fields a product in this category fills in: inherited ones first (top-level down), each key once. */
export function specFieldsForCategory(categoryId: number | null | undefined, categories: ReadonlyArray<CategorySpecSource>): ApplicableSpecField[] {
  const fields: ApplicableSpecField[] = [];
  const seen = new Set<string>();
  for (const category of categoryChain(categoryId, categories)) {
    for (const field of normalizeSpecFields(category.specFields)) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      fields.push({ ...field, categoryId: category.id, categoryName: category.name ?? null });
    }
  }
  return fields;
}

/** Flattens a nested category tree (as GET /api/categories returns it) into rows with parent ids. */
export function flattenCategoryTree(tree: ReadonlyArray<{ id?: unknown; _id?: unknown; parentId?: unknown; name?: unknown; specFields?: unknown; children?: unknown }>): CategorySpecSource[] {
  const rows: CategorySpecSource[] = [];
  const walk = (nodes: ReadonlyArray<Record<string, unknown>>, parentId: number | null) => {
    for (const node of nodes) {
      const id = Number(node.id ?? node._id);
      if (!Number.isFinite(id)) continue;
      const storedParent = node.parentId === null || node.parentId === undefined ? parentId : Number(node.parentId);
      rows.push({ id, parentId: storedParent, name: typeof node.name === "string" ? node.name : undefined, specFields: node.specFields });
      if (Array.isArray(node.children)) walk(node.children as Array<Record<string, unknown>>, id);
    }
  };
  walk(tree as ReadonlyArray<Record<string, unknown>>, null);
  return rows;
}

export interface SpecValidationError {
  key: string;
  message: string;
}

/**
 * Checks submitted values against the fields: text trimmed (up to 200 characters), numbers finite (up to 4 decimals),
 * dropdown values one of the options, required fields present. Blank values are simply not stored. Keys that are not
 * fields of the product's category are refused.
 */
export function validateSpecValues(fields: ReadonlyArray<SpecField>, input: unknown): { values: ProductSpecs; errors: SpecValidationError[] } {
  const values: ProductSpecs = {};
  const errors: SpecValidationError[] = [];
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (input !== undefined && input !== null && !source) return { values, errors: [{ key: "", message: "Specifications must be an object." }] };
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(source ?? {})) {
    if (!byKey.has(key)) errors.push({ key, message: `"${key}" is not a specification of this product's category.` });
  }
  for (const field of fields) {
    const raw = source?.[field.key];
    const blank = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (blank) {
      if (field.required) errors.push({ key: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (field.type === "number") {
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(parsed) || Math.abs(parsed) > 1e9 || Math.abs(Math.round(parsed * 1e4) - parsed * 1e4) > 1e-6) {
        errors.push({ key: field.key, message: `${field.label} must be a number (up to 4 decimals).` });
      } else values[field.key] = parsed;
    } else if (typeof raw !== "string" && typeof raw !== "number") {
      errors.push({ key: field.key, message: `${field.label} must be text.` });
    } else if (field.type === "select") {
      const text = String(raw).trim();
      if (!field.options.includes(text)) errors.push({ key: field.key, message: `${field.label} must be one of: ${field.options.join(", ")}.` });
      else values[field.key] = text;
    } else {
      const text = String(raw).replace(/\s+/g, " ").trim();
      if (/[\u0000-\u001f\u007f]/.test(text)) errors.push({ key: field.key, message: `${field.label} contains invalid characters.` });
      else if (text.length > SPEC_LIMITS.text) errors.push({ key: field.key, message: `${field.label} must be ${SPEC_LIMITS.text} characters or fewer.` });
      else values[field.key] = text;
    }
  }
  return { values, errors };
}

/** Stored product values read back safely (strings and finite numbers only). */
export function normalizeProductSpecs(stored: unknown): ProductSpecs {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const values: ProductSpecs = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!SPEC_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" && value.trim()) values[key] = value.trim().slice(0, SPEC_LIMITS.text);
    else if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
  }
  return values;
}

export function formatSpecValue(field: Pick<SpecField, "type" | "unit">, value: SpecValue): string {
  const text = typeof value === "number" ? String(Number(value.toFixed(4))) : value;
  return field.unit ? `${text} ${field.unit}` : text;
}

export interface DisplaySpec {
  key: string;
  label: string;
  text: string;
}

/**
 * The specifications to show for an item: the product's values, overridden by the variant's (future), for the fields
 * of its category, in field order, filtered to the place they are shown.
 */
export function resolveItemSpecs(
  fields: ReadonlyArray<SpecField>,
  productSpecs: unknown,
  variantSpecs?: unknown,
  where: "all" | "picker" | "pdf" = "all"
): DisplaySpec[] {
  const values = { ...normalizeProductSpecs(productSpecs), ...normalizeProductSpecs(variantSpecs) };
  const shown: DisplaySpec[] = [];
  for (const field of fields) {
    if (where === "picker" && !field.showInPicker) continue;
    if (where === "pdf" && !field.showOnPdf) continue;
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.type === "select" && !field.options.includes(String(value))) continue;
    if (field.type === "number" && typeof value !== "number") continue;
    shown.push({ key: field.key, label: field.label, text: formatSpecValue(field, value) });
  }
  return shown;
}
