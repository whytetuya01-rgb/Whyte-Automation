import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface IRoomTemplateItem {
  productId: number;
  variantId?: number | null;
  defaultQuantity: number;
  displayOrder: number;
  isRequired?: boolean;
  notes?: string | null;
  variantConfig?: Record<string, unknown> | null;
  preferredProtocol?: string | null;
  preferredControl?: string | null;
  preferredFinish?: string | null;
  allowAlternativeProtocol?: boolean;
  accessoryIds?: number[];
}

export interface IRoomTemplate extends SoftDeleteFields {
  _id: number;
  id?: number;
  companyId: number;
  roomTypeId: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  displayOrder: number;
  defaultProtocol?: string | null;
  defaultControl?: string | null;
  defaultFinish?: string | null;
  items: IRoomTemplateItem[];
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRoomTemplateDocument extends Omit<IRoomTemplate, "id">, Document<number> {
  id: number;
}

const RoomTemplateItemSchema = new Schema<IRoomTemplateItem>(
  {
    productId: { type: Number, ref: "Product", required: true },
    variantId: { type: Number, ref: "ProductVariant", default: null },
    defaultQuantity: { type: Number, default: 1, min: 1 },
    displayOrder: { type: Number, default: 0 },
    isRequired: { type: Boolean, default: false },
    notes: { type: String, default: null },
    variantConfig: { type: Schema.Types.Mixed, default: null },
    preferredProtocol: { type: String, default: null },
    preferredControl: { type: String, default: null },
    preferredFinish: { type: String, default: null },
    allowAlternativeProtocol: { type: Boolean, default: true },
    accessoryIds: { type: [Number], default: undefined },
  },
  { _id: false }
);

const RoomTemplateSchema = new Schema<IRoomTemplateDocument>(
  {
    _id: { type: Number, required: true },
    roomTypeId: { type: Number, ref: "RoomType", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    displayOrder: { type: Number, default: 0, index: true },
    defaultProtocol: { type: String, default: null },
    defaultControl: { type: String, default: null },
    defaultFinish: { type: String, default: null },
    items: { type: [RoomTemplateItemSchema], default: [] },
    createdBy: { type: Number, default: null },
    updatedBy: { type: Number, default: null },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: true,
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
RoomTemplateSchema.virtual("id").get(function () {
  return this._id;
});

// RoomType virtual relation
RoomTemplateSchema.virtual("roomType", {
  ref: "RoomType",
  localField: "roomTypeId",
  foreignField: "_id",
  justOne: true,
});

/**
 * EXACTLY ONE TEMPLATE PER ROOM TYPE CONSTRAINT:
 * Unique index across (companyId, roomTypeId) for non-deleted records.
 * Enforced at both database and API level.
 */
RoomTemplateSchema.index(
  { companyId: 1, roomTypeId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

RoomTemplateSchema.index({ companyId: 1, isActive: 1, sortOrder: 1 });

softDeletePlugin(RoomTemplateSchema, { blockHardDelete: true });
tenantScopePlugin(RoomTemplateSchema);

export const RoomTemplate: Model<IRoomTemplateDocument> =
  mongoose.models.RoomTemplate ||
  mongoose.model<IRoomTemplateDocument>("RoomTemplate", RoomTemplateSchema);

export default RoomTemplate;
