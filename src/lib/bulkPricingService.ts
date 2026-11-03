import { createHash, randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Category, PriceChangeBatch, Product, ProductVariant, VariantPriceChange, type IPriceChangeBatch, type IVariantPriceChange } from "@/models";
import { ApiError } from "@/lib/api-response";
import { withRequiredTransaction } from "@/lib/transaction";
import { parseFinancialNumber } from "@/lib/pricing";
import { planBulkPrice, ruleProblem, snapshotOf, type BulkPriceRule, type PlannedChange, type SkipReason } from "@/lib/bulkPricing";

/**
 * Bulk price changes against the database. Only `ProductVariant` prices are written (plus history); quotations hold their own
 * snapshot of every price and are never read or touched. The preview and the change use the same pure planner, and the change
 * is refused (409) if any price moved since the preview, so what is applied is exactly what was shown.
 */

export interface BulkScope {
  all?: boolean;
  categoryIds?: number[];
  productIds?: number[];
}

export const PREVIEW_ROW_LIMIT = 300;
const WRITE_CHUNK = 500;

const D = (value: number) => mongoose.Types.Decimal128.fromString(value.toFixed(2));
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

interface Loaded {
  rows: Array<{ id: number; productId: number; price: unknown; priceWithoutTax: unknown; taxPercent: unknown; variantCode: string | null; variantName: string | null }>;
  productNames: Map<number, string>;
  label: string;
}

async function loadScope(scope: BulkScope, session?: ClientSession): Promise<Loaded> {
  const s = session ?? null;
  const categories = await Category.find({}).select("name parentId").session(s).lean<Array<{ _id: number; name: string; parentId: number | null }>>();
  const wantedCategories = new Set(scope.categoryIds ?? []);
  // A category brings its sub-categories with it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (!wantedCategories.has(category._id) && category.parentId !== null && wantedCategories.has(category.parentId)) {
        wantedCategories.add(category._id);
        grew = true;
      }
    }
  }
  const productFilter = scope.all
    ? {}
    : { $or: [...(wantedCategories.size > 0 ? [{ categoryId: { $in: [...wantedCategories] } }] : []), ...((scope.productIds?.length ?? 0) > 0 ? [{ _id: { $in: scope.productIds } }] : [])] };
  const products = await Product.find(productFilter).select("name categoryId").session(s).lean<Array<{ _id: number; name: string }>>();
  const productNames = new Map(products.map((product) => [product._id, product.name]));
  const variants = productNames.size === 0
    ? []
    : await ProductVariant.find({ productId: { $in: [...productNames.keys()] } })
        .select("productId variantCode code name price priceWithoutTax taxPercent")
        .sort({ productId: 1, sortOrder: 1, _id: 1 })
        .session(s)
        .lean<Array<{ _id: number; productId: number; variantCode?: string | null; code?: string | null; name?: string | null; price: unknown; priceWithoutTax: unknown; taxPercent: unknown }>>();

  const named = categories.filter((category) => (scope.categoryIds ?? []).includes(category._id)).map((category) => category.name);
  const parts: string[] = [];
  if (scope.all) parts.push("All products");
  else {
    if (named.length > 0) parts.push(`Categories: ${named.join(", ")}`);
    if ((scope.productIds?.length ?? 0) > 0) parts.push(`${scope.productIds?.length} selected product${scope.productIds?.length === 1 ? "" : "s"}`);
  }
  return {
    rows: variants.map((variant) => ({ id: variant._id, productId: variant.productId, price: variant.price, priceWithoutTax: variant.priceWithoutTax, taxPercent: variant.taxPercent, variantCode: variant.variantCode ?? variant.code ?? null, variantName: variant.name ?? null })),
    productNames,
    label: (parts.join(" · ") || "Selected products").slice(0, 300),
  };
}

function checksumOf(loaded: Loaded, rule: BulkPriceRule): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(rule));
  for (const row of [...loaded.rows].sort((a, b) => a.id - b.id)) {
    const snapshot = snapshotOf(row);
    hash.update(`|${row.id}:${snapshot ? `${snapshot.price}/${snapshot.priceWithoutTax}/${snapshot.taxPercent}` : "?"}`);
  }
  return hash.digest("hex");
}

function assertRule(rule: BulkPriceRule): void {
  const problem = ruleProblem(rule);
  if (problem) throw new ApiError("VALIDATION_ERROR", problem, { field: "rule" });
}

export interface PreviewRow {
  variantId: number;
  productId: number;
  productName: string;
  variantCode: string | null;
  variantName: string | null;
  before: number;
  after: number;
  delta: number;
  deltaPercent: number;
}

export interface PreviewResult {
  scopeLabel: string;
  checksum: string;
  summary: { matched: number; changes: number; products: number; skipped: Record<SkipReason, number>; totalBefore: number; totalAfter: number };
  rows: PreviewRow[];
  truncated: boolean;
}

const emptySkips = (): Record<SkipReason, number> => ({ unreadable_price: 0, negative_result: 0, unchanged: 0, cannot_keep_price: 0 });
const money = (value: number) => Math.round(value * 100) / 100;

