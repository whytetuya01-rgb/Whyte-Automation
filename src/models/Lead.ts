import mongoose, { Schema, Document, Model } from "mongoose";
import type { LeadStatus, LeadPriority } from "@/types/crm";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface ILead extends SoftDeleteFields {
  _id: string;
  id?: string;
  referenceNumber: string;
  companyId: number;
  customerId: number | null;
  customerName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  siteAddress: string | null;
  location: string | null;
  projectType: string | null;
  estimatedBudget: number | null;
  expectedClosingDate: Date | null;
  sourceId: string | null;
  sourceName: string | null;
  assignedSalesId: number | null;
  dealerId: number | null;
  description: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  notes: string | null;
  tags: string[];
  probability: number | null;
  referrerId: number | null;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  convertedQuotationId: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number;
}

export interface ILeadDocument extends Omit<ILead, "id">, Document<string> {
  id: string;
}

const LeadSchema = new Schema<ILeadDocument>(
  {
    _id: { type: String, required: true },
    referenceNumber: { type: String, required: true, trim: true, index: true },
    customerId: { type: Number, ref: "Customer", default: null, index: true },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, default: null, trim: true },
    whatsapp: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    siteAddress: { type: String, default: null, trim: true },
    location: { type: String, default: null, trim: true },
    projectType: { type: String, default: null, trim: true },
    estimatedBudget: { type: Number, default: null },
    expectedClosingDate: { type: Date, default: null },
    sourceId: { type: String, ref: "LeadSource", default: null },
    sourceName: { type: String, default: null, trim: true },
    assignedSalesId: { type: Number, ref: "AdminUser", default: null, index: true },
    dealerId: { type: Number, ref: "AdminUser", default: null, index: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ["new", "contacted", "site_visit", "quoted", "negotiation", "won", "lost"],
      default: "new",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    notes: { type: String, default: null },
    tags: { type: [String], default: [] },
    probability: { type: Number, default: null, min: 0, max: 100 },
    referrerId: { type: Number, ref: "Customer", default: null, index: true },
    lastContactedAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null, index: true },
    convertedQuotationId: { type: String, ref: "Quotation", default: null, index: true },
    wonAt: { type: Date, default: null },
    lostAt: { type: Date, default: null },
    lostReason: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    createdBy: { type: Number, required: true },
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

LeadSchema.virtual("id").get(function () {
  return this._id;
});

// Central Customer virtual relation
LeadSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

// Assigned Sales Person virtual relation
LeadSchema.virtual("assignedSales", {
  ref: "AdminUser",
  localField: "assignedSalesId",
  foreignField: "_id",
  justOne: true,
});

// Assigned Dealer virtual relation
LeadSchema.virtual("dealer", {
  ref: "AdminUser",
  localField: "dealerId",
  foreignField: "_id",
  justOne: true,
});

// The architect / builder / contractor / dealer contact tied to this project
LeadSchema.virtual("referrer", {
  ref: "Customer",
  localField: "referrerId",
  foreignField: "_id",
  justOne: true,
});

// Converted Quotation virtual relation
LeadSchema.virtual("convertedQuotation", {
  ref: "Quotation",
  localField: "convertedQuotationId",
  foreignField: "_id",
  justOne: true,
});

// Timeline activities virtual
LeadSchema.virtual("activities", {
  ref: "CrmActivity",
  localField: "_id",
  foreignField: "leadId",
});

LeadSchema.pre("save", function (this: ILeadDocument) {
  this.updatedAt = new Date();
});

// Optimized Compound Indexes for filtering, search, and tenant isolation
LeadSchema.index({ companyId: 1, referenceNumber: 1 }, { unique: true });
LeadSchema.index({ companyId: 1, status: 1, createdAt: -1 });
LeadSchema.index({ companyId: 1, tags: 1 });
LeadSchema.index({ companyId: 1, assignedSalesId: 1, status: 1 });
LeadSchema.index({ companyId: 1, dealerId: 1, status: 1 });
LeadSchema.index({ companyId: 1, customerId: 1 });
LeadSchema.index({ companyId: 1, nextFollowUpAt: 1 });
LeadSchema.index({ companyId: 1, priority: 1, createdAt: -1 });

softDeletePlugin(LeadSchema, { blockHardDelete: true });
tenantScopePlugin(LeadSchema);

export const Lead: Model<ILeadDocument> =
  mongoose.models.Lead || mongoose.model<ILeadDocument>("Lead", LeadSchema);

export default Lead;

