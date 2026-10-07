import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Append-only audit trail for quotations.
 *
 * Application code only ever INSERTS rows (see `recordQuotationEvent`). There is
 * no update or delete API for this collection, and the schema hooks below reject
 * any update/delete issued through the model, so history cannot be rewritten
 * through normal quotation code paths. Rows survive the quotation they describe.
 */

export const QUOTATION_AUDIT_ACTIONS = [
  "quotation_created",
  "quotation_assigned",
  "quotation_reassigned",
  "quotation_unassigned",
  "quotation_cloned",
  "status_changed",
  "quotation_approved",
  "quotation_rejected",
  "quotation_delivered",
] as const;

export type QuotationAuditAction = (typeof QUOTATION_AUDIT_ACTIONS)[number];

export interface IQuotationAuditEvent {
  _id: string;
  id?: string;
  quotationId: string;
  action: QuotationAuditAction;
  /** Authenticated AdminUser id that performed the action. */
  performedBy: number;
  /** Display name snapshot, so history stays readable if the user is renamed/removed. */
  performedByName: string | null;
  /** Server-generated timestamp. */
  performedOn: Date;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface IQuotationAuditEventDocument extends Omit<IQuotationAuditEvent, "id">, Document<string> {
  id: string;
}

const QuotationAuditEventSchema = new Schema<IQuotationAuditEventDocument>(
  {
    _id: { type: String, required: true },
    quotationId: { type: String, required: true, index: true },
    action: { type: String, enum: QUOTATION_AUDIT_ACTIONS, required: true },
    performedBy: { type: Number, required: true },
    performedByName: { type: String, default: null },
    performedOn: { type: Date, required: true, default: Date.now },
    previousValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
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
  }
);

QuotationAuditEventSchema.index({ quotationId: 1, performedOn: 1 });

const IMMUTABLE_MESSAGE = "Quotation audit events are append-only and cannot be modified or deleted.";

function reject(): never {
  throw new Error(IMMUTABLE_MESSAGE);
}

QuotationAuditEventSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
  reject
);
QuotationAuditEventSchema.pre("save", function (this: IQuotationAuditEventDocument) {
  if (!this.isNew) reject();
});
QuotationAuditEventSchema.pre("deleteOne", { document: true, query: false }, reject);

export const QuotationAuditEvent: Model<IQuotationAuditEventDocument> =
  (mongoose.models.QuotationAuditEvent as Model<IQuotationAuditEventDocument> | undefined) ??
  mongoose.model<IQuotationAuditEventDocument>("QuotationAuditEvent", QuotationAuditEventSchema);

export default QuotationAuditEvent;
