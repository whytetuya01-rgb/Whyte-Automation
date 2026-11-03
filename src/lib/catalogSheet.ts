import { gstSplitKeepingPrice } from "@/lib/taxSettings";

/**
 * Excel import / export of the catalogue (#3, batch 7): the sheet's columns, how a row is read and checked, how rows are
 * grouped into products, and what an import would do. Pure (no database, no file handling), so the preview and the real
 * import cannot disagree and every rule can be tested directly.
 *
 * One row per VARIANT. Products and variants are matched by code (the product's code, then the variant's code within it), never
 * by name or position. A blank cell on an existing record means "leave it as it is"; the import never deletes anything and never
 * touches quotations (they hold their own price snapshot).
 */

export const PRODUCT_TYPES = ["switch_board", "accessory", "curtain", "smart_lock", "vdp", "other"] as const;

export interface ColumnDef {
  key: ColumnKey;
  header: string;
  required?: boolean;
  /** Shown on the template's help sheet. */
  help: string;
}

export type ColumnKey =
  | "productCode" | "productName" | "category" | "type" | "unit" | "description" | "moduleSize" | "notes" | "hsnCode" | "gstRate" | "productActive"
  | "variantCode" | "variantName" | "tier" | "finish" | "price" | "cost" | "variantActive";

export const COLUMNS: ColumnDef[] = [
  { key: "productCode", header: "Product Code", required: true, help: "Your unique product code. An existing code updates that product; a new code creates one." },
  { key: "productName", header: "Product Name", help: "Required for a new product." },
  { key: "category", header: "Category", help: "The name of one of your categories. Required for a new product. Categories are not created by the import." },
  { key: "type", header: "Type", help: `One of: ${PRODUCT_TYPES.join(", ")}. New products default to "other".` },
  { key: "unit", header: "Unit", help: 'e.g. pcs. New products default to "pcs".' },
  { key: "description", header: "Description", help: "Free text." },
  { key: "moduleSize", header: "Module Size", help: "Free text, e.g. 4M." },
  { key: "notes", header: "Notes", help: "Free text." },
  { key: "hsnCode", header: "HSN/SAC", help: "A code from your GST & HSN/SAC list." },
  { key: "gstRate", header: "GST %", help: "One of your allowed GST rates. Prices include GST; this only splits the price." },
  { key: "productActive", header: "Product Active", help: "Yes or No." },
  { key: "variantCode", header: "Variant Code", required: true, help: "Unique within the product. An existing code updates that variant; a new code adds one." },
  { key: "variantName", header: "Variant Name", help: "Display name of the variant." },
  { key: "tier", header: "Automation Tier", help: "Only for a new variant. An existing variant's tier is never changed by the import." },
  { key: "finish", header: "Surface Finish", help: "Only for a new variant. An existing variant's finish is never changed by the import." },
  { key: "price", header: "Price (incl. GST)", help: "The selling price including GST, in rupees. Required for a new variant." },
  { key: "cost", header: "Cost", help: "Your purchase cost, in rupees." },
  { key: "variantActive", header: "Variant Active", help: "Yes or No." },
];

export const MAX_IMPORT_ROWS = 5000;
export const normalizeHeader = (value: unknown): string => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const HEADER_TO_KEY = new Map(COLUMNS.map((column) => [normalizeHeader(column.header), column.key]));

// ── reading the table ────────────────────────────────────────────────────────────────────────────────────────────

export interface RawRow {
  /** The row's number in the sheet (the header is row 1). */
  row: number;
  cells: Partial<Record<ColumnKey, string>>;
}

export interface TableRead {
  rows: RawRow[];
  /** Columns the sheet has that the import does not know (ignored). */
  ignoredColumns: string[];
  /** Problems with the sheet as a whole (a missing required column, too many rows). */
  fileErrors: string[];
}

