import { Product, ProductVariant, ProductVariantHistory } from "@/models";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { ApiError } from "@/lib/api-response";
import { MINIMUM_VARIANT_MESSAGE } from "@/lib/productVariantService";
import type { DeletionActor } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

/**
 * Canonical ProductVariant soft-deletion flow.
 *
 * Both DELETE endpoints delegate here so the guarantees can never diverge:
 *   1. authenticate
 *   2. validate the numeric IDs
 *   3. the ProductVariant must exist (404 if it does not)
 *   4. record the ProductVariantHistory snapshot (unchanged — the Edit
 *      Variants screen's own, separate restore-from-history flow depends on
 *      this row regardless of whether the variant is hard- or soft-deleted)
 *   5. soft-delete; the parent Product must keep at least one LIVE variant,
 *      enforced via the announce/verify/compensate protocol in
 *      `softDeleteOne` — safe under concurrency even without a replica set
 *      (see `tests/soft-delete-core.test.ts`), unlike the previous
 *      check-then-act-in-a-transaction approach
 *
 * A quotation item referencing the variant no longer blocks the delete: the
 * variant row is never destroyed, so the item keeps resolving it exactly as
 * before. It only stops being offered for a NEW quotation item.
 */

export interface SoftDeleteVariantResult {
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
}): string {
  const tier = formatTierLabel(variant.automationTier);
  const finish = formatFinishLabel(variant.surfaceFinish);
  const parts: string[] = [];
  if (tier) parts.push(tier);
  if (finish) parts.push(finish);
  if (parts.length > 0) return parts.join(" · ");
  return variant.variantCode || "Variant";
}

export async function softDeleteVariant(params: {
  variantId: number;
  /** When provided, the variant must belong to this product. */
  productId?: number;
  actor: DeletionActor;
  /** Admin email from the session, recorded on the ProductVariantHistory row (a string field, unrelated to the numeric DeletionActor). */
  deletedBy?: string | null;
}): Promise<SoftDeleteVariantResult> {
  const { variantId, productId, actor, deletedBy = null } = params;

  // 1. Existence first — a missing (or already soft-deleted) variant is 404, never 400.
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
  });
  const product = await Product.findById(ownerProductId).select("name code");

  // 2. History snapshot BEFORE the soft delete — unchanged behaviour for the
  //    Edit Variants restore-from-history flow. Best-effort on a standalone
  //    deployment (no session), exactly as it was for the hard-delete path.
  let historyRecorded = false;
  await withTransaction(async (dbSession) => {
    try {
      const historyId = await getNextSequence("productVariantHistory", ProductVariantHistory, dbSession);
      const historyDoc = new ProductVariantHistory({
        _id: historyId,
        variantId: variant._id,
        productId: ownerProductId,
        productCode: product?.code ?? null,
        variantCode: variant.variantCode ?? null,
        name: variant.name ?? null,
        code: variant.code ?? null,
        automationTier: variant.automationTier ?? null,
        surfaceFinish: variant.surfaceFinish ?? null,
        config: variant.config ?? {},
        price: variant.price ?? null,
        priceWithoutTax: variant.priceWithoutTax ?? null,
        taxPercent: variant.taxPercent ?? null,
        cost: variant.cost ?? null,
        purchaseTaxPercent: variant.purchaseTaxPercent ?? null,
        isActive: variant.isActive ?? true,
        sortOrder: variant.sortOrder ?? 0,
        reason: "hard_delete",
        deletedBy,
        deletedAt: new Date(),
      });
      if (dbSession) await historyDoc.save({ session: dbSession });
      else await historyDoc.save();
      historyRecorded = true;
    } catch (historyError) {
      if (dbSession) throw historyError;
      console.error("Failed to record ProductVariantHistory row:", historyError);
    }
  });

  // 3. Soft delete, with the "at least one live variant" business rule
  //    re-checked against fresh state right after the atomic announce step.
  await softDeleteOne({
    model: ProductVariant,
    entityType: "productVariant",
    id: variantId,
    actor,
    label: variantLabel,
    invariant: async () => {
      const liveSiblings = await ProductVariant.countDocuments({ productId: ownerProductId });
      return liveSiblings < 1 ? { code: "MINIMUM_VARIANT", message: MINIMUM_VARIANT_MESSAGE } : null;
    },
  });

  const remainingVariants = await ProductVariant.countDocuments({ productId: ownerProductId });

  return {
    variantId,
    productId: ownerProductId,
    productName: product?.name ?? null,
    variantLabel,
    remainingVariants,
    historyRecorded,
  };
}

/**
 * Kept for backward compatibility. Pricing belongs strictly to ProductVariant,
 * not the parent Product, so Product.price is no longer synced.
 */
export async function syncProductPriceFromVariants(_productId: number): Promise<void> {
  // No-op: ProductVariant is the sole source of truth for pricing.
}