export async function previewBulkPrice(scope: BulkScope, rule: BulkPriceRule): Promise<PreviewResult> {
  assertRule(rule);
  await connectMongoDB();
  const loaded = await loadScope(scope);
  if (loaded.rows.length === 0) throw new ApiError("VALIDATION_ERROR", "That selection contains no products with prices.", { field: "scope" });
  const plan = planBulkPrice(loaded.rows, rule);
  const byId = new Map(loaded.rows.map((row) => [row.id, row]));
  const skipped = emptySkips();
  for (const entry of plan.skipped) skipped[entry.reason] += 1;
  const rows: PreviewRow[] = plan.changes.slice(0, PREVIEW_ROW_LIMIT).map((change) => {
    const row = byId.get(change.id) as Loaded["rows"][number];
    return {
      variantId: change.id,
      productId: row.productId,
      productName: loaded.productNames.get(row.productId) ?? "",
      variantCode: row.variantCode,
      variantName: row.variantName,
      before: change.before.price,
      after: change.after.price,
      delta: change.delta,
      deltaPercent: change.deltaPercent,
    };
  });
  return {
    scopeLabel: loaded.label,
    checksum: checksumOf(loaded, rule),
    summary: {
      matched: loaded.rows.length,
      changes: plan.changes.length,
      products: new Set(plan.changes.map((change) => byId.get(change.id)?.productId)).size,
      skipped,
      totalBefore: money(plan.changes.reduce((sum, change) => sum + change.before.price, 0)),
      totalAfter: money(plan.changes.reduce((sum, change) => sum + change.after.price, 0)),
    },
    rows,
    truncated: plan.changes.length > PREVIEW_ROW_LIMIT,
  };
}

async function nameOf(userId: number): Promise<string | null> {
  const user = await AdminUser.findById(userId).select("name firstName lastName email").lean<{ name?: string; firstName?: string; lastName?: string; email?: string }>();
  return user ? user.name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || null : null;
}

async function writeChanges(changes: PlannedChange[], session: ClientSession | undefined, now: Date): Promise<void> {
  for (let i = 0; i < changes.length; i += WRITE_CHUNK) {
    const writes = changes.slice(i, i + WRITE_CHUNK).map((change) => ({
      updateOne: {
        filter: { _id: change.id },
        update: {
          $set: {
            price: D(change.after.price),
            // An explicit null (not a missing field) keeps the GST-inclusive price exact: see `gstSplitKeepingPrice`.
            priceWithoutTax: change.after.priceWithoutTax === null ? null : D(change.after.priceWithoutTax),
            taxPercent: D(change.after.taxPercent),
            updatedAt: now,
          },
        },
      },
    })) as unknown as Parameters<typeof ProductVariant.bulkWrite>[0];
    await ProductVariant.bulkWrite(writes, session ? { session } : {});
  }
}

export interface ApplyResult {
  batchId: string;
  changed: number;
  skipped: number;
  scopeLabel: string;
}

export async function applyBulkPrice(input: { scope: BulkScope; rule: BulkPriceRule; checksum: string; note: string | null | undefined; actorId: number; companyId: number }): Promise<ApplyResult> {
  assertRule(input.rule);
  await connectMongoDB();
  const createdByName = await nameOf(input.actorId);
  return withRequiredTransaction(async (session) => {
    const loaded = await loadScope(input.scope, session);
    if (checksumOf(loaded, input.rule) !== input.checksum) {
      throw new ApiError("CONFLICT", "Prices changed since the preview. Preview again to see what would change now.", { field: "checksum" });
    }
    const plan = planBulkPrice(loaded.rows, input.rule);
    if (plan.changes.length === 0) throw new ApiError("VALIDATION_ERROR", "No price would change with these settings.", { field: "rule" });

    const now = new Date();
    const batchId = newId("pb");
    const byId = new Map(loaded.rows.map((row) => [row.id, row]));
    await writeChanges(plan.changes, session, now);
    const history = plan.changes.map((change) => {
      const row = byId.get(change.id) as Loaded["rows"][number];
      return {
        _id: `vpc_${batchId}_${change.id}`,
        companyId: input.companyId,
        batchId,
        variantId: change.id,
        productId: row.productId,
        productName: loaded.productNames.get(row.productId) ?? "",
        variantCode: row.variantCode,
        variantName: row.variantName,
        before: change.before,
        after: change.after,
        createdAt: now,
      };
    });
    for (let i = 0; i < history.length; i += WRITE_CHUNK) await VariantPriceChange.insertMany(history.slice(i, i + WRITE_CHUNK), session ? { session } : {});
    await PriceChangeBatch.create(
      [{
        _id: batchId, companyId: input.companyId, kind: "change", revertsBatchId: null, rule: input.rule, scopeLabel: loaded.label,
        scope: { all: input.scope.all === true, categoryIds: input.scope.categoryIds ?? [], productIds: input.scope.productIds ?? [] },
        note: input.note ?? null, variantsChanged: plan.changes.length, variantsSkipped: plan.skipped.length, createdBy: input.actorId, createdByName, createdAt: now,
      }],
      session ? { session } : {}
    );
    return { batchId, changed: plan.changes.length, skipped: plan.skipped.length, scopeLabel: loaded.label };
  });
}

