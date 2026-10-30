import mongoose, { Schema, Document, Model } from "mongoose";
import type { CrmActivityType } from "@/types/crm";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface ICrmActivity {
  _id: string;
  id?: string;
  companyId: number;
  leadId: string | null;
  customerId: number | null;
  quotationId: string | null;
  type: CrmActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  performedBy: number;
  performedByName: string | null;
  performedAt: Date;
}

export interface ICrmActivityDocument extends Omit<ICrmActivity, "id">, Document<string> {
  id: string;
}

export const CRM_ACTIVITY_TYPES = [
  "call",
  "whatsapp",
  "email",
  "site_visit",
  "meeting",
  "quotation_sent",
  "quotation_viewed",
  "follow_up",
  "note",
  "status_change",
] as const;

const CrmActivitySchema = new Schema<ICrmActivityDocument>(
  {
    _id: { type: String, required: true },
    leadId: { type: String, ref: "Lead", default: null, index: true },
    customerId: { type: Number, ref: "Customer", default: null, index: true },
    quotationId: { type: String, ref: "Quotation", default: null, index: true },
    type: { type: String, enum: CRM_ACTIVITY_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    performedBy: { type: Number, required: true },
    performedByName: { type: String, default: null },
    performedAt: { type: Date, required: true, default: Date.now, index: true },
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

CrmActivitySchema.virtual("id").get(function () {
  return this._id;
});

// Indexes for chronological retrieval
CrmActivitySchema.index({ companyId: 1, leadId: 1, performedAt: -1 });
CrmActivitySchema.index({ companyId: 1, customerId: 1, performedAt: -1 });
CrmActivitySchema.index({ companyId: 1, quotationId: 1, performedAt: -1 });

tenantScopePlugin(CrmActivitySchema);

export const CrmActivity: Model<ICrmActivityDocument> =
  mongoose.models.CrmActivity || mongoose.model<ICrmActivityDocument>("CrmActivity", CrmActivitySchema);

export default CrmActivity;

