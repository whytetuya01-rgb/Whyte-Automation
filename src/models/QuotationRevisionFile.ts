import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";
import { DELIVERY_MAX_PDF_BYTES } from "./QuotationDeliveryFile";

/**
 * The PDF of one issued quotation revision (same `_id` as the revision). Write-once: it can be created but never replaced,
 * edited or deleted through the model, so the document a client was given stays byte-for-byte what it was.
 */
export interface IQuotationRevisionFile {
  _id: string;
  companyId: number;
  mime: "application/pdf";
  size: number;
  sha256: string;
  data: Buffer;
  createdAt: Date;
}

export interface IQuotationRevisionFileDocument extends IQuotationRevisionFile, Omit<Document<string>, "_id"> {}

const QuotationRevisionFileSchema = new Schema<IQuotationRevisionFileDocument>(
  {
    _id: { type: String, required: true },
    mime: { type: String, enum: ["application/pdf"], required: true, default: "application/pdf" },
    size: { type: Number, required: true, min: 1, max: DELIVERY_MAX_PDF_BYTES },
    sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    data: { type: Buffer, required: true },
  },
  { _id: false, versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);

tenantScopePlugin(QuotationRevisionFileSchema);

const IMMUTABLE_MESSAGE = "A stored quotation revision PDF cannot be changed or deleted.";
function reject(): never {
  throw new Error(IMMUTABLE_MESSAGE);
}
QuotationRevisionFileSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], reject);
QuotationRevisionFileSchema.pre("save", function (this: IQuotationRevisionFileDocument) {
  if (!this.isNew) reject();
});
QuotationRevisionFileSchema.pre("deleteOne", { document: true, query: false }, reject);

export const QuotationRevisionFile: Model<IQuotationRevisionFileDocument> =
  (mongoose.models.QuotationRevisionFile as Model<IQuotationRevisionFileDocument> | undefined) ??
  mongoose.model<IQuotationRevisionFileDocument>("QuotationRevisionFile", QuotationRevisionFileSchema);

export default QuotationRevisionFile;
