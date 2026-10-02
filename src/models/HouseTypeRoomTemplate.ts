import mongoose, { Schema, Document, Model } from "mongoose";

export interface IHouseTypeRoomTemplate {
  _id: number;
  id?: number;
  houseTypeId: number;
  roomTypeId: number;
  defaultCount: number;
  sortOrder: number;
}

export interface IHouseTypeRoomTemplateDocument
  extends Omit<IHouseTypeRoomTemplate, "id">,
    Document<number> {
  id: number;
}

const HouseTypeRoomTemplateSchema = new Schema<IHouseTypeRoomTemplateDocument>(
  {
    _id: { type: Number, required: true },
    houseTypeId: { type: Number, ref: "HouseType", required: true, index: true },
    roomTypeId: { type: Number, ref: "RoomType", required: true, index: true },
    defaultCount: { type: Number, default: 1 },
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
HouseTypeRoomTemplateSchema.virtual("id").get(function () {
  return this._id;
});

// HouseType virtual relation
HouseTypeRoomTemplateSchema.virtual("houseType", {
  ref: "HouseType",
  localField: "houseTypeId",
  foreignField: "_id",
  justOne: true,
});

// RoomType virtual relation
HouseTypeRoomTemplateSchema.virtual("roomType", {
  ref: "RoomType",
  localField: "roomTypeId",
  foreignField: "_id",
  justOne: true,
});

// Compound index for querying room templates by house type
HouseTypeRoomTemplateSchema.index({ houseTypeId: 1, roomTypeId: 1 });
HouseTypeRoomTemplateSchema.index({ houseTypeId: 1, sortOrder: 1 });

export const HouseTypeRoomTemplate: Model<IHouseTypeRoomTemplateDocument> =
  mongoose.models.HouseTypeRoomTemplate ||
  mongoose.model<IHouseTypeRoomTemplateDocument>(
    "HouseTypeRoomTemplate",
    HouseTypeRoomTemplateSchema
  );

export default HouseTypeRoomTemplate;
