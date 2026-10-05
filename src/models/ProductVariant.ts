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
  priceWithoutTax?: mongoose.Types.Decimal128 | string;
  taxPercent?: mongoose.Types.Decimal128 | string;
  price: mongoose.Types.Decimal128 | string;
  cost?: mongoose.Types.Decimal128 | string;
  purchaseTaxPercent?: mongoose.Types.Decimal128 | string;
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
    priceWithoutTax: createDecimalField({ default: "0.00", min: 0 }),
    taxPercent: createDecimalField({ default: "18.00", min: 0 }),
    price: createDecimalField({ required: true, min: 0 }),
    cost: createDecimalField({ default: "0.00", min: 0 }),
    purchaseTaxPercent: createDecimalField({ default: "18.00", min: 0 }),
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
        const pwt = ret.priceWithoutTax ? Number(ret.priceWithoutTax) : 0;
        const tp = ret.taxPercent ? Number(ret.taxPercent) : 18;
        ret.taxAmount = (Math.round(pwt * tp) / 100).toFixed(2);
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
        const pwt = ret.priceWithoutTax ? Number(ret.priceWithoutTax) : 0;
        const tp = ret.taxPercent ? Number(ret.taxPercent) : 18;
        ret.taxAmount = (Math.round(pwt * tp) / 100).toFixed(2);
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

const existingProductVariantModel = mongoose.models.ProductVariant as Model<IProductVariantDocument> | undefined;

if (existingProductVariantModel) {
  if (!existingProductVariantModel.schema.path("priceWithoutTax")) {
    existingProductVariantModel.schema.add({
      priceWithoutTax: createDecimalField({ default: "0.00", min: 0 }),
    });
  }
  if (!existingProductVariantModel.schema.path("taxPercent")) {
    existingProductVariantModel.schema.add({
      taxPercent: createDecimalField({ default: "18.00", min: 0 }),
    });
  }
  if (!existingProductVariantModel.schema.path("cost")) {
    existingProductVariantModel.schema.add({
      cost: createDecimalField({ default: "0.00", min: 0 }),
    });
  }
  if (!existingProductVariantModel.schema.path("purchaseTaxPercent")) {
    existingProductVariantModel.schema.add({
      purchaseTaxPercent: createDecimalField({ default: "18.00", min: 0 }),
    });
  }
}

export const ProductVariant: Model<IProductVariantDocument> =
  existingProductVariantModel ??
  mongoose.model<IProductVariantDocument>("ProductVariant", ProductVariantSchema);

export default ProductVariant;
