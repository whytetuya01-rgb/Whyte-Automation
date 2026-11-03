import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/** The price of one variant before and after one bulk change. Together they are a variant's price history. */
export interface IPriceSnapshot {
  price: number;
  priceWithoutTax: number | null;
  taxPercent: number;
}

export interface IVariantPriceChange {
  _id: string;
  companyId: number;
  batchId: string;
  variantId: number;
  productId: number;
  /** Copied at the time, so history still reads well if the product is renamed or removed. */
  productName: string;
  variantCode: string | null;
  variantName: string | null;
  before: IPriceSnapshot;
  after: IPriceSnapshot;
  createdAt: Date;
}

export interface IVariantPriceChangeDocument extends Omit<IVariantPriceChange, "_id">, Document<string> {}

const SnapshotSchema = new Schema<IPriceSnapshot>(
  { price: { type: Number, required: true }, priceWithoutTax: { type: Number, default: null }, taxPercent: { type: Number, required: true } },
  { _id: false }
);

const VariantPriceChangeSchema = new Schema<IVariantPriceChangeDocument>(
  {
    _id: { type: String, required: true },
    batchId: { type: String, required: true },
    variantId: { type: Number, required: true },
    productId: { type: Number, required: true },
    productName: { type: String, default: "" },
    variantCode: { type: String, default: null },
    variantName: { type: String, default: null },
    before: { type: SnapshotSchema, required: true },
    after: { type: SnapshotSchema, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false, timestamps: false }
);

VariantPriceChangeSchema.index({ companyId: 1, batchId: 1, variantId: 1 }, { name: "price_changes_by_batch" });
VariantPriceChangeSchema.index({ companyId: 1, variantId: 1, createdAt: -1 }, { name: "price_changes_by_variant" });
VariantPriceChangeSchema.index({ companyId: 1, productId: 1, createdAt: -1 }, { name: "price_changes_by_product" });

tenantScopePlugin(VariantPriceChangeSchema);

export const VariantPriceChange: Model<IVariantPriceChangeDocument> =
  mongoose.models.VariantPriceChange || mongoose.model<IVariantPriceChangeDocument>("VariantPriceChange", VariantPriceChangeSchema);
