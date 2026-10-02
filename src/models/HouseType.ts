import mongoose, { Schema, Document, Model } from "mongoose";

export interface IHouseType {
  _id: number;
  id?: number;
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

HouseTypeSchema.index({ isActive: 1, sortOrder: 1 });

export const HouseType: Model<IHouseTypeDocument> =
  mongoose.models.HouseType || mongoose.model<IHouseTypeDocument>("HouseType", HouseTypeSchema);

export default HouseType;