/** Reads a table of cell texts whose first row is the header. Blank rows are skipped. */
export function readTable(table: ReadonlyArray<ReadonlyArray<unknown>>): TableRead {
  const result: TableRead = { rows: [], ignoredColumns: [], fileErrors: [] };
  const header = table[0];
  if (!header || header.every((cell) => String(cell ?? "").trim() === "")) {
    result.fileErrors.push("The sheet is empty: the first row must hold the column names.");
    return result;
  }
  const indexOf = new Map<ColumnKey, number>();
  header.forEach((cell, index) => {
    const text = String(cell ?? "").trim();
    if (!text) return;
    const key = HEADER_TO_KEY.get(normalizeHeader(text));
    if (!key) result.ignoredColumns.push(text);
    else if (indexOf.has(key)) result.fileErrors.push(`The column "${text}" appears more than once.`);
    else indexOf.set(key, index);
  });
  for (const column of COLUMNS) if (column.required && !indexOf.has(column.key)) result.fileErrors.push(`The column "${column.header}" is missing.`);
  if (result.fileErrors.length > 0) return result;

  for (let r = 1; r < table.length; r += 1) {
    const cells: Partial<Record<ColumnKey, string>> = {};
    let any = false;
    for (const [key, index] of indexOf) {
      const text = String(table[r]?.[index] ?? "").trim();
      if (text !== "") {
        cells[key] = text;
        any = true;
      }
    }
    if (any) result.rows.push({ row: r + 1, cells });
  }
  if (result.rows.length === 0) result.fileErrors.push("There are no data rows below the column names.");
  if (result.rows.length > MAX_IMPORT_ROWS) result.fileErrors.push(`The sheet has ${result.rows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);
  return result;
}

// ── checking a row ───────────────────────────────────────────────────────────────────────────────────────────────

export interface SheetContext {
  categories: Array<{ id: number; name: string; isActive: boolean; hasMatrix: boolean }>;
  gstRates: number[];
  hsnCodes: string[];
  /** The company's default GST rate: used to split the price of a new variant whose product has no GST rate. */
  defaultGstRate?: number;
}

export interface RowIssue {
  row: number;
  column: string;
  message: string;
  /** The product the row belongs to, when known: one bad row holds back the whole product. */
  productCode?: string;
}

export interface ParsedRow {
  row: number;
  productCode: string;
  productName?: string;
  categoryId?: number;
  type?: (typeof PRODUCT_TYPES)[number];
  unit?: string;
  description?: string;
  moduleSize?: string;
  notes?: string;
  hsnCode?: string;
  gstRate?: number;
  productActive?: boolean;
  variantCode: string;
  variantName?: string;
  tier?: string;
  finish?: string;
  price?: number;
  cost?: number;
  variantActive?: boolean;
}

const header = (key: ColumnKey) => COLUMNS.find((column) => column.key === key)?.header ?? key;
const TEXT_LIMITS: Partial<Record<ColumnKey, number>> = { productCode: 100, productName: 200, unit: 50, description: 2000, moduleSize: 100, notes: 2000, variantCode: 100, variantName: 200, tier: 100, finish: 100 };

function parseYesNo(text: string): boolean | null {
  const value = text.trim().toLowerCase();
  if (["yes", "y", "true", "1", "active"].includes(value)) return true;
  if (["no", "n", "false", "0", "inactive"].includes(value)) return false;
  return null;
}

/** A rupee amount: "1,180", "₹1180.50", 1180. At most two decimals, never negative. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[₹\s,]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value <= 1e9 ? value : null;
}

export function checkRow(raw: RawRow, context: SheetContext): { parsed: ParsedRow | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const bad = (key: ColumnKey, message: string) => issues.push({ row: raw.row, column: header(key), message, ...(raw.cells.productCode ? { productCode: raw.cells.productCode } : {}) });
  const text = (key: ColumnKey): string | undefined => {
    const value = raw.cells[key];
    if (value === undefined) return undefined;
    const limit = TEXT_LIMITS[key];
    if (limit && value.length > limit) {
      bad(key, `Too long: at most ${limit} characters.`);
      return undefined;
    }
    return value;
  };

  const productCode = text("productCode");
  const variantCode = text("variantCode");
  if (!productCode) bad("productCode", "Product Code is required.");
  if (!variantCode) bad("variantCode", "Variant Code is required.");
  else if (!/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/.test(variantCode)) bad("variantCode", "Use letters, numbers and . _ - / only.");

  const parsed: ParsedRow = { row: raw.row, productCode: productCode ?? "", variantCode: variantCode ?? "" };
  const productName = text("productName");
  if (productName !== undefined) parsed.productName = productName;
  for (const key of ["unit", "description", "moduleSize", "notes", "variantName", "tier", "finish"] as const) {
    const value = text(key);
    if (value !== undefined) (parsed as unknown as Record<string, unknown>)[key] = value;
  }

  const categoryText = raw.cells.category;
  if (categoryText !== undefined) {
    const matches = context.categories.filter((category) => category.name.trim().toLowerCase() === categoryText.trim().toLowerCase());
    if (matches.length === 0) bad("category", `There is no category called "${categoryText}".`);
    else if (matches.length > 1) bad("category", `More than one category is called "${categoryText}". Rename one so it can be told apart.`);
    else if (!matches[0].isActive) bad("category", `The category "${categoryText}" is inactive.`);
    else parsed.categoryId = matches[0].id;
  }

  if (raw.cells.type !== undefined) {
    const type = PRODUCT_TYPES.find((candidate) => candidate === raw.cells.type?.trim().toLowerCase().replace(/[\s-]+/g, "_"));
    if (type) parsed.type = type;
    else bad("type", `Type must be one of: ${PRODUCT_TYPES.join(", ")}.`);
  }

  if (raw.cells.hsnCode !== undefined) {
    if (context.hsnCodes.includes(raw.cells.hsnCode)) parsed.hsnCode = raw.cells.hsnCode;
    else bad("hsnCode", `"${raw.cells.hsnCode}" is not in your HSN/SAC list (GST & HSN/SAC page).`);
  }
  if (raw.cells.gstRate !== undefined) {
    const rate = Number(raw.cells.gstRate.replace(/%/g, "").trim());
    if (Number.isFinite(rate) && context.gstRates.includes(rate)) parsed.gstRate = rate;
    else bad("gstRate", `GST % must be one of your allowed rates: ${context.gstRates.join(", ")}.`);
  }
  for (const key of ["productActive", "variantActive"] as const) {
    if (raw.cells[key] !== undefined) {
      const value = parseYesNo(raw.cells[key] as string);
      if (value === null) bad(key, "Use Yes or No.");
      else parsed[key] = value;
    }
  }
  for (const key of ["price", "cost"] as const) {
    if (raw.cells[key] !== undefined) {
      const value = parseMoney(raw.cells[key] as string);
      if (value === null) bad(key, "Enter an amount in rupees with at most two decimals, e.g. 1180 or 1180.50.");
      else parsed[key] = value;
    }
  }
  return { parsed: issues.length === 0 ? parsed : null, issues };
}

// ── grouping rows into products ──────────────────────────────────────────────────────────────────────────────────

export interface ProductGroup {
  /** The product's code as first written (matching is case-insensitive). */
  code: string;
  rows: ParsedRow[];
}

const PRODUCT_FIELDS = ["productName", "categoryId", "type", "unit", "description", "moduleSize", "notes", "hsnCode", "gstRate", "productActive"] as const;

/**
 * Groups the rows by product code and merges the product-level columns. A product-level value given on several rows must be
 * the same on all of them. A variant code listed twice in one product is an error on the second row.
 */
export function groupRows(rows: ReadonlyArray<ParsedRow>): { groups: ProductGroup[]; product: Map<string, Partial<ParsedRow>>; issues: RowIssue[]; failed: Set<string> } {
  const groups = new Map<string, ProductGroup>();
  const product = new Map<string, Partial<ParsedRow>>();
  const firstSeen = new Map<string, Map<string, number>>();
  const issues: RowIssue[] = [];
  const failed = new Set<string>();
  for (const row of rows) {
    const key = row.productCode.toLowerCase();
    const group = groups.get(key) ?? { code: row.productCode, rows: [] };
    groups.set(key, group);
    const merged = product.get(key) ?? {};
    product.set(key, merged);
    const variants = firstSeen.get(key) ?? new Map<string, number>();
    firstSeen.set(key, variants);

    const variantKey = row.variantCode.toLowerCase();
    if (variants.has(variantKey)) {
      issues.push({ row: row.row, column: header("variantCode"), message: `Variant "${row.variantCode}" is already listed for this product in row ${variants.get(variantKey)}.` });
      failed.add(key);
      continue;
    }
    variants.set(variantKey, row.row);

    for (const field of PRODUCT_FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      const known = (merged as Record<string, unknown>)[field];
      if (known !== undefined && known !== value) {
        issues.push({ row: row.row, column: header(field === "categoryId" ? "category" : (field as ColumnKey)), message: `Differs from another row of product ${row.productCode}. A product's own details must be the same on every row.` });
        failed.add(key);
      } else (merged as Record<string, unknown>)[field] = value;
    }
    group.rows.push(row);
  }
  return { groups: [...groups.values()], product, issues, failed };
}

