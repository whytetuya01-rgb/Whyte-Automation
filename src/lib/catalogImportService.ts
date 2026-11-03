import { createHash, randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Category, PriceChangeBatch, Product, ProductVariant, VariantPriceChange } from "@/models";
import { ApiError } from "@/lib/api-response";
import { getNextSequence } from "@/lib/counter";
import { getCategoryVariantMatrix } from "@/lib/categoryConfig";
import { parseFinancialNumber } from "@/lib/pricing";
import { applyGstRateToVariants, loadCompanyTaxSettings } from "@/lib/productTax";
import { withRequiredTransaction } from "@/lib/transaction";
import { COLUMNS, checkRow, exportTable, planImport, readTable, type ExistingProduct, type ExportProduct, type ImportPlan, type ParsedRow, type RowIssue, type SheetContext } from "@/lib/catalogSheet";
import { readWorkbook, writeWorkbook } from "@/lib/catalogSheetXlsx";

/**
 * Excel import / export against the database. The preview and the import use the same pure plan; the import re-plans inside its
 * transaction and is refused (409) if the catalogue changed since the preview. Only product and variant rows are written, plus
 * price history; quotations are never read or touched.
 */

const D = (value: number) => mongoose.Types.Decimal128.fromString(value.toFixed(2));
const num = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseFinancialNumber(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

async function loadContext(companyId: number, session?: ClientSession): Promise<SheetContext> {
  const categories = await Category.find({}).select("name isActive variantTiers variantFinishes").session(session ?? null).lean<Array<{ _id: number; name: string; isActive?: boolean; variantTiers?: unknown; variantFinishes?: unknown }>>();
  const settings = await loadCompanyTaxSettings(companyId);
  return {
    categories: categories.map((category) => ({ id: category._id, name: category.name, isActive: category.isActive !== false, hasMatrix: getCategoryVariantMatrix(category).hasMatrix })),
    gstRates: settings.gstRates,
    hsnCodes: settings.hsnCodes.filter((entry) => entry.isActive).map((entry) => entry.code),
    defaultGstRate: settings.defaultGstRate,
  };
}

type RawProduct = { _id: number; code?: string | null; name: string; categoryId?: number | null; type: string; unit?: string | null; description?: string | null; moduleSize?: string | null; notes?: string | null; hsnCode?: string | null; gstRate?: number | null; isActive?: boolean };
type RawVariant = { _id: number; productId: number; variantCode?: string | null; code?: string | null; name?: string | null; price?: unknown; cost?: unknown; taxPercent?: unknown; isActive?: boolean; automationTier?: string | null; surfaceFinish?: string | null; sortOrder?: number };

async function loadExisting(session?: ClientSession): Promise<ExistingProduct[]> {
  const s = session ?? null;
  const products = await Product.find({ code: { $nin: [null, ""] } }).select("code name categoryId type unit description moduleSize notes hsnCode gstRate isActive").session(s).lean<RawProduct[]>();
  const variants = products.length === 0 ? [] : await ProductVariant.find({ productId: { $in: products.map((product) => product._id) } }).select("productId variantCode code name price cost taxPercent isActive automationTier surfaceFinish sortOrder").sort({ sortOrder: 1, _id: 1 }).session(s).lean<RawVariant[]>();
  const byProduct = new Map<number, RawVariant[]>();
  for (const variant of variants) byProduct.set(variant.productId, [...(byProduct.get(variant.productId) ?? []), variant]);
  return products.map((product) => ({
    id: product._id, code: String(product.code), name: product.name, categoryId: product.categoryId ?? null, type: product.type, unit: product.unit ?? "pcs",
    description: product.description ?? null, moduleSize: product.moduleSize ?? null, notes: product.notes ?? null, hsnCode: product.hsnCode ?? null, gstRate: product.gstRate ?? null, isActive: product.isActive !== false,
    variants: (byProduct.get(product._id) ?? []).map((variant) => ({ id: variant._id, variantCode: String(variant.variantCode ?? variant.code ?? ""), name: variant.name ?? null, price: num(variant.price), cost: num(variant.cost), taxPercent: num(variant.taxPercent), isActive: variant.isActive !== false, tier: variant.automationTier ?? null, finish: variant.surfaceFinish ?? null })),
  }));
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function exportCatalogue(includeCost: boolean): Promise<Buffer> {
  await connectMongoDB();
  const [products, categories] = await Promise.all([
    Product.find({}).select("code name categoryId type unit description moduleSize notes hsnCode gstRate isActive").sort({ categoryId: 1, sortOrder: 1, _id: 1 }).lean<RawProduct[]>(),
    Category.find({}).select("name").lean<Array<{ _id: number; name: string }>>(),
  ]);
  const variants = products.length === 0 ? [] : await ProductVariant.find({ productId: { $in: products.map((product) => product._id) } }).select("productId variantCode code name price cost isActive automationTier surfaceFinish sortOrder").sort({ sortOrder: 1, _id: 1 }).lean<RawVariant[]>();
  const names = new Map(categories.map((category) => [category._id, category.name]));
  const byProduct = new Map<number, RawVariant[]>();
  for (const variant of variants) byProduct.set(variant.productId, [...(byProduct.get(variant.productId) ?? []), variant]);
  const rows: ExportProduct[] = products.map((product) => ({
    code: product.code ?? null, name: product.name, categoryName: product.categoryId ? names.get(product.categoryId) ?? null : null, type: product.type, unit: product.unit ?? "pcs",
    description: product.description ?? null, moduleSize: product.moduleSize ?? null, notes: product.notes ?? null, hsnCode: product.hsnCode ?? null, gstRate: product.gstRate ?? null, isActive: product.isActive !== false,
    variants: (byProduct.get(product._id) ?? []).map((variant) => ({ variantCode: String(variant.variantCode ?? variant.code ?? ""), name: variant.name ?? null, tier: variant.automationTier ?? null, finish: variant.surfaceFinish ?? null, price: num(variant.price), cost: num(variant.cost), isActive: variant.isActive !== false })),
  }));
  return writeWorkbook(exportTable(rows, { includeCost }));
}

/** An empty sheet with the right columns, one example row and a help sheet. */
export async function importTemplate(): Promise<Buffer> {
  const header = COLUMNS.map((column) => column.header);
  const example: Record<string, string | number> = { "Product Code": "EX-100", "Product Name": "Example product", Category: "(one of your categories)", Type: "other", Unit: "pcs", "GST %": 18, "Product Active": "Yes", "Variant Code": "EX-100-A", "Variant Name": "Standard", "Price (incl. GST)": 1180, Cost: 900, "Variant Active": "Yes" };
  return writeWorkbook([header, header.map((name) => example[name] ?? "")], { withHelp: true });
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const PREVIEW_ROWS = 300;
export const MAX_ISSUES_SHOWN = 500;

export interface PreviewRowView {
  row: number;
  productCode: string;
  productName: string;
  variantCode: string;
  action: "create" | "update" | "unchanged";
  productAction: "create" | "update" | "unchanged";
  changes: string[];
}

export interface ImportPreview {
  fileErrors: string[];
  ignoredColumns: string[];
  planHash: string | null;
  summary: ImportPlan["summary"];
  rows: PreviewRowView[];
  truncatedRows: boolean;
  issues: RowIssue[];
  truncatedIssues: boolean;
  failedProducts: string[];
  /** Whether there is anything to apply. */
  canApply: boolean;
}

const emptySummary = (): ImportPlan["summary"] => ({ rows: 0, productsToCreate: 0, productsToUpdate: 0, variantsToCreate: 0, variantsToUpdate: 0, unchanged: 0, priceChanges: 0, errors: 0 });

function hashPlan(plan: ImportPlan): string {
  const essential = plan.products.map((product) => ({ code: product.code, action: product.action, id: product.productId, set: product.set, create: product.create, g: product.gstRateChanges, v: product.variants.map((v) => ({ c: v.variantCode, a: v.action, id: v.variantId, set: v.set, p: v.price, cr: v.create })) }));
  return createHash("sha256").update(JSON.stringify(essential)).digest("hex");
}

async function planFromFile(buffer: Buffer, companyId: number, session?: ClientSession): Promise<{ plan: ImportPlan | null; fileErrors: string[]; ignoredColumns: string[] }> {
  const table = await readWorkbook(buffer);
  const read = readTable(table);
  if (read.fileErrors.length > 0) return { plan: null, fileErrors: read.fileErrors, ignoredColumns: read.ignoredColumns };
  const context = await loadContext(companyId, session);
  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  for (const raw of read.rows) {
    const result = checkRow(raw, context);
    if (result.parsed) rows.push(result.parsed);
    issues.push(...result.issues);
  }
  return { plan: planImport(rows, await loadExisting(session), context, issues, read.rows.length), fileErrors: [], ignoredColumns: read.ignoredColumns };
}

export async function previewImport(buffer: Buffer, companyId: number): Promise<ImportPreview> {
  await connectMongoDB();
  const { plan, fileErrors, ignoredColumns } = await planFromFile(buffer, companyId);
  if (!plan) return { fileErrors, ignoredColumns, planHash: null, summary: emptySummary(), rows: [], truncatedRows: false, issues: [], truncatedIssues: false, failedProducts: [], canApply: false };
  const rows: PreviewRowView[] = plan.products.flatMap((product) => product.variants.map((variant) => ({ row: variant.row, productCode: product.code, productName: product.create?.name ?? product.name, variantCode: variant.variantCode, action: variant.action, productAction: product.action, changes: [...(product.action === "update" && variant === product.variants[0] ? Object.keys(product.set).map((field) => `product ${field}`) : []), ...variant.changes] })));
  rows.sort((a, b) => a.row - b.row);
  const interesting = [...rows.filter((row) => row.action !== "unchanged"), ...rows.filter((row) => row.action === "unchanged")];
  return {
    fileErrors, ignoredColumns,
    planHash: hashPlan(plan),
    summary: plan.summary,
    rows: interesting.slice(0, PREVIEW_ROWS),
    truncatedRows: interesting.length > PREVIEW_ROWS,
    issues: plan.issues.slice(0, MAX_ISSUES_SHOWN),
    truncatedIssues: plan.issues.length > MAX_ISSUES_SHOWN,
    failedProducts: plan.failedProducts,
    canApply: plan.products.some((product) => product.action !== "unchanged" || product.variants.some((variant) => variant.action !== "unchanged")),
  };
}

// ── apply ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  priceChanges: number;
  skippedProducts: string[];
  batchId: string | null;
}

export async function applyImport(input: { buffer: Buffer; planHash: string; actorId: number; companyId: number; actorName: string | null }): Promise<ImportResult> {
  await connectMongoDB();
  return withRequiredTransaction(async (session) => {
    const { plan } = await planFromFile(input.buffer, input.companyId, session);
    if (!plan) throw new ApiError("VALIDATION_ERROR", "That file cannot be imported.", { field: "file" });
    if (hashPlan(plan) !== input.planHash) throw new ApiError("CONFLICT", "The catalogue or the file changed since the preview. Preview again to see what would change now.", { field: "planHash" });

    const now = new Date();
    const result: ImportResult = { productsCreated: 0, productsUpdated: 0, variantsCreated: 0, variantsUpdated: 0, priceChanges: 0, skippedProducts: plan.failedProducts, batchId: null };
    const opts = session ? { session } : {};
    const history: Array<{ variantId: number; productId: number; productName: string; variantCode: string; variantName: string | null; before: { price: number; priceWithoutTax: number | null; taxPercent: number }; after: { price: number; priceWithoutTax: number | null; taxPercent: number } }> = [];
    const existingByCode = new Map((await loadExisting(session)).map((product) => [product.code.toLowerCase(), product]));

    for (const product of plan.products) {
      if (product.action === "unchanged" && product.variants.every((variant) => variant.action === "unchanged")) continue;
      let productId = product.productId;

      if (product.action === "create" && product.create) {
        productId = await getNextSequence("product", Product, session);
        await Product.create(
          [{ _id: productId, name: product.create.name, code: product.code, description: product.create.description, type: product.create.type, categoryId: product.create.categoryId, automationTier: null, surfaceFinish: null, unit: product.create.unit, moduleSize: product.create.moduleSize, notes: product.create.notes, sortOrder: 0, isActive: product.create.isActive, isMatrix: false, matrixDimensions: null, hsnCode: product.create.hsnCode, gstRate: product.create.gstRate, createdAt: now, updatedAt: now }] as never,
          opts
        );
        result.productsCreated += 1;
      } else if (productId !== undefined && product.action === "update") {
        // "Updated" = the product itself or any of its variants changed (the same meaning as in the preview).
        if (product.gstRateChanges && typeof product.set.gstRate === "number") await applyGstRateToVariants([productId], product.set.gstRate, session);
        if (Object.keys(product.set).length > 0) await Product.updateOne({ _id: productId }, { $set: { ...product.set, updatedAt: now } }, opts);
        result.productsUpdated += 1;
      }
      if (productId === undefined) continue;
      const existing = existingByCode.get(product.code.toLowerCase());
      const existingVariants = new Map((existing?.variants ?? []).map((variant) => [variant.id, variant]));
      const nextSort = (existing?.variants.length ?? 0);
      let created = 0;

      for (const variant of product.variants) {
        if (variant.action === "create" && variant.create) {
          const id = await getNextSequence("productVariant", ProductVariant, session);
          const price = variant.price;
          await ProductVariant.create(
            [{
              _id: id, productId, variantCode: variant.variantCode, code: variant.variantCode, name: variant.create.name, automationTier: null, surfaceFinish: null,
              config: { series: null, finish: null, variantCode: variant.variantCode },
              price: D(price?.after ?? 0), priceWithoutTax: price?.priceWithoutTax == null ? null : D(price.priceWithoutTax), taxPercent: D(price?.taxPercent ?? 18),
              cost: D(variant.create.cost), purchaseTaxPercent: D(18), sortOrder: nextSort + created, isActive: variant.create.isActive, createdAt: now, updatedAt: now,
            }] as never,
            opts
          );
          created += 1;
          result.variantsCreated += 1;
        } else if (variant.action === "update" && variant.variantId !== undefined) {
          const set: Record<string, unknown> = { updatedAt: now };
          if (variant.set?.name !== undefined) set.name = variant.set.name;
          if (variant.set?.cost !== undefined) set.cost = D(variant.set.cost);
          if (variant.set?.isActive !== undefined) set.isActive = variant.set.isActive;
          if (variant.price) {
            set.price = D(variant.price.after);
            set.priceWithoutTax = variant.price.priceWithoutTax === null ? null : D(variant.price.priceWithoutTax);
            set.taxPercent = D(variant.price.taxPercent);
          }
          await ProductVariant.updateOne({ _id: variant.variantId }, { $set: set }, opts);
          result.variantsUpdated += 1;
          const before = existingVariants.get(variant.variantId);
          if (variant.price && before && before.price !== null && before.price !== variant.price.after) {
            history.push({ variantId: variant.variantId, productId, productName: existing?.name ?? product.name, variantCode: variant.variantCode, variantName: before.name, before: { price: before.price, priceWithoutTax: null, taxPercent: before.taxPercent ?? variant.price.taxPercent }, after: { price: variant.price.after, priceWithoutTax: variant.price.priceWithoutTax, taxPercent: variant.price.taxPercent } });
          }
        }
      }
    }

    if (history.length > 0) {
      const batchId = `pb_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
      await PriceChangeBatch.create(
        [{ _id: batchId, companyId: input.companyId, kind: "import", revertsBatchId: null, rule: null, scopeLabel: "Excel import", scope: { all: false, categoryIds: [], productIds: [...new Set(history.map((h) => h.productId))] }, note: null, variantsChanged: history.length, variantsSkipped: 0, createdBy: input.actorId, createdByName: input.actorName, createdAt: now }],
        opts
      );
      const rows = history.map((h) => ({ _id: `vpc_${batchId}_${h.variantId}`, companyId: input.companyId, batchId, ...h, createdAt: now }));
      for (let i = 0; i < rows.length; i += 500) await VariantPriceChange.insertMany(rows.slice(i, i + 500), opts);
      result.batchId = batchId;
      result.priceChanges = history.length;
    }
    return result;
  });
}
