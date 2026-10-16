import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { historicalReferenceOptions } from "@/lib/softDelete/scope";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface IQuotationRoom extends SoftDeleteFields {
  _id: number;
  id?: number;
  companyId: number;
  quotationId: string;
  roomTypeId: number | null;
  customName: string | null;
  subArea: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface IQuotationRoomDocument extends Omit<IQuotationRoom, "id">, Document<number> {
  id: number;
}

const QuotationRoomSchema = new Schema<IQuotationRoomDocument>(
  {
    _id: { type: Number, required: true },
    quotationId: { type: String, ref: "Quotation", required: true, index: true },
    roomTypeId: { type: Number, ref: "RoomType", default: null, index: true },
    customName: { type: String, default: null, trim: true },
    subArea: { type: String, default: null, trim: true },
    notes: { type: String, default: null },
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
QuotationRoomSchema.virtual("id").get(function () {
  return this._id;
});

// Quotation virtual relation
QuotationRoomSchema.virtual("quotation", {
  ref: "Quotation",
  localField: "quotationId",
  foreignField: "_id",
  justOne: true,
});

// RoomType virtual relation
// A quotation room always refers to whatever room type it was created with —
// never "is this room type still offered for a NEW room" — so this populate
// must keep resolving a soft-deleted RoomType, exactly like a historical
// product reference, or an old quotation would render with a blank room name.
QuotationRoomSchema.virtual("roomType", {
  ref: "RoomType",
  localField: "roomTypeId",
  foreignField: "_id",
  justOne: true,
  options: historicalReferenceOptions(),
});

// Quotation items virtual relation
QuotationRoomSchema.virtual("items", {
  ref: "QuotationItem",
  localField: "_id",
  foreignField: "quotationRoomId",
});

// Compound index for querying rooms belonging to a quotation in display order
QuotationRoomSchema.index({ companyId: 1, quotationId: 1, sortOrder: 1 });

softDeletePlugin(QuotationRoomSchema, { blockHardDelete: true });
tenantScopePlugin(QuotationRoomSchema);

export const QuotationRoom: Model<IQuotationRoomDocument> =
  mongoose.models.QuotationRoom ||
  mongoose.model<IQuotationRoomDocument>("QuotationRoom", QuotationRoomSchema);

export default QuotationRoom;
