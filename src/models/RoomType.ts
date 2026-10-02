import mongoose, { Schema, Document, Model } from "mongoose";

export interface IRoomType {
  _id: number;
  id?: number;
  name: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface IRoomTypeDocument extends Omit<IRoomType, "id">, Document<number> {
  id: number;
}

const RoomTypeSchema = new Schema<IRoomTypeDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    icon: { type: String, default: null },
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
RoomTypeSchema.virtual("id").get(function () {
  return this._id;
});

// Room templates virtual relation
RoomTypeSchema.virtual("roomTemplate", {
  ref: "HouseTypeRoomTemplate",
  localField: "_id",
  foreignField: "roomTypeId",
});

// Quotation rooms virtual relation
RoomTypeSchema.virtual("quotationRooms", {
  ref: "QuotationRoom",
  localField: "_id",
  foreignField: "roomTypeId",
});

RoomTypeSchema.index({ isActive: 1, sortOrder: 1 });

export const RoomType: Model<IRoomTypeDocument> =
  mongoose.models.RoomType || mongoose.model<IRoomTypeDocument>("RoomType", RoomTypeSchema);

export default RoomType;
