import mongoose from "mongoose";
import { Product, ProductVariant, ProductVariantHistory } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { getVariantDependencies } from "@/lib/dependencies";
import { ApiError } from "@/lib/api-response";
import { MINIMUM_VARIANT_MESSAGE } from "@/lib/productVariantService";

/**
 * Canonical ProductVariant hard-deletion flow.
 *
 * Both DELETE endpoints delegate here so the guarantees can never diverge:
 *   1. authenticate
 *   2. validate the numeric IDs
 *   3. the ProductVariant must exist (404 if it does not)
 *   4. no QuotationItem may reference it (409 DEPENDENCY_EXISTS)
 *   5. the parent Product must keep at least one variant (409 MINIMUM_VARIANT)
 *   6. hard delete + record the ProductVariantHistory snapshot in ONE transaction
 *
 * ProductVariant is always hard deleted. There is no soft-delete flag.
 * The Product and the Edit Variants modal are never touched.
 */

export interface HardDeleteVariantResult {
  variantId: number;
  productId: number;
  productName: string | null;
  variantLabel: string;
  remainingVariants: number;
  historyRecorded: boolean;
}

function buildVariantLabel(variant: {
  automationTier?: string | null;
  surfaceFinish?: string | null;
  variantCode?: string | null;
  config?: unknown;
}): string {
  const config = (variant.config ?? {}) as { series?: string; finish?: string };
  const tier = variant.automationTier || config.series || "";
  const finish = variant.surfaceFinish || config.finish || "";
  const parts: string[] = [];
  if (tier) parts.push(tier.charAt(0).toUpperCase() + tier.slice(1));
  if (finish) parts.push(finish.charAt(0).toUpperCase() + finish.slice(1));
  if (parts.length > 0) return parts.join(" · ");
  return variant.variantCode || "Variant";
}

export async function hardDeleteVariant(params: {
  variantId: number;
  /** When provided, the variant must belong to this product. */
  productId?: number;
  /** Admin email from the session, recorded on the history row when available. */
  deletedBy?: string | null;
}): Promise<HardDeleteVariantResult> {
  const { variantId, productId, deletedBy = null } = params;

  // 1. Existence first — a missing variant is 404, never 400.
  const variant = await ProductVariant.findById(variantId);
  if (!variant) {
    throw new ApiError("NOT_FOUND", "Variant not found.", { field: "variantId" });
  }
  if (productId !== undefined && variant.productId !== productId) {
    throw new ApiError("NOT_FOUND", "Variant not found.", { field: "variantId" });
  }

  const ownerProductId = variant.productId;
  const variantLabel = buildVariantLabel({
    automationTier: variant.automationTier,
    surfaceFinish: variant.surfaceFinish,
    variantCode: variant.variantCode,
    config: variant.config,
  });

  // 2. Dependency check before anything is removed
  const dependencies = await getVariantDependencies(variantId);
  if (dependencies.quotationItems > 0) {
    throw new ApiError(
      "DEPENDENCY_EXISTS",
      `This variant cannot be deleted because it is used in ${dependencies.quotationItems} quotation ${
        dependencies.quotationItems === 1 ? "item" : "items"
      }.`,
      { details: { quotationItemIds: dependencies.quotationItemIds } }
    );
  }

  // 3. A product must always retain at least one variant
  const totalVariants = await ProductVariant.countDocuments({ productId: ownerProductId });
  if (totalVariants <= 1) {
    throw new ApiError("MINIMUM_VARIANT", MINIMUM_VARIANT_MESSAGE, { field: "variantId" });
  }

  const product = await Product.findById(ownerProductId).select("name code");

  // 4. Hard delete + history snapshot in a single transaction. The dependency
  //    and minimum-variant guards are re-evaluated INSIDE the transaction so two
  //    concurrent deletes of the last two variants cannot both succeed.
  const result = await withTransaction(async (dbSession) => {
    const live = await ProductVariant.findById(variantId).session(dbSession ?? null);
    if (!live) {
      throw new ApiError("NOT_FOUND", "Variant not found.", { field: "variantId" });
    }
    if (productId !== undefined && live.productId !== productId) {
      throw new ApiError("NOT_FOUND", "Variant not found.", { field: "variantId" });
    }

    const liveDependencies = await getVariantDependencies(variantId, dbSession);
    if (liveDependencies.quotationItems > 0) {
      throw new ApiError(
        "DEPENDENCY_EXISTS",
        `This variant cannot be deleted because it is used in ${liveDependencies.quotationItems} quotation ${
          liveDependencies.quotationItems === 1 ? "item" : "items"
        }.`,
        { details: { quotationItemIds: liveDependencies.quotationItemIds } }
      );
    }

    const liveVariantCount = await ProductVariant.countDocuments({ productId: ownerProductId })
      .session(dbSession ?? null)
      .exec();
    if (liveVariantCount <= 1) {
      throw new ApiError("MINIMUM_VARIANT", MINIMUM_VARIANT_MESSAGE, { field: "variantId" });
    }

    let historyRecorded = false;
    try {
      const historyId = await getNextSequence(
        "productVariantHistory",
        ProductVariantHistory,
        dbSession
      );

      const historyDoc = new ProductVariantHistory({
        _id: historyId,
        variantId: live._id,
        productId: ownerProductId,
        productCode: product?.code ?? null,
        variantCode: live.variantCode ?? null,
        name: live.name ?? null,
        code: live.code ?? null,
        automationTier: live.automationTier ?? null,
        surfaceFinish: live.surfaceFinish ?? null,
        config: live.config ?? {},
        price: live.price ?? null,
        isActive: live.isActive ?? true,
        sortOrder: live.sortOrder ?? 0,
        reason: "hard_delete",
        deletedBy,
        deletedAt: new Date(),
      });

      if (dbSession) {
        await historyDoc.save({ session: dbSession });
      } else {
        await historyDoc.save();
      }
      historyRecorded = true;
    } catch (historyError) {
      // Inside a transaction a failed write has already aborted the transaction,
      // so the delete below cannot commit anyway — rethrow the original failure
      // instead of masking it. On a standalone MongoDB (no session) history is
      // best-effort bookkeeping and must never block a valid hard delete.
      if (dbSession) throw historyError;
      console.error("Failed to record ProductVariantHistory row:", historyError);
    }

    const deleteQuery = ProductVariant.deleteOne({ _id: variantId, productId: ownerProductId });
    if (dbSession) deleteQuery.session(dbSession);
    const deleted = await deleteQuery;

    if ((deleted?.deletedCount ?? 0) === 0) {
      throw new ApiError("NOT_FOUND", "Variant not found.", { field: "variantId" });
    }

    return { historyRecorded, remainingVariants: liveVariantCount - 1 };
  });

  return {
    variantId,
    productId: ownerProductId,
    productName: product?.name ?? null,
    variantLabel,
    remainingVariants: result.remainingVariants,
    historyRecorded: result.historyRecorded,
  };
}

/**
 * Re-derives Product.price from the cheapest active variant. Called after a
 * delete so the product listing never shows a stale minimum price.
 */
export async function syncProductPriceFromVariants(productId: number): Promise<void> {
  const cheapest = await ProductVariant.find({ productId, isActive: true })
    .sort({ price: 1 })
    .select("price")
    .lean();

  const first = cheapest[0] as { price?: unknown } | undefined;
  if (!first || first.price === undefined || first.price === null) return;

  const price = mongoose.Types.Decimal128.fromString(String(first.price));
  await Product.updateOne({ _id: productId }, { $set: { price, updatedAt: new Date() } });
}