export async function listBatches(limit = 50, skip = 0): Promise<{ batches: IPriceChangeBatch[]; total: number }> {
  await connectMongoDB();
  const [batches, total] = await Promise.all([
    PriceChangeBatch.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean<IPriceChangeBatch[]>(),
    PriceChangeBatch.countDocuments({}),
  ]);
  return { batches, total };
}

export async function batchEntries(batchId: string, page = 1, pageSize = 100): Promise<{ batch: IPriceChangeBatch; entries: IVariantPriceChange[]; total: number }> {
  await connectMongoDB();
  const batch = await PriceChangeBatch.findOne({ _id: batchId }).lean<IPriceChangeBatch>();
  if (!batch) throw new ApiError("NOT_FOUND", "That price change was not found.");
  const [entries, total] = await Promise.all([
    VariantPriceChange.find({ batchId }).sort({ productName: 1, variantId: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean<IVariantPriceChange[]>(),
    VariantPriceChange.countDocuments({ batchId }),
  ]);
  return { batch, entries, total };
}

/** The price history of one product's variants, newest first. */
export async function productPriceHistory(productId: number, limit = 100): Promise<IVariantPriceChange[]> {
  await connectMongoDB();
  return VariantPriceChange.find({ productId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean<IVariantPriceChange[]>();
}

export interface RevertResult {
  batchId: string;
  restored: number;
  skipped: number;
}

/**
 * Undoes a bulk change: every variant whose price is still exactly what the change set goes back to its earlier price.
 * A variant someone has changed since is left alone (and counted). The undo is itself recorded as a batch.
 */
export async function revertBatch(input: { batchId: string; actorId: number; companyId: number }): Promise<RevertResult> {
  await connectMongoDB();
  const createdByName = await nameOf(input.actorId);
  return withRequiredTransaction(async (session) => {
    const s = session ?? null;
    const original = await PriceChangeBatch.findOne({ _id: input.batchId }).session(s).lean<IPriceChangeBatch>();
    if (!original) throw new ApiError("NOT_FOUND", "That price change was not found.");
    if (original.kind === "revert") throw new ApiError("CONFLICT", "An undo cannot itself be undone.");
    if (original.revertedAt) throw new ApiError("CONFLICT", "That price change has already been undone.");

    const entries = await VariantPriceChange.find({ batchId: input.batchId }).session(s).lean<IVariantPriceChange[]>();
    const current = await ProductVariant.find({ _id: { $in: entries.map((entry) => entry.variantId) } }).select("price priceWithoutTax taxPercent").session(s).lean<Array<{ _id: number; price: unknown; priceWithoutTax: unknown; taxPercent: unknown }>>();
    const now = new Map(current.map((variant) => [variant._id, variant]));
    const restorable: PlannedChange[] = [];
    let skipped = 0;
    for (const entry of entries) {
      const variant = now.get(entry.variantId);
      const price = variant ? parseFinancialNumber(variant.price, NaN) : NaN;
      // Only a variant still at exactly the price this change gave it is put back.
      if (!variant || price !== entry.after.price) {
        skipped += 1;
        continue;
      }
      const snapshot = snapshotOf({ id: variant._id, price: variant.price, priceWithoutTax: variant.priceWithoutTax, taxPercent: variant.taxPercent }) ?? entry.after;
      restorable.push({ id: entry.variantId, before: snapshot, after: entry.before, delta: Math.round((entry.before.price - price) * 100) / 100, deltaPercent: 0 });
    }
    if (restorable.length === 0) throw new ApiError("CONFLICT", "None of those prices can be restored: they have all changed since.");

    const at = new Date();
    const batchId = newId("pb");
    await writeChanges(restorable, session, at);
    const byEntry = new Map(entries.map((entry) => [entry.variantId, entry]));
    const history = restorable.map((change) => {
      const entry = byEntry.get(change.id) as IVariantPriceChange;
      return { _id: `vpc_${batchId}_${change.id}`, companyId: input.companyId, batchId, variantId: change.id, productId: entry.productId, productName: entry.productName, variantCode: entry.variantCode, variantName: entry.variantName, before: change.before, after: change.after, createdAt: at };
    });
    for (let i = 0; i < history.length; i += WRITE_CHUNK) await VariantPriceChange.insertMany(history.slice(i, i + WRITE_CHUNK), session ? { session } : {});
    await PriceChangeBatch.create(
      [{ _id: batchId, companyId: input.companyId, kind: "revert", revertsBatchId: input.batchId, rule: null, scopeLabel: `Undo of: ${original.scopeLabel}`.slice(0, 300), scope: original.scope, note: null, variantsChanged: restorable.length, variantsSkipped: skipped, createdBy: input.actorId, createdByName, createdAt: at }],
      session ? { session } : {}
    );
    await PriceChangeBatch.updateOne({ _id: input.batchId }, { $set: { revertedAt: at, revertedByBatchId: batchId } }, session ? { session } : {});
    return { batchId, restored: restorable.length, skipped };
  });
}
