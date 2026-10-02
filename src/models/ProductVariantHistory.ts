import mongoose, { Schema, Document, Model } from "mongoose";
import { createDecimalField } from "./helpers";

/**
 * Write-only, inert audit trail of hard-deleted ProductVariant records.
 *
 * ProductVariant itself is still HARD deleted (no soft-delete flag). This
 * collection exists purely to record what was removed and why, so the Edit
 * Variants screen can tell a REMOVED combination apart from one that was never
 * added, and can offer a Restore action.
 *
 * Restoring does NOT delete the history row: the audit trail is append-only.
 * Legacy variants that were deleted before this collection existed are NOT
 * backfilled, so those combinations simply report as "not added".
 */

/** `hard_delete` = deleted on its own; `product_hard_delete` = cascaded from a Product delete. */
export type ProductVariantHistoryReason = "hard_delete" | "product_hard_delete";

export interface IProductVariantHistory {
  _id: number;
  id?: number;
  /** The _id of the ProductVariant that was hard deleted. */
  variantId: number;
  productId: number;
  /** Denormalised for traceability if the product code later changes. */
  productCode: string | null;
  /** Snapshot of the deleted variant, exactly as it was at delete time. */
  variantCode: string | null;
  name: string | null;
  code: string | null;
  automationTier: string | null;
  surfaceFinish: string | null;
  config: Record<string, unknown>;
  price: mongoose.Types.Decimal128 | string | null;
  isActive: boolean;
  sortOrder: number;
  /** Why the variant was removed. */
  reason: ProductVariantHistoryReason;
  /** Admin user who performed the delete, when the session is available. */
  deletedBy: string | null;
  deletedAt: Date;
}

export interface IProductVariantHistoryDocument
  extends Omit<IProductVariantHistory, "id">,
    Document<number> {
  id: number;
}

const ProductVariantHistorySchema = new Schema<IProductVariantHistoryDocument>(
  {
    _id: { type: Number, required: true },
    variantId: { type: Number, required: true, index: true },
    productId: { type: Number, ref: "Product", required: true, index: true },
    productCode: { type: String, default: null, trim: true },
    variantCode: { type: String, default: null, trim: true },
    name: { type: String, default: null, trim: true },
    code: { type: String, default: null, trim: true },
    automationTier: { type: String, default: null },
    surfaceFinish: { type: String, default: null },
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    price: createDecimalField({ default: null, required: false }),
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    reason: { type: String, default: "hard_delete" },
    deletedBy: { type: String, default: null },
    deletedAt: { type: Date, default: Date.now, index: true },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

ProductVariantHistorySchema.virtual("id").get(function () {
  return this._id;
});

// Parent Product virtual relation (snapshot only — used for future restore tooling)
ProductVariantHistorySchema.virtual("product", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});

ProductVariantHistorySchema.index({ productId: 1, variantId: 1 });
ProductVariantHistorySchema.index({ productId: 1, deletedAt: -1 });

export const ProductVariantHistory: Model<IProductVariantHistoryDocument> =
  mongoose.models.ProductVariantHistory ||
  mongoose.model<IProductVariantHistoryDocument>(
    "ProductVariantHistory",
    ProductVariantHistorySchema
  );

export default ProductVariantHistory;
