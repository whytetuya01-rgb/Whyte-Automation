import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export const ASSIGNMENT_MODES = ["manual", "round_robin", "least_open_leads"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export interface ISourceMapping {
  sourceId: string;
  salesId: number;
}

export interface ILeadAssignmentRule {
  _id: string;
  id?: string;
  companyId: number;
  mode: AssignmentMode;
  enabled: boolean;
  eligibleSalesIds: number[];
  fallbackSalesId: number | null;
  sourceMappings: ISourceMapping[];
  roundRobinCounter: number;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeadAssignmentRuleDocument extends Omit<ILeadAssignmentRule, "id">, Document<string> {
  id: string;
}

const SourceMappingSchema = new Schema<ISourceMapping>(
  {
    sourceId: { type: String, required: true, trim: true },
    salesId: { type: Number, required: true },
  },
  { _id: false }
);

const LeadAssignmentRuleSchema = new Schema<ILeadAssignmentRuleDocument>(
  {
    _id: { type: String, required: true },
    mode: {
      type: String,
      enum: ASSIGNMENT_MODES,
      default: "manual",
      required: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    eligibleSalesIds: {
      type: [Number],
      default: [],
    },
    fallbackSalesId: {
      type: Number,
      default: null,
    },
    sourceMappings: {
      type: [SourceMappingSchema],
      default: [],
    },
    roundRobinCounter: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedBy: {
      type: Number,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
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

LeadAssignmentRuleSchema.virtual("id").get(function () {
  return this._id;
});

tenantScopePlugin(LeadAssignmentRuleSchema);

export const LeadAssignmentRule: Model<ILeadAssignmentRuleDocument> =
  mongoose.models.LeadAssignmentRule ||
  mongoose.model<ILeadAssignmentRuleDocument>("LeadAssignmentRule", LeadAssignmentRuleSchema);

export default LeadAssignmentRule;

