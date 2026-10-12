import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Append-only audit trail of soft delete, restore and purge operations.
 *
 * A restore clears the deletion fields on the record itself, so this collection
 * is the durable answer to "who deleted / restored this, when and why". Only
 * the soft-delete service inserts rows; the hooks below reject any update or
 * delete issued through the model, mirroring QuotationAuditEvent.
 */

export const SOFT_DELETE_ENTITY_TYPES = [
  "category",
  "roomType",
  "houseType",
  "product",
  "productVariant",
  "quotation",
  "quotationRoom",
  "quotationItem",
] as const;

export type SoftDeleteEntityType = (typeof SOFT_DELETE_ENTITY_TYPES)[number];

export const DELETION_AUDIT_ACTIONS = [
  "soft_deleted",
  /** A soft delete that was undone because a concurrent change broke one of its rules. */
  "soft_delete_reverted",
  "restored",
  /** A restore that was undone because a concurrent change broke one of its rules. */
  "restore_reverted",
  "purged",
] as const;

export type DeletionAuditAction = (typeof DELETION_AUDIT_ACTIONS)[number];

export interface IDeletionAuditCascade {
  entityType: SoftDeleteEntityType;
  count: number;
}

export interface IDeletionAuditEvent {
  _id: string;
  id?: string;
  action: DeletionAuditAction;
  entityType: SoftDeleteEntityType;
  /** The record's `_id`, stringified (models use numeric and string ids). */
  entityId: string;
  /** Display label snapshot (product name, quotation number, …) at the time of the action. */
  entityLabel: string | null;
  deletionGroupId: string;
  /** Owned children affected together with the record. */
  cascade: IDeletionAuditCascade[];
  reason: string | null;
  /** Authenticated AdminUser id, from the server session. */
  performedBy: number;
  performedByName: string | null;
  performedByRole: string | null;
  /** Server-generated timestamp. */
  performedOn: Date;
  metadata: Record<string, unknown> | null;
}

export interface IDeletionAuditEventDocument extends Omit<IDeletionAuditEvent, "id">, Document<string> {
  id: string;
}

const DeletionAuditCascadeSchema = new Schema<IDeletionAuditCascade>(
  {
    entityType: { type: String, enum: SOFT_DELETE_ENTITY_TYPES, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const DeletionAuditEventSchema = new Schema<IDeletionAuditEventDocument>(
  {
    _id: { type: String, required: true },
    action: { type: String, enum: DELETION_AUDIT_ACTIONS, required: true },
    entityType: { type: String, enum: SOFT_DELETE_ENTITY_TYPES, required: true },
    entityId: { type: String, required: true },
    entityLabel: { type: String, default: null },
    deletionGroupId: { type: String, required: true },
    cascade: { type: [DeletionAuditCascadeSchema], default: () => [] },
    reason: { type: String, default: null },
    performedBy: { type: Number, required: true },
    performedByName: { type: String, default: null },
    performedByRole: { type: String, default: null },
    performedOn: { type: Date, required: true, default: Date.now },
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

DeletionAuditEventSchema.index({ performedOn: -1 });
DeletionAuditEventSchema.index({ entityType: 1, entityId: 1, performedOn: -1 });
DeletionAuditEventSchema.index({ deletionGroupId: 1 });

const IMMUTABLE_MESSAGE = "Deletion audit events are append-only and cannot be modified or deleted.";

function reject(): never {
  throw new Error(IMMUTABLE_MESSAGE);
}

DeletionAuditEventSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
  reject
);
DeletionAuditEventSchema.pre("save", function (this: IDeletionAuditEventDocument) {
  if (!this.isNew) reject();
});
DeletionAuditEventSchema.pre("deleteOne", { document: true, query: false }, reject);
DeletionAuditEventSchema.pre("bulkWrite", function (ops) {
  if (ops.some((op) => !("insertOne" in op))) reject();
});

export const DeletionAuditEvent: Model<IDeletionAuditEventDocument> =
  (mongoose.models.DeletionAuditEvent as Model<IDeletionAuditEventDocument> | undefined) ??
  mongoose.model<IDeletionAuditEventDocument>("DeletionAuditEvent", DeletionAuditEventSchema);

export default DeletionAuditEvent;
