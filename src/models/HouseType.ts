import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface IHouseType extends SoftDeleteFields {
  _id: number;
  id?: number;
  companyId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface IHouseTypeDocument extends Omit<IHouseType, "id">, Document<number> {
  id: number;
}

const HouseTypeSchema = new Schema<IHouseTypeDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

// Virtual for id getter
HouseTypeSchema.virtual("id").get(function () {
  return this._id;
});

// Room templates virtual relation
HouseTypeSchema.virtual("roomTemplate", {
  ref: "HouseTypeRoomTemplate",
  localField: "_id",
  foreignField: "houseTypeId",
});

// Quotations virtual relation
HouseTypeSchema.virtual("quotations", {
  ref: "Quotation",
  localField: "_id",
  foreignField: "houseTypeId",
});

HouseTypeSchema.index({ companyId: 1, isActive: 1, sortOrder: 1 });

softDeletePlugin(HouseTypeSchema, { blockHardDelete: true });
tenantScopePlugin(HouseTypeSchema);

export const HouseType: Model<IHouseTypeDocument> =
  mongoose.models.HouseType || mongoose.model<IHouseTypeDocument>("HouseType", HouseTypeSchema);

export default HouseType;
