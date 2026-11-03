import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One bulk price change (or the undo of one): who did it, the rule, which products it covered and how many variants moved.
 * The per-variant before/after lives in `VariantPriceChange`. A batch is history: it is never edited, except that an undone
 * batch is marked `revertedAt`.
 */
export interface IPriceChangeBatch {
  _id: string;
  companyId: number;
  kind: "change" | "revert" | "import";
  /** For a revert: the batch it undid. */
  revertsBatchId: string | null;
  rule: { mode: string; direction: string; value: number; rounding: string } | null;
  /** A readable description of what it covered, e.g. "Category: Tactus" or "All products". */
  scopeLabel: string;
  scope: { all: boolean; categoryIds: number[]; productIds: number[] };
  note: string | null;
  variantsChanged: number;
  variantsSkipped: number;
  createdBy: number;
  createdByName: string | null;
  createdAt: Date;
  /** Set when this batch has been undone (by a later "revert" batch). */
  revertedAt: Date | null;
  revertedByBatchId: string | null;
}

export interface IPriceChangeBatchDocument extends Omit<IPriceChangeBatch, "_id">, Document<string> {}

const PriceChangeBatchSchema = new Schema<IPriceChangeBatchDocument>(
  {
    _id: { type: String, required: true },
    kind: { type: String, enum: ["change", "revert", "import"], required: true },
    revertsBatchId: { type: String, default: null },
    rule: { type: Schema.Types.Mixed, default: null },
    scopeLabel: { type: String, required: true, maxlength: 300 },
    scope: { type: Schema.Types.Mixed, required: true },
    note: { type: String, default: null, maxlength: 200 },
    variantsChanged: { type: Number, required: true },
    variantsSkipped: { type: Number, default: 0 },
    createdBy: { type: Number, required: true },
    createdByName: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    revertedAt: { type: Date, default: null },
    revertedByBatchId: { type: String, default: null },
  },
  { _id: false, versionKey: false, timestamps: false }
);

PriceChangeBatchSchema.index({ companyId: 1, createdAt: -1 }, { name: "price_batches_by_company_date" });

tenantScopePlugin(PriceChangeBatchSchema);

export const PriceChangeBatch: Model<IPriceChangeBatchDocument> =
  mongoose.models.PriceChangeBatch || mongoose.model<IPriceChangeBatchDocument>("PriceChangeBatch", PriceChangeBatchSchema);