// ── what an import would do ──────────────────────────────────────────────────────────────────────────────────────

export interface ExistingVariant {
  id: number;
  variantCode: string;
  name: string | null;
  price: number | null;
  cost: number | null;
  taxPercent: number | null;
  isActive: boolean;
  tier: string | null;
  finish: string | null;
}

export interface ExistingProduct {
  id: number;
  code: string;
  name: string;
  categoryId: number | null;
  type: string;
  unit: string;
  description: string | null;
  moduleSize: string | null;
  notes: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  isActive: boolean;
  variants: ExistingVariant[];
}

export interface VariantPlan {
  row: number;
  variantCode: string;
  action: "create" | "update" | "unchanged";
  /** Set when the variant exists. */
  variantId?: number;
  /** What changes, in words, for the preview. */
  changes: string[];
  /** Fields to write on an existing variant. */
  set?: { name?: string; cost?: number; isActive?: boolean };
  /** The GST-inclusive price and its split when the price (or the GST rate) changes. */
  price?: { before: number | null; after: number; priceWithoutTax: number | null; taxPercent: number };
  /** For a new variant. */
  create?: { name: string; tier: string | null; finish: string | null; cost: number; isActive: boolean };
}

export interface ProductPlan {
  code: string;
  action: "create" | "update" | "unchanged";
  productId?: number;
  name: string;
  /** Fields to write on an existing product. */
  set: Record<string, unknown>;
  /** For a new product. */
  create?: { name: string; categoryId: number; type: string; unit: string; description: string | null; moduleSize: string | null; notes: string | null; hsnCode: string | null; gstRate: number | null; isActive: boolean };
  /** True when the product's GST rate changes: its variants are re-split first (prices unchanged). */
  gstRateChanges: boolean;
  variants: VariantPlan[];
}

