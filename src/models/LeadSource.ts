import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface ILeadSource extends SoftDeleteFields {
  _id: string;
  id?: string;
  companyId: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface ILeadSourceDocument extends Omit<ILeadSource, "id">, Document<string> {
  id: string;
}

export const INITIAL_LEAD_SOURCES = [
  "Walk-in",
  "Customer Referral",
  "Website",
  "Instagram",
  "Facebook",
  "Architect",
  "Builder",
  "Exhibition",
  "Dealer Referral",
  "Other",
] as const;

const LeadSourceSchema = new Schema<ILeadSourceDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
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

LeadSourceSchema.virtual("id").get(function () {
  return this._id;
});

LeadSourceSchema.index({ companyId: 1, sortOrder: 1, name: 1 });

softDeletePlugin(LeadSourceSchema, { blockHardDelete: true });
tenantScopePlugin(LeadSourceSchema);

export const LeadSource: Model<ILeadSourceDocument> =
  mongoose.models.LeadSource || mongoose.model<ILeadSourceDocument>("LeadSource", LeadSourceSchema);

export default LeadSource;

