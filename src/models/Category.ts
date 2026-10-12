import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";

export interface ICategory extends SoftDeleteFields {
  _id: number;
  id?: number;
  name: string;
  level: number;
  parentId: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  variantTiers: unknown | null;
  variantFinishes: unknown | null;
}

export interface ICategoryDocument extends Omit<ICategory, "id">, Document<number> {
  id: number;
}

const CategorySchema = new Schema<ICategoryDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    level: { type: Number, required: true },
    parentId: { type: Number, ref: "Category", default: null, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    variantTiers: { type: mongoose.Schema.Types.Mixed, default: null },
    variantFinishes: { type: mongoose.Schema.Types.Mixed, default: null },
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
CategorySchema.virtual("id").get(function () {
  return this._id;
});

// Self-referencing parent virtual relation
CategorySchema.virtual("parent", {
  ref: "Category",
  localField: "parentId",
  foreignField: "_id",
  justOne: true,
});

// Self-referencing children virtual relation
CategorySchema.virtual("children", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentId",
});

// Products virtual relation
CategorySchema.virtual("products", {
  ref: "Product",
  localField: "_id",
  foreignField: "categoryId",
});

// Compound index for active category querying and sorting
CategorySchema.index({ isActive: 1, sortOrder: 1 });
CategorySchema.index({ parentId: 1, sortOrder: 1 });

// Soft delete: adds isDeleted/deletedAt/deletedBy/deletionReason/deletionGroupId
// fields, scopes every read to live records by default, and blocks any hard
// delete attempted outside src/lib/softDelete/service.ts. Registered once,
// on this fresh Schema instance, before the model below compiles it.
softDeletePlugin(CategorySchema, { blockHardDelete: true });

export const Category: Model<ICategoryDocument> =
  mongoose.models.Category || mongoose.model<ICategoryDocument>("Category", CategorySchema);

export default Category;