export interface ImportPlan {
  products: ProductPlan[];
  issues: RowIssue[];
  /** Product codes whose rows could not be applied (every row of a product is applied or none is). */
  failedProducts: string[];
  summary: { rows: number; productsToCreate: number; productsToUpdate: number; variantsToCreate: number; variantsToUpdate: number; unchanged: number; priceChanges: number; errors: number };
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Works out what importing these rows would do to the catalogue as it is now. Pure. Every row of a product is applied
 * together or not at all: one bad row leaves that whole product (and only that product) untouched.
 */
export function planImport(rows: ReadonlyArray<ParsedRow>, existing: ReadonlyArray<ExistingProduct>, context: SheetContext, rowIssues: ReadonlyArray<RowIssue> = [], totalRows: number = rows.length): ImportPlan {
  const { groups, product: merged, issues: groupIssues, failed } = groupRows(rows);
  // A row that could not be read holds back every row of its product.
  const heldBack = new Set<string>();
  for (const issue of rowIssues) if (issue.productCode) heldBack.add(issue.productCode.toLowerCase());
  for (const code of heldBack) failed.add(code);
  const issues: RowIssue[] = [...rowIssues, ...groupIssues];
  const byCode = new Map(existing.map((p) => [p.code.trim().toLowerCase(), p]));
  const categoryById = new Map(context.categories.map((c) => [c.id, c]));
  const plans: ProductPlan[] = [];

  for (const group of groups) {
    const key = group.code.toLowerCase();
    const found = byCode.get(key);
    const fields = merged.get(key) ?? {};
    const groupIssueStart = issues.length;
    const fail = (row: number, column: string, message: string) => issues.push({ row, column, message });
    const firstRow = group.rows[0]?.row ?? 0;

    const categoryId = fields.categoryId ?? found?.categoryId ?? undefined;
    const category = categoryId !== undefined ? categoryById.get(categoryId) : undefined;

    // product
    const plan: ProductPlan = { code: group.code, action: "unchanged", name: fields.productName ?? found?.name ?? group.code, set: {}, gstRateChanges: false, variants: [] };
    const gstRate: number | null = fields.gstRate ?? found?.gstRate ?? null;
    if (found) {
      plan.productId = found.id;
      const pairs: Array<[string, unknown, unknown]> = [
        ["name", fields.productName, found.name], ["categoryId", fields.categoryId, found.categoryId], ["type", fields.type, found.type], ["unit", fields.unit, found.unit],
        ["description", fields.description, found.description], ["moduleSize", fields.moduleSize, found.moduleSize], ["notes", fields.notes, found.notes],
        ["hsnCode", fields.hsnCode, found.hsnCode], ["gstRate", fields.gstRate, found.gstRate], ["isActive", fields.productActive, found.isActive],
      ];
      for (const [field, next, current] of pairs) if (next !== undefined && !same(next, current)) plan.set[field] = next;
      if (plan.set.categoryId !== undefined && category?.hasMatrix) fail(firstRow, "Category", "Moving a product to a category with tiers and finishes is done in the catalogue, not by import.");
      plan.gstRateChanges = plan.set.gstRate !== undefined;
      if (Object.keys(plan.set).length > 0) plan.action = "update";
    } else {
      if (!fields.productName) fail(firstRow, "Product Name", "A new product needs a Product Name.");
      if (categoryId === undefined) fail(firstRow, "Category", "A new product needs a Category.");
      else if (category?.hasMatrix) fail(firstRow, "Category", `"${category.name}" has tier / finish combinations, so its products are created in the catalogue first. Import can then update their prices and details.`);
      plan.action = "create";
      if (fields.productName && categoryId !== undefined) {
        plan.create = { name: fields.productName, categoryId, type: fields.type ?? "other", unit: fields.unit ?? "pcs", description: fields.description ?? null, moduleSize: fields.moduleSize ?? null, notes: fields.notes ?? null, hsnCode: fields.hsnCode ?? null, gstRate, isActive: fields.productActive ?? true };
      }
    }

    // variants
    const existingVariants = new Map((found?.variants ?? []).map((v) => [v.variantCode.trim().toLowerCase(), v]));
    for (const row of group.rows) {
      const variant = existingVariants.get(row.variantCode.toLowerCase());
      const changes: string[] = [];
      const variantPlan: VariantPlan = { row: row.row, variantCode: row.variantCode, action: "unchanged", changes };
      if (variant) {
        variantPlan.variantId = variant.id;
        const set: NonNullable<VariantPlan["set"]> = {};
        if (row.variantName !== undefined && !same(row.variantName, variant.name)) { set.name = row.variantName; changes.push(`name “${variant.name ?? ""}” → “${row.variantName}”`); }
        if (row.cost !== undefined && !same(row.cost, variant.cost)) { set.cost = row.cost; changes.push(`cost ${variant.cost ?? 0} → ${row.cost}`); }
        if (row.variantActive !== undefined && row.variantActive !== variant.isActive) { set.isActive = row.variantActive; changes.push(row.variantActive ? "activated" : "deactivated"); }
        if ((row.tier !== undefined && !same(row.tier, variant.tier)) || (row.finish !== undefined && !same(row.finish, variant.finish))) {
          fail(row.row, row.tier !== undefined && !same(row.tier, variant.tier) ? "Automation Tier" : "Surface Finish", "The tier and finish of an existing variant cannot be changed by import (they belong to the category's combinations).");
        }
        // price, or the price split by a new GST rate
        const rate = gstRate ?? variant.taxPercent ?? null;
        const priceChanges = row.price !== undefined && !same(row.price, variant.price);
        if (priceChanges || plan.gstRateChanges) {
          const after = row.price ?? variant.price;
          if (after === null || rate === null) fail(row.row, "Price (incl. GST)", "This variant has no readable price: enter one.");
          else {
            const split = gstSplitKeepingPrice(after, rate);
            if (!split) fail(row.row, plan.gstRateChanges && !priceChanges ? "GST %" : "Price (incl. GST)", `The price ${after} cannot be kept exactly at ${rate}% GST.`);
            else {
              variantPlan.price = { before: variant.price, after, priceWithoutTax: split.priceWithoutTax, taxPercent: rate };
              if (priceChanges) changes.push(`price ${variant.price ?? "—"} → ${after}`);
            }
          }
        }
        if (Object.keys(set).length > 0) variantPlan.set = set;
        if (changes.length > 0 || variantPlan.price) variantPlan.action = "update";
      } else {
        // a new variant
        if (found && category?.hasMatrix) fail(row.row, "Variant Code", "A new variant of a product in a category with tiers and finishes is added in Edit Variants.");
        if (row.price === undefined) fail(row.row, "Price (incl. GST)", "A new variant needs a price.");
        if (row.tier !== undefined || row.finish !== undefined) fail(row.row, row.tier !== undefined ? "Automation Tier" : "Surface Finish", "Tier and finish only apply to categories with tier / finish combinations; leave them blank here.");
        const rate = gstRate ?? context.defaultGstRate ?? 18;
        const split = row.price !== undefined ? gstSplitKeepingPrice(row.price, rate) : null;
        if (row.price !== undefined && !split) fail(row.row, "Price (incl. GST)", `The price ${row.price} cannot be kept exactly at ${rate}% GST.`);
        const taxPercent = rate;
        variantPlan.action = "create";
        variantPlan.create = { name: row.variantName ?? "Standard", tier: row.tier ?? null, finish: row.finish ?? null, cost: row.cost ?? 0, isActive: row.variantActive ?? true };
        if (row.price !== undefined) variantPlan.price = { before: null, after: row.price, priceWithoutTax: split ? split.priceWithoutTax : null, taxPercent };
        changes.push("new variant");
      }
      plan.variants.push(variantPlan);
    }
    if (plan.action === "unchanged" && plan.variants.some((v) => v.action !== "unchanged")) plan.action = "update";
    if (issues.length > groupIssueStart) failed.add(key);
    plans.push(plan);
  }

  const failedProducts = [...new Set([...plans.filter((plan) => failed.has(plan.code.toLowerCase())).map((plan) => plan.code), ...rowIssues.flatMap((issue) => (issue.productCode ? [issue.productCode] : []))])];
  const good = plans.filter((plan) => !failed.has(plan.code.toLowerCase()));
  const variants = good.flatMap((plan) => plan.variants);
  return {
    products: good,
    issues: issues.sort((a, b) => a.row - b.row),
    failedProducts,
    summary: {
      rows: totalRows,
      productsToCreate: good.filter((plan) => plan.action === "create").length,
      productsToUpdate: good.filter((plan) => plan.action === "update" && plan.productId !== undefined).length,
      variantsToCreate: variants.filter((v) => v.action === "create").length,
      variantsToUpdate: variants.filter((v) => v.action === "update").length,
      unchanged: variants.filter((v) => v.action === "unchanged").length,
      priceChanges: variants.filter((v) => v.price && v.price.before !== null && v.price.before !== v.price.after).length,
      errors: issues.length,
    },
  };
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExportVariant {
  variantCode: string;
  name: string | null;
  tier: string | null;
  finish: string | null;
  price: number | null;
  cost: number | null;
  isActive: boolean;
}

export interface ExportProduct {
  code: string | null;
  name: string;
  categoryName: string | null;
  type: string;
  unit: string;
  description: string | null;
  moduleSize: string | null;
  notes: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  isActive: boolean;
  variants: ExportVariant[];
}

/** The sheet as a table: the header row, then one row per variant. `includeCost` is false for people who may not see costs. */
export function exportTable(products: ReadonlyArray<ExportProduct>, options: { includeCost: boolean }): Array<Array<string | number | boolean | null>> {
  const columns = COLUMNS.filter((column) => options.includeCost || column.key !== "cost");
  const rows: Array<Array<string | number | boolean | null>> = [columns.map((column) => column.header)];
  const yesNo = (value: boolean) => (value ? "Yes" : "No");
  for (const product of products) {
    for (const variant of product.variants) {
      const values: Record<ColumnKey, string | number | null> = {
        productCode: product.code, productName: product.name, category: product.categoryName, type: product.type, unit: product.unit, description: product.description,
        moduleSize: product.moduleSize, notes: product.notes, hsnCode: product.hsnCode, gstRate: product.gstRate, productActive: yesNo(product.isActive),
        variantCode: variant.variantCode, variantName: variant.name, tier: variant.tier, finish: variant.finish, price: variant.price, cost: variant.cost, variantActive: yesNo(variant.isActive),
      };
      rows.push(columns.map((column) => values[column.key]));
    }
  }
  return rows;
}
