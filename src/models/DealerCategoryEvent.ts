import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";
import { DEALER_TIER_KEYS, type DealerTierKey } from "@/lib/dealerTiers";

export const DEALER_CATEGORY_EVENT_SOURCES = ["automatic", "manual"] as const;
export type DealerCategoryEventSource = (typeof DEALER_CATEGORY_EVENT_SOURCES)[number];

/**
 * Append-only history of a dealer's category: every upgrade (from the quotation that earned it, or from reconciling
 * historical data) and every manual correction by a Super Admin, with who and why. Never edited or deleted.
 */
export interface IDealerCategoryEvent {
  _id: string;
  companyId: number;
  dealerId: number;
  fromCategory: DealerTierKey | null;
  toCategory: DealerTierKey;
  source: DealerCategoryEventSource;
  /** Lifetime qualified quotations at the moment of the change. */
  qualifiedCount: number;
  /** The delivered quotation that triggered an automatic upgrade (null when it came from reconciling history). */
  quotationId: string | null;
  /** Required for manual corrections. */
  reason: string | null;
  performedBy: number | null;
  performedByName: string | null;
  createdAt: Date;
}

export interface IDealerCategoryEventDocument extends Omit<IDealerCategoryEvent, "_id">, Document<string> {}

const DealerCategoryEventSchema = new Schema<IDealerCategoryEventDocument>(
  {
    _id: { type: String, required: true },
    dealerId: { type: Number, required: true },
    fromCategory: { type: String, enum: DEALER_TIER_KEYS, default: null },
    toCategory: { type: String, enum: DEALER_TIER_KEYS, required: true },
    source: { type: String, enum: ["automatic", "manual"], required: true },
    qualifiedCount: { type: Number, required: true, min: 0 },
    quotationId: { type: String, default: null },
    reason: { type: String, default: null, trim: true, maxlength: 500 },
    performedBy: { type: Number, default: null },
    performedByName: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false, timestamps: false }
);

// One dealer's timeline, newest first; the company-wide "upgrades in a period" count.
DealerCategoryEventSchema.index({ companyId: 1, dealerId: 1, createdAt: -1 });
DealerCategoryEventSchema.index({ companyId: 1, createdAt: -1 });

tenantScopePlugin(DealerCategoryEventSchema);

export const DealerCategoryEvent: Model<IDealerCategoryEventDocument> =
  mongoose.models.DealerCategoryEvent || mongoose.model<IDealerCategoryEventDocument>("DealerCategoryEvent", DealerCategoryEventSchema);
