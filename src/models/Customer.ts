import mongoose, { Schema, Document, Model } from "mongoose";
import type { CustomerType } from "@/types/crm";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface ICustomer extends SoftDeleteFields {
  _id: number;
  id?: number;
  companyId: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  billingAddress: string | null;
  siteAddress: string | null;
  gstNumber: string | null;
  customerType: CustomerType;
  assignedSalesId: number | null;
  dealerId: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number;
}

export interface ICustomerDocument extends Omit<ICustomer, "id">, Document<number> {
  id: number;
}

const CustomerSchema = new Schema<ICustomerDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null, trim: true },
    whatsapp: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    billingAddress: { type: String, default: null, trim: true },
    siteAddress: { type: String, default: null, trim: true },
    gstNumber: { type: String, default: null, trim: true, uppercase: true },
    customerType: {
      type: String,
      enum: ["individual", "architect", "builder", "interior_designer", "contractor", "commercial", "other"],
      default: "individual",
      index: true,
    },
    assignedSalesId: { type: Number, ref: "AdminUser", default: null, index: true },
    dealerId: { type: Number, ref: "AdminUser", default: null, index: true },
    notes: { type: String, default: null },
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

CustomerSchema.virtual("id").get(function () {
  return this._id;
});

// Assigned Sales Executive virtual
CustomerSchema.virtual("assignedSales", {
  ref: "AdminUser",
  localField: "assignedSalesId",
  foreignField: "_id",
  justOne: true,
});

// Assigned Dealer virtual
CustomerSchema.virtual("dealer", {
  ref: "AdminUser",
  localField: "dealerId",
  foreignField: "_id",
  justOne: true,
});

// Leads virtual
CustomerSchema.virtual("leads", {
  ref: "Lead",
  localField: "_id",
  foreignField: "customerId",
});

// Quotations virtual
CustomerSchema.virtual("quotations", {
  ref: "Quotation",
  localField: "_id",
  foreignField: "customerId",
});

CustomerSchema.pre("save", function (this: ICustomerDocument) {
  this.updatedAt = new Date();
});

// Indexing for search, filtering, and tenant isolation
CustomerSchema.index({ companyId: 1, createdAt: -1 });
CustomerSchema.index({ companyId: 1, name: 1 });
CustomerSchema.index(
  { companyId: 1, phone: 1 },
  {
    name: "uniq_active_company_phone",
    unique: true,
    partialFilterExpression: {
      phone: { $type: "string" },
      isDeleted: false,
    },
  }
);
CustomerSchema.index({ companyId: 1, email: 1 });
CustomerSchema.index({ companyId: 1, assignedSalesId: 1 });
CustomerSchema.index({ companyId: 1, dealerId: 1 });

softDeletePlugin(CustomerSchema, { blockHardDelete: true });
tenantScopePlugin(CustomerSchema);

export const Customer: Model<ICustomerDocument> =
  mongoose.models.Customer || mongoose.model<ICustomerDocument>("Customer", CustomerSchema);

export default Customer;

