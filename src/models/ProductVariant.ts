import mongoose, { Schema, Document, Model } from "mongoose";
import { createDecimalField } from "./helpers";

export interface IProductVariant {
  _id: number;
  id?: number;
  productId: number;
  variantCode?: string | null;
  name?: string | null;
  code?: string | null;
  automationTier: string | null;
  surfaceFinish: string | null;
  config: Record<string, unknown>;
  price: mongoose.Types.Decimal128 | string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IProductVariantDocument extends Omit<IProductVariant, "id">, Document<number> {
  id: number;
}

const ProductVariantSchema = new Schema<IProductVariantDocument>(
  {
    _id: { type: Number, required: true },
    productId: { type: Number, ref: "Product", required: true, index: true },
    variantCode: { type: String, default: null, trim: true },
    name: { type: String, default: null, trim: true },
    code: { type: String, default: null, trim: true },
    automationTier: { type: String, default: null },
    surfaceFinish: { type: String, default: null },
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    price: createDecimalField({ required: true }),
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
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
        if (!ret.variantCode && ret.code) {
          ret.variantCode = ret.code;
        } else if (!ret.variantCode && ret.config && typeof ret.config === "object" && (ret.config as any).variantCode) {
          ret.variantCode = (ret.config as any).variantCode;
        }
        if (!ret.code && ret.variantCode) {
          ret.code = ret.variantCode;
        } else if (!ret.code && ret.config && typeof ret.config === "object" && (ret.config as any).code) {
          ret.code = (ret.config as any).code;
        }
        if (!ret.name && ret.config && typeof ret.config === "object" && (ret.config as any).name) {
          ret.name = (ret.config as any).name;
        }
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        if (!ret.variantCode && ret.code) {
          ret.variantCode = ret.code;
        } else if (!ret.variantCode && ret.config && typeof ret.config === "object" && (ret.config as any).variantCode) {
          ret.variantCode = (ret.config as any).variantCode;
        }
        if (!ret.code && ret.variantCode) {
          ret.code = ret.variantCode;
        } else if (!ret.code && ret.config && typeof ret.config === "object" && (ret.config as any).code) {
          ret.code = (ret.config as any).code;
        }
        if (!ret.name && ret.config && typeof ret.config === "object" && (ret.config as any).name) {
          ret.name = (ret.config as any).name;
        }
        return ret;
      },
    },
  }
);

// Virtual for id getter
ProductVariantSchema.virtual("id").get(function () {
  return this._id;
});

// Parent Product virtual relation
ProductVariantSchema.virtual("product", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});

// Quotation items virtual relation
ProductVariantSchema.virtual("quotationItems", {
  ref: "QuotationItem",
  localField: "_id",
  foreignField: "productVariantId",
});

// Compound index for querying variants of a product
ProductVariantSchema.index({ productId: 1, isActive: 1, sortOrder: 1 });
ProductVariantSchema.index({ code: 1 }, { sparse: true });
ProductVariantSchema.index({ variantCode: 1 }, { sparse: true });

export const ProductVariant: Model<IProductVariantDocument> =
  mongoose.models.ProductVariant ||
  mongoose.model<IProductVariantDocument>("ProductVariant", ProductVariantSchema);

export default ProductVariant;
