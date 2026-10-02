import mongoose, { Schema, Document, Model } from "mongoose";
import { createDecimalField } from "./helpers";
import type { QuotationStatus, DiscountType } from "@/types";

export interface IQuotation {
  _id: string;
  id?: string;
  quotationNumber: string;
  clientName: string;
  clientGstNumber: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  houseTypeId: number | null;
  status: QuotationStatus;
  notes: string | null;
  discountType: DiscountType | null;
  discountValue: mongoose.Types.Decimal128 | string | null;
  allocatedDiscountPercent: number;
  customerDiscountPercent: number;
  estimatedEarningPercent: number;
  estimatedEarningAmount: mongoose.Types.Decimal128 | string | null;
  dealerId: number | null;
  assignedSalesId: number | null;
  sentAt: Date | null;
  sentBy: number | null;
  approvedAt: Date | null;
  approvedBy: number | null;
  rejectedAt: Date | null;
  rejectedBy: number | null;
  deliveredAt: Date | null;
  deliveredBy: number | null;
  clonedFromQuotationId: string | null;
  terms: string | null;
  validUntil: Date | null;
  defaultTier: string | null;
  defaultFinish: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface IQuotationDocument extends Omit<IQuotation, "id">, Document<string> {
  id: string;
}

const QuotationSchema = new Schema<IQuotationDocument>(
  {
    _id: { type: String, required: true },
    quotationNumber: { type: String, required: true, unique: true, index: true, trim: true },
    clientName: { type: String, required: true, trim: true },
    clientGstNumber: { type: String, default: null, trim: true },
    clientPhone: { type: String, default: null, trim: true },
    clientEmail: { type: String, default: null, trim: true },
    clientAddress: { type: String, default: null, trim: true },
    houseTypeId: { type: Number, ref: "HouseType", default: null, index: true },
    status: {
      type: String,
      enum: ["draft", "sent", "approved", "rejected", "delivered"],
      default: "draft",
      index: true,
    },
    notes: { type: String, default: null },
    discountType: {
      type: String,
      enum: ["percentage", "fixed", "none"],
      default: null,
    },
    discountValue: createDecimalField({ default: null }),
    allocatedDiscountPercent: { type: Number, default: 0 },
    customerDiscountPercent: { type: Number, default: 0 },
    estimatedEarningPercent: { type: Number, default: 0 },
    estimatedEarningAmount: createDecimalField({ default: "0.00" }),
    dealerId: { type: Number, ref: "AdminUser", default: null, index: true },
    assignedSalesId: { type: Number, ref: "AdminUser", default: null, index: true },
    sentAt: { type: Date, default: null },
    sentBy: { type: Number, ref: "AdminUser", default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Number, ref: "AdminUser", default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Number, ref: "AdminUser", default: null },
    deliveredAt: { type: Date, default: null },
    deliveredBy: { type: Number, ref: "AdminUser", default: null },
    clonedFromQuotationId: { type: String, default: null },
    terms: { type: String, default: null },
    validUntil: { type: Date, default: null },
    defaultTier: { type: String, default: null },
    defaultFinish: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: null },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      getters: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

// Virtual for id getter
QuotationSchema.virtual("id").get(function () {
  return this._id;
});

// HouseType virtual relation
QuotationSchema.virtual("houseType", {
  ref: "HouseType",
  localField: "houseTypeId",
  foreignField: "_id",
  justOne: true,
});

// Quotation rooms virtual relation
QuotationSchema.virtual("rooms", {
  ref: "QuotationRoom",
  localField: "_id",
  foreignField: "quotationId",
});

// Dealer virtual relation
QuotationSchema.virtual("dealer", {
  ref: "AdminUser",
  localField: "dealerId",
  foreignField: "_id",
  justOne: true,
});

// Assigned Sales Person virtual relation
QuotationSchema.virtual("assignedSales", {
  ref: "AdminUser",
  localField: "assignedSalesId",
  foreignField: "_id",
  justOne: true,
});

QuotationSchema.pre("save", function (this: IQuotationDocument) {
  this.updatedAt = new Date();
});

// Listing and filtering optimization indexes
QuotationSchema.index({ status: 1, createdAt: -1 });
QuotationSchema.index({ createdAt: -1 });
QuotationSchema.index({ dealerId: 1, createdAt: -1 });
QuotationSchema.index({ assignedSalesId: 1, status: 1 });

const existingQuotationModel = mongoose.models.Quotation as Model<IQuotationDocument> | undefined;

if (existingQuotationModel) {
  const statusPath = existingQuotationModel.schema.path("status") as unknown as {
    enumValues: string[];
    enum: (options: { values: string[] }) => void;
  };
  if (statusPath) {
    statusPath.enumValues = [];
    statusPath.enum({ values: ["draft", "sent", "approved", "rejected", "delivered"] });
  }

  if (!existingQuotationModel.schema.path("dealerId")) {
    existingQuotationModel.schema.add({
      dealerId: { type: Number, ref: "AdminUser", default: null, index: true },
    });
  }

  if (!existingQuotationModel.schema.path("assignedSalesId")) {
    existingQuotationModel.schema.add({
      assignedSalesId: { type: Number, ref: "AdminUser", default: null, index: true },
    });
  }

  if (!existingQuotationModel.schema.path("allocatedDiscountPercent")) {
    existingQuotationModel.schema.add({
      allocatedDiscountPercent: { type: Number, default: 0 },
    });
  }

  if (!existingQuotationModel.schema.path("customerDiscountPercent")) {
    existingQuotationModel.schema.add({
      customerDiscountPercent: { type: Number, default: 0 },
    });
  }

  if (!existingQuotationModel.schema.path("estimatedEarningPercent")) {
    existingQuotationModel.schema.add({
      estimatedEarningPercent: { type: Number, default: 0 },
    });
  }

  if (!existingQuotationModel.schema.path("estimatedEarningAmount")) {
    existingQuotationModel.schema.add({
      estimatedEarningAmount: createDecimalField({ default: "0" }),
    });
  }

  if (!existingQuotationModel.schema.path("sentAt")) {
    existingQuotationModel.schema.add({
      sentAt: { type: Date, default: null },
      sentBy: { type: Number, ref: "AdminUser", default: null },
      approvedAt: { type: Date, default: null },
      approvedBy: { type: Number, ref: "AdminUser", default: null },
      rejectedAt: { type: Date, default: null },
      rejectedBy: { type: Number, ref: "AdminUser", default: null },
      deliveredAt: { type: Date, default: null },
      deliveredBy: { type: Number, ref: "AdminUser", default: null },
    });
  }

  if (!existingQuotationModel.schema.virtualpath("dealer")) {
    existingQuotationModel.schema.virtual("dealer", {
      ref: "AdminUser",
      localField: "dealerId",
      foreignField: "_id",
      justOne: true,
    });
  }

  if (!existingQuotationModel.schema.virtualpath("assignedSales")) {
    existingQuotationModel.schema.virtual("assignedSales", {
      ref: "AdminUser",
      localField: "assignedSalesId",
      foreignField: "_id",
      justOne: true,
    });
  }
}

export const Quotation: Model<IQuotationDocument> =
  existingQuotationModel ?? mongoose.model<IQuotationDocument>("Quotation", QuotationSchema);

export default Quotation;
