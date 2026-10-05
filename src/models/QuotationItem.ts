import mongoose, { Schema, Document, Model } from "mongoose";
import { createDecimalField } from "./helpers";

export interface IQuotationItem {
  _id: number;
  id?: number;
  quotationRoomId: number;
  productId: number;
  productVariantId: number | null;
  variantLabel: string | null;
  variantConfig: Record<string, unknown> | null;
  sbNumber: string | null;
  quantity: number;
  unitPrice: mongoose.Types.Decimal128 | string;
  priceWithoutTax?: mongoose.Types.Decimal128 | string | null;
  taxPercent?: mongoose.Types.Decimal128 | string | null;
  taxAmount?: mongoose.Types.Decimal128 | string | null;
  notes: string | null;
  sortOrder: number;
}

export interface IQuotationItemDocument extends Omit<IQuotationItem, "id">, Document<number> {
  id: number;
}

const QuotationItemSchema = new Schema<IQuotationItemDocument>(
  {
    _id: { type: Number, required: true },
    quotationRoomId: { type: Number, ref: "QuotationRoom", required: true, index: true },
    productId: { type: Number, ref: "Product", required: true, index: true },
    productVariantId: { type: Number, ref: "ProductVariant", default: null, index: true },
    variantLabel: { type: String, default: null },
    variantConfig: { type: mongoose.Schema.Types.Mixed, default: null },
    sbNumber: { type: String, default: null },
    quantity: { type: Number, default: 1 },
    unitPrice: createDecimalField({ required: true, min: 0 }),
    priceWithoutTax: createDecimalField({ default: null, min: 0 }),
    taxPercent: createDecimalField({ default: null, min: 0 }),
    taxAmount: createDecimalField({ default: null, min: 0 }),
    notes: { type: String, default: null },
    sortOrder: { type: Number, default: 0, index: true },
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

// Virtual for id getter
QuotationItemSchema.virtual("id").get(function () {
  return this._id;
});

// Room virtual relation
QuotationItemSchema.virtual("room", {
  ref: "QuotationRoom",
  localField: "quotationRoomId",
  foreignField: "_id",
  justOne: true,
});

// Product virtual relation
QuotationItemSchema.virtual("product", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});

// ProductVariant virtual relation
QuotationItemSchema.virtual("productVariant", {
  ref: "ProductVariant",
  localField: "productVariantId",
  foreignField: "_id",
  justOne: true,
});

// Compound index for querying items belonging to a room in display order
QuotationItemSchema.index({ quotationRoomId: 1, sortOrder: 1 });
QuotationItemSchema.index({ productId: 1, productVariantId: 1 });

const existingQuotationItemModel = mongoose.models.QuotationItem as Model<IQuotationItemDocument> | undefined;

if (existingQuotationItemModel) {
  if (!existingQuotationItemModel.schema.path("priceWithoutTax")) {
    existingQuotationItemModel.schema.add({
      priceWithoutTax: createDecimalField({ default: null, min: 0 }),
    });
  }
  if (!existingQuotationItemModel.schema.path("taxPercent")) {
    existingQuotationItemModel.schema.add({
      taxPercent: createDecimalField({ default: null, min: 0 }),
    });
  }
  if (!existingQuotationItemModel.schema.path("taxAmount")) {
    existingQuotationItemModel.schema.add({
      taxAmount: createDecimalField({ default: null, min: 0 }),
    });
  }
}

export const QuotationItem: Model<IQuotationItemDocument> =
  existingQuotationItemModel ??
  mongoose.model<IQuotationItemDocument>("QuotationItem", QuotationItemSchema);

export default QuotationItem;
