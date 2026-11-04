import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One ISSUED version of a quotation (#15). Written when a quotation is first sent (revision 1) and again every time a revision is
 * created and issued. It holds a frozen copy of everything the client was shown (details, rooms, items, prices, totals) and the
 * stored PDF, so a later change to the quotation can never alter what was issued.
 *
 * Append-only: rows are never deleted or replaced, and the only things that may ever be added afterwards are
 *  - the PDF, once (`pdf` from null to a value), and
 *  - the facts about being superseded by the next revision (`supersededAt` ... `statusWhenSuperseded`).
 * The hooks below reject anything else issued through the model.
 */

export interface RevisionSnapshotItem {
  itemId: number;
  productId: number;
  productName: string;
  productCode: string | null;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  priceWithoutTax: number | null;
  taxPercent: number | null;
  taxAmount: number | null;
  notes: string | null;
  /** Per-product discount, when the line had one (absent on snapshots taken before per-product discounts existed). */
  discountType?: "percentage" | "fixed" | null;
  discountValue?: number | null;
  /** The unit price before that discount (`unitPrice` is the price after it). */
  preDiscountUnitPrice?: number | null;
}

export interface RevisionSnapshotRoom {
  roomId: number;
  name: string;
  subArea: string | null;
  notes: string | null;
  items: RevisionSnapshotItem[];
}

export interface RevisionSnapshot {
  quotation: {
    quotationNumber: string;
    clientName: string;
    clientGstNumber: string | null;
    clientPhone: string | null;
    clientEmail: string | null;
    clientAddress: string | null;
    houseTypeId: number | null;
    notes: string | null;
    terms: string | null;
    validUntil: string | null;
    discountType: string | null;
    discountValue: number;
    customerDiscountPercent: number;
    allocatedDiscountPercent: number;
    dealerId: number | null;
  };
  rooms: RevisionSnapshotRoom[];
  totals: { subtotal: number; discountAmount: number; netSubtotal: number; totalGstAmount: number; grandTotal: number };
}

export interface IRevisionPdf {
  /** "revision_file": bytes stored in QuotationRevisionFile; "delivery": the PDF of a delivery already stored (never duplicated). */
  source: "revision_file" | "delivery";
  fileId: string;
  sha256: string;
  size: number;
  attachedAt: Date;
}

export interface IQuotationRevision {
  _id: string;
  companyId: number;
  quotationId: string;
  revision: number;
  quotationNumber: string;
  issuedAt: Date;
  issuedBy: number | null;
  issuedByName: string | null;
  /** Why this revision was made (revision 2 and later). */
  reason: string | null;
  basedOnRevision: number | null;
  /** True when the snapshot was rebuilt from the quotation as it stood when revision tracking began (an older sent quotation). */
  reconstructed: boolean;
  snapshot: RevisionSnapshot;
  pdf: IRevisionPdf | null;
  supersededAt: Date | null;
  supersededBy: number | null;
  supersededByRevision: number | null;
  /** The quotation's status when this revision was replaced (sent / rejected / approved / delivered), with who and when. */
  statusWhenSuperseded: string | null;
  approvedAt: Date | null;
  approvedBy: number | null;
  createdAt: Date;
}

export interface IQuotationRevisionDocument extends Omit<IQuotationRevision, "_id">, Document<string> {}

const QuotationRevisionSchema = new Schema<IQuotationRevisionDocument>(
  {
    _id: { type: String, required: true },
    quotationId: { type: String, required: true },
    revision: { type: Number, required: true, min: 1 },
    quotationNumber: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    issuedBy: { type: Number, default: null },
    issuedByName: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 500 },
    basedOnRevision: { type: Number, default: null },
    reconstructed: { type: Boolean, default: false },
    snapshot: { type: Schema.Types.Mixed, required: true },
    pdf: { type: Schema.Types.Mixed, default: null },
    supersededAt: { type: Date, default: null },
    supersededBy: { type: Number, default: null },
    supersededByRevision: { type: Number, default: null },
    statusWhenSuperseded: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false, timestamps: false }
);

QuotationRevisionSchema.index({ companyId: 1, quotationId: 1, revision: 1 }, { unique: true, name: "one_record_per_quotation_revision" });

tenantScopePlugin(QuotationRevisionSchema);

const IMMUTABLE_MESSAGE = "An issued quotation revision cannot be changed or deleted.";
/** The only fields that may be written after a revision exists. */
const ADDABLE = new Set(["pdf", "supersededAt", "supersededBy", "supersededByRevision", "statusWhenSuperseded", "approvedAt", "approvedBy"]);

function reject(): never {
  throw new Error(IMMUTABLE_MESSAGE);
}

QuotationRevisionSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function (this: { getUpdate(): unknown }) {
  const update = (this.getUpdate() ?? {}) as Record<string, unknown>;
  const keys = Object.keys(update);
  if (keys.some((key) => key !== "$set")) reject();
  const set = (update.$set ?? {}) as Record<string, unknown>;
  if (Object.keys(set).length === 0 || Object.keys(set).some((key) => !ADDABLE.has(key))) reject();
});
QuotationRevisionSchema.pre(["findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], reject);
QuotationRevisionSchema.pre("save", function (this: IQuotationRevisionDocument) {
  if (!this.isNew) reject();
});
QuotationRevisionSchema.pre("deleteOne", { document: true, query: false }, reject);

export const QuotationRevision: Model<IQuotationRevisionDocument> =
  (mongoose.models.QuotationRevision as Model<IQuotationRevisionDocument> | undefined) ??
  mongoose.model<IQuotationRevisionDocument>("QuotationRevision", QuotationRevisionSchema);

export default QuotationRevision;
