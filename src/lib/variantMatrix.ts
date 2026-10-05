import mongoose from "mongoose";
import { Category, Product, ProductVariant, ProductVariantHistory } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { ApiError } from "@/lib/api-response";
import { getCategoryVariantMatrix } from "@/lib/categoryConfig";
import {
  NO_MATRIX_CATEGORY_MESSAGE,
  buildVariantDisplayName,
  buildVariantMatrixSnapshot,
  resolveVariantCombination,
  type VariantMatrixSnapshot,
} from "@/lib/productVariantService";
import { syncProductPriceFromVariants } from "@/lib/variantDeletion";

/**
 * Server-side support for the "Edit Variants" matrix screen.
 *
 * The category's configured matrix is the single source of truth for which
 * combinations a Product MAY have. A Product's current membership is derived
 * from two sources only:
 *
 *   1. live ProductVariant rows                       -> ACTIVE
 *   2. ProductVariantHistory rows (hard-delete audit) -> REMOVED
 *
 * Anything else in the matrix is NOT ADDED. Missing variants are never
 * recreated automatically: the caller has to explicitly Add or Restore one.
 *
 * All three operations below allocate a BRAND NEW numeric `_id` for the created
 * ProductVariant. The numeric ID architecture (getNextSequence) is unchanged and
 * a restored variant deliberately does not reuse its old id, so historical
 * QuotationItems that referenced the old id can never be confused with the new
 * record.
 */

export interface ProductVariantMatrixContext {
  productId: number;
  productName: string;
  productCode: string | null;
  categoryId: number | null;
  categoryName: string | null;
  hasMatrix: boolean;
  snapshot: VariantMatrixSnapshot;
}

/** Loads the product, its category matrix, its live variants and its history. */
export async function loadProductVariantMatrix(
  productId: number
): Promise<ProductVariantMatrixContext> {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
  }

  const category = product.categoryId ? await Category.findById(product.categoryId) : null;

  const [variants, history] = await Promise.all([
    ProductVariant.find({ productId }).sort({ sortOrder: 1, _id: 1 }).lean(),
    ProductVariantHistory.find({ productId })
      .sort({ deletedAt: -1, _id: -1 })
      .lean(),
  ]);

  const snapshot = buildVariantMatrixSnapshot({
    category: category ?? undefined,
    variants: variants as never[],
    history: history as never[],
  });

  return {
    productId: product._id,
    productName: product.name,
    productCode: product.code ?? null,
    categoryId: product.categoryId ?? null,
    categoryName: category?.name ?? null,
    hasMatrix: getCategoryVariantMatrix(category ?? undefined).hasMatrix,
    snapshot,
  };
}

function combinationKeyOf(automationTier: string | null, surfaceFinish: string | null): string {
  return `${automationTier ?? ""}|${surfaceFinish ?? ""}`;
}

/**
 * Throws unless the combination is part of the category's current matrix.
 * The matrix is authoritative, so a combination that was removed from the
 * category configuration can never be added back.
 */
export function assertCombinationAllowed(params: {
  category: { variantTiers?: unknown; variantFinishes?: unknown } | null;
  automationTier: string | null;
  surfaceFinish: string | null;
  field?: string;
}): { displayName: string } {
  const matrix = getCategoryVariantMatrix(params.category ?? undefined);

  if (!matrix.hasMatrix) {
    if (!params.automationTier && !params.surfaceFinish) {
      return { displayName: "Standard" };
    }
    throw new ApiError(
      "VALIDATION_ERROR",
      `This category does not configure automation tiers or surface finishes. Only a generic standard variant is permitted.`,
      {
        field: params.field ?? "automationTier",
      }
    );
  }

  const key = combinationKeyOf(params.automationTier, params.surfaceFinish);
  const match = matrix.combinations.find(
    (combination) =>
      combinationKeyOf(combination.automationTier, combination.surfaceFinish) === key
  );

  if (!match) {
    const allowed = matrix.combinations.map((combination) => combination.displayName).join(" · ");
    throw new ApiError(
      "VALIDATION_ERROR",
      `"${buildVariantDisplayName(params.automationTier, params.surfaceFinish)}" is not a configured combination for this category. Allowed combinations: ${allowed}`,
      { field: params.field ?? "automationTier" }
    );
  }

  return { displayName: match.displayName };
}

