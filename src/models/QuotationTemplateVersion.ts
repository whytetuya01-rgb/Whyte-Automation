import mongoose, { Schema, Document, Model } from "mongoose";
import type {
  WorkflowDefinition,
  DocumentLayoutDefinition,
  TemplateLayoutSettings,
  TemplateConfigurableColumns,
  TemplateSectionItem,
  TemplateNumberingFormat,
  TemplateCustomField,
} from "@/types/template";

export interface IQuotationTemplateVersionDocument extends Document<string> {
  _id: string;
  id: string;
  templateId: string;
  companyId: number;
  version: number;
  name: string;
  description: string | null;
  workflow: WorkflowDefinition;
  documentLayout?: DocumentLayoutDefinition | null;
  layoutSettings: TemplateLayoutSettings;
  configurableColumns: TemplateConfigurableColumns;
  sectionOrder: TemplateSectionItem[];
  numberingFormat: TemplateNumberingFormat;
  customFields: TemplateCustomField[];
  publishedBy: number | string | null;
  publishedAt: Date;
}

const QuotationTemplateVersionSchema = new Schema<IQuotationTemplateVersionDocument>(
  {
    _id: { type: String, required: true },
    templateId: { type: String, required: true, index: true },
    companyId: { type: Number, required: true, index: true },
    version: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    workflow: { type: Schema.Types.Mixed, required: true },
    documentLayout: { type: Schema.Types.Mixed, default: null },
    layoutSettings: { type: Schema.Types.Mixed, required: true },
    configurableColumns: { type: Schema.Types.Mixed, required: true },
    sectionOrder: { type: Schema.Types.Mixed, required: true },
    numberingFormat: { type: Schema.Types.Mixed, required: true },
    customFields: { type: Schema.Types.Mixed, default: [] },
    publishedBy: { type: Schema.Types.Mixed, default: null },
    publishedAt: { type: Date, default: Date.now },
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

QuotationTemplateVersionSchema.virtual("id").get(function () {
  return this._id;
});

// Enforce unique version per template per company
QuotationTemplateVersionSchema.index(
  { companyId: 1, templateId: 1, version: 1 },
  { unique: true }
);

export const QuotationTemplateVersion: Model<IQuotationTemplateVersionDocument> =
  mongoose.models.QuotationTemplateVersion ||
  mongoose.model<IQuotationTemplateVersionDocument>(
    "QuotationTemplateVersion",
    QuotationTemplateVersionSchema
  );
