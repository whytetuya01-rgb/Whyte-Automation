import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * The exact PDF that was sent for one delivery (same `_id` as the delivery). Kept so a failed delivery can be
 * retried with the identical document, without asking the sender to rebuild it. Tenant-scoped like the delivery.
 */

/** Largest PDF accepted for sending (well inside MongoDB's 16 MB document limit and typical mail limits). */
export const DELIVERY_MAX_PDF_BYTES = 8 * 1024 * 1024;

export interface IQuotationDeliveryFile {
  _id: string;
  companyId: number;
  mime: "application/pdf";
  size: number;
  sha256: string;
  data: Buffer;
  createdAt: Date;
}

export interface IQuotationDeliveryFileDocument extends IQuotationDeliveryFile, Omit<Document<string>, "_id"> {}

const QuotationDeliveryFileSchema = new Schema<IQuotationDeliveryFileDocument>(
  {
    _id: { type: String, required: true },
    mime: { type: String, enum: ["application/pdf"], required: true, default: "application/pdf" },
    size: { type: Number, required: true, min: 1, max: DELIVERY_MAX_PDF_BYTES },
    sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    data: { type: Buffer, required: true },
  },
  { _id: false, versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);

tenantScopePlugin(QuotationDeliveryFileSchema);

export const QuotationDeliveryFile: Model<IQuotationDeliveryFileDocument> =
  (mongoose.models.QuotationDeliveryFile as Model<IQuotationDeliveryFileDocument> | undefined) ??
  mongoose.model<IQuotationDeliveryFileDocument>("QuotationDeliveryFile", QuotationDeliveryFileSchema);

export default QuotationDeliveryFile;