/** Throws if a live variant already covers this combination. */
async function assertCombinationNotOccupied(
  productId: number,
  automationTier: string | null,
  surfaceFinish: string | null,
  displayName: string
): Promise<void> {
  const variants = await ProductVariant.find({ productId })
    .select("automationTier surfaceFinish config")
    .lean();

  const key = combinationKeyOf(automationTier, surfaceFinish);
  const clash = variants.some((variant) => {
    const resolved = resolveVariantCombination({
      automationTier: variant.automationTier,
      surfaceFinish: variant.surfaceFinish,
      config: variant.config,
    });
    return combinationKeyOf(resolved.automationTier, resolved.surfaceFinish) === key;
  });

  if (clash) {
    throw new ApiError(
      "DUPLICATE_RECORD",
      `"${displayName}" already exists on this product.`,
      { field: "automationTier" }
    );
  }
}

/** Throws if the code is already used by another live variant of this product. */
async function assertVariantCodeAvailable(
  productId: number,
  variantCode: string
): Promise<void> {
  const owner = await ProductVariant.findOne({
    productId,
    variantCode: { $regex: `^${escapeRegExp(variantCode)}$`, $options: "i" },
  })
    .select("_id")
    .lean();

  if (owner) {
    throw new ApiError(
      "DUPLICATE_RECORD",
      `Variant code '${variantCode}' is already used by another variant of this product.`,
      { field: "variantCode" }
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function nextSortOrder(productId: number): Promise<number> {
  const last = await ProductVariant.findOne({ productId }).sort({ sortOrder: -1, _id: -1 })
    .select("sortOrder")
    .lean();
  const current = Number((last as { sortOrder?: number } | null)?.sortOrder ?? -1);
  return current + 1;
}

import { resolveVariantPricing } from "@/lib/pricing";

export interface AddVariantParams {
  productId: number;
  automationTier: string | null;
  surfaceFinish: string | null;
  variantCode: string;
  name?: string | null;
  price?: number;
  priceWithoutTax?: number;
  taxPercent?: number;
  cost?: number;
  purchaseTaxPercent?: number;
}

/**
 * Adds one valid-but-missing matrix combination to a Product.
 * Never touches any other variant.
 */
export async function addVariantToProduct(params: AddVariantParams) {
  const product = await Product.findById(params.productId);
  if (!product) {
    throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
  }

  const category = product.categoryId ? await Category.findById(product.categoryId) : null;
  if (!category) {
    throw new ApiError("VALIDATION_ERROR", NO_MATRIX_CATEGORY_MESSAGE, {
      field: "automationTier",
    });
  }
  if (!category.isActive) {
    throw new ApiError("CONFLICT", "The selected category is inactive.", {
      field: "automationTier",
    });
  }

  const { displayName } = assertCombinationAllowed({
    category,
    automationTier: params.automationTier,
    surfaceFinish: params.surfaceFinish,
  });

  await assertCombinationNotOccupied(
    params.productId,
    params.automationTier,
    params.surfaceFinish,
    displayName
  );
  await assertVariantCodeAvailable(params.productId, params.variantCode);

  const sortOrder = await nextSortOrder(params.productId);

  const pricing = resolveVariantPricing({
    price: params.price,
    priceWithoutTax: params.priceWithoutTax,
    taxPercent: params.taxPercent,
    cost: params.cost,
    purchaseTaxPercent: params.purchaseTaxPercent,
  });

  const created = await withTransaction(async (dbSession) => {
    const variantId = await getNextSequence("productVariant", ProductVariant, dbSession);
    const doc = new ProductVariant({
      _id: variantId,
      productId: params.productId,
      variantCode: params.variantCode,
      code: params.variantCode, // legacy readers
      name: params.name?.trim() || displayName,
      automationTier: params.automationTier,
      surfaceFinish: params.surfaceFinish,
      config: {
        series: params.automationTier,
        finish: params.surfaceFinish,
        variantCode: params.variantCode,
      },
      price: mongoose.Types.Decimal128.fromString(pricing.price.toFixed(2)),
      priceWithoutTax: mongoose.Types.Decimal128.fromString(pricing.priceWithoutTax.toFixed(2)),
      taxPercent: mongoose.Types.Decimal128.fromString(pricing.taxPercent.toFixed(2)),
      cost: mongoose.Types.Decimal128.fromString(pricing.cost.toFixed(2)),
      purchaseTaxPercent: mongoose.Types.Decimal128.fromString(pricing.purchaseTaxPercent.toFixed(2)),
      sortOrder,
      isActive: true,
    });

    if (dbSession) {
      await doc.save({ session: dbSession });
    } else {
      await doc.save();
    }

    return doc;
  });

  await syncProductPriceFromVariants(params.productId);
  return created;
}

export interface RestoreVariantParams {
  productId: number;
  historyId: number;
  variantCode: string;
  price?: number;
  priceWithoutTax?: number;
  taxPercent?: number;
  cost?: number;
  purchaseTaxPercent?: number;
}

/**
 * Recreates a hard-deleted variant from its ProductVariantHistory row.
 *
 * - the combination ALWAYS comes from the history row, never from the client,
 *   and is re-validated against the current category matrix
 * - the new record gets a brand new numeric `_id`; the old id is never reused
 * - code and price are supplied by the client so the admin can adjust the
 *   prefilled history values before committing
 * - the history row is left intact: the audit trail stays append-only
 */
export async function restoreVariantToProduct(params: RestoreVariantParams) {
  const product = await Product.findById(params.productId);
  if (!product) {
    throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
  }

  const history = await ProductVariantHistory.findOne({
    _id: params.historyId,
    productId: params.productId,
  }).lean();
  if (!history) {
    throw new ApiError(
      "NOT_FOUND",
      "This deleted variant is no longer available to restore.",
      { field: "historyId" }
    );
  }

  const category = product.categoryId ? await Category.findById(product.categoryId) : null;
  const combination = resolveVariantCombination({
    automationTier: history.automationTier,
    surfaceFinish: history.surfaceFinish,
    config: history.config,
  });

  // The matrix is the source of truth: a combination that is no longer
  // configured on the category can never be restored.
  const { displayName } = assertCombinationAllowed({
    category,
    automationTier: combination.automationTier,
    surfaceFinish: combination.surfaceFinish,
    field: "historyId",
  });

  await assertCombinationNotOccupied(
    params.productId,
    combination.automationTier,
    combination.surfaceFinish,
    displayName
  );
  await assertVariantCodeAvailable(params.productId, params.variantCode);

  const sortOrder = await nextSortOrder(params.productId);
  const restoredConfig = {
    ...((history.config as Record<string, unknown> | undefined) ?? {}),
    series: combination.automationTier,
    finish: combination.surfaceFinish,
    variantCode: params.variantCode,
  };

  const historyAny = history as unknown as Record<string, unknown>;
  const pricing = resolveVariantPricing({
    price: params.price ?? (historyAny.price !== undefined ? Number(String(historyAny.price)) : undefined),
    priceWithoutTax: params.priceWithoutTax ?? (historyAny.priceWithoutTax !== undefined ? Number(String(historyAny.priceWithoutTax)) : undefined),
    taxPercent: params.taxPercent ?? (historyAny.taxPercent !== undefined ? Number(String(historyAny.taxPercent)) : undefined),
    cost: params.cost ?? (historyAny.cost !== undefined ? Number(String(historyAny.cost)) : undefined),
    purchaseTaxPercent: params.purchaseTaxPercent ?? (historyAny.purchaseTaxPercent !== undefined ? Number(String(historyAny.purchaseTaxPercent)) : undefined),
  });

  const created = await withTransaction(async (dbSession) => {
    const variantId = await getNextSequence("productVariant", ProductVariant, dbSession);
    const doc = new ProductVariant({
      _id: variantId,
      productId: params.productId,
      variantCode: params.variantCode,
      code: params.variantCode, // legacy readers
      name: displayName,
      automationTier: combination.automationTier,
      surfaceFinish: combination.surfaceFinish,
      config: restoredConfig,
      price: mongoose.Types.Decimal128.fromString(pricing.price.toFixed(2)),
      priceWithoutTax: mongoose.Types.Decimal128.fromString(pricing.priceWithoutTax.toFixed(2)),
      taxPercent: mongoose.Types.Decimal128.fromString(pricing.taxPercent.toFixed(2)),
      cost: mongoose.Types.Decimal128.fromString(pricing.cost.toFixed(2)),
      purchaseTaxPercent: mongoose.Types.Decimal128.fromString(pricing.purchaseTaxPercent.toFixed(2)),
      sortOrder,
      // A restored variant comes back active so it can be used immediately.
      isActive: true,
    });

    if (dbSession) {
      await doc.save({ session: dbSession });
    } else {
      await doc.save();
    }

    return doc;
  });

  await syncProductPriceFromVariants(params.productId);
  return created;
}

