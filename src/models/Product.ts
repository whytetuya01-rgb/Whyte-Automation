import mongoose, { Schema, Document, Model } from "mongoose";
import type { ProductType } from "@/types";

export interface IProduct {
  _id: number;
  id?: number;
  name: string;
  code: string | null;
  description: string | null;
  type: ProductType;
  categoryId: number | null;
  automationTier: string | null;
  surfaceFinish: string | null;
  unit: string;
  imageUrl: string | null;
  imagePublicId?: string | null;
  moduleSize: string | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  isMatrix: boolean;
  matrixDimensions: unknown | null;
}

export interface IProductDocument extends Omit<IProduct, "id">, Document<number> {
  id: number;
}

const ProductSchema = new Schema<IProductDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: null, trim: true },
    description: { type: String, default: null },
    type: {
      type: String,
      enum: ["switch_board", "accessory", "curtain", "smart_lock", "vdp", "other"],
      required: true,
      index: true,
    },
    categoryId: { type: Number, ref: "Category", default: null, index: true },
    automationTier: { type: String, default: null, trim: true, index: true },
    surfaceFinish: { type: String, default: null, trim: true, index: true },
    unit: { type: String, default: "pcs", trim: true },
    imageUrl: { type: String, default: null },
    imagePublicId: { type: String, default: null },
    moduleSize: { type: String, default: null },
    notes: { type: String, default: null },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    isMatrix: { type: Boolean, default: false },
    matrixDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
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
ProductSchema.virtual("id").get(function () {
  return this._id;
});

// Category virtual relation
ProductSchema.virtual("category", {
  ref: "Category",
  localField: "categoryId",
  foreignField: "_id",
  justOne: true,
});

// Product variants virtual relation
ProductSchema.virtual("variants", {
  ref: "ProductVariant",
  localField: "_id",
  foreignField: "productId",
});

// Quotation items virtual relation
ProductSchema.virtual("quotationItems", {
  ref: "QuotationItem",
  localField: "_id",
  foreignField: "productId",
});

ProductSchema.pre("save", function (this: IProductDocument) {
  this.updatedAt = new Date();
});

// Query optimization indexes
ProductSchema.index({ createdAt: -1, _id: -1 });
ProductSchema.index({ categoryId: 1, automationTier: 1, surfaceFinish: 1 });
ProductSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1 });
ProductSchema.index({ code: 1 }, { sparse: true });
ProductSchema.index({ type: 1, isActive: 1 });

export const Product: Model<IProductDocument> =
  mongoose.models.Product || mongoose.model<IProductDocument>("Product", ProductSchema);

export default Product;
