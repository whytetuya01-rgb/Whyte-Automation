import mongoose, { Schema, Document, Model } from "mongoose";
import type {
  TemplateNumberingFormat,
  TemplateLayoutSettings,
  TemplateConfigurableColumns,
  TemplateSectionItem,
  TemplateCustomField,
  WorkflowDefinition,
  DocumentLayoutDefinition,
} from "@/types/template";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  DEFAULT_WORKFLOW_STEPS,
} from "@/types/template";

export interface IQuotationTemplate {
  _id: string;
  id?: string;
  companyId: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  version: number;
  isPublished: boolean;
  workflow: WorkflowDefinition;
  documentLayout?: DocumentLayoutDefinition | null;
  numberingFormat: TemplateNumberingFormat;
  layoutSettings: TemplateLayoutSettings;
  configurableColumns: TemplateConfigurableColumns;
  sectionOrder: TemplateSectionItem[];
  customFields: TemplateCustomField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuotationTemplateDocument extends Omit<IQuotationTemplate, "id">, Document<string> {
  id: string;
}

const NumberingFormatSchema = new Schema(
  {
    prefix: { type: String, default: "QT", trim: true },
    separator: { type: String, default: "-", trim: true },
    includeYear: { type: Boolean, default: true },
    yearFormat: { type: String, enum: ["YYYY", "YY"], default: "YYYY" },
    digitCount: { type: Number, default: 4, min: 2, max: 8 },
    suffix: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const LayoutSettingsSchema = new Schema(
  {
    primaryColor: { type: String, default: "#0f172a" },
    accentColor: { type: String, default: "#c2410c" },
    fontFamily: {
      type: String,
      enum: ["inter", "roboto", "playfair", "outfit", "montserrat"],
      default: "inter",
    },
    pageOrientation: { type: String, enum: ["portrait", "landscape"], default: "portrait" },
    logoPosition: { type: String, enum: ["left", "center", "right"], default: "left" },
    showWatermark: { type: Boolean, default: false },
    watermarkText: { type: String, default: "CONFIDENTIAL" },
    showPageNumbers: { type: Boolean, default: true },
    compactSpacing: { type: Boolean, default: false },
    showDealerContactCard: { type: Boolean, default: true },
  },
  { _id: false }
);

const ConfigurableColumnsSchema = new Schema(
  {
    showProductImage: { type: Boolean, default: true },
    showProductCode: { type: Boolean, default: true },
    showSurfaceFinish: { type: Boolean, default: true },
    showAutomationTier: { type: Boolean, default: true },
    showUnitPrice: { type: Boolean, default: true },
    showTaxPercent: { type: Boolean, default: false },
    showLineTotal: { type: Boolean, default: true },
    showItemNotes: { type: Boolean, default: true },
  },
  { _id: false }
);

const SectionItemSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    canDisable: { type: Boolean, default: true },
  },
  { _id: false }
);

const CustomFieldSchema = new Schema(
  {
    id: { type: String, required: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, default: "text" },
    options: { type: [String], default: [] },
    defaultValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    required: { type: Boolean, default: false },
    section: { type: String, default: "metadata" },
  },
  { _id: false }
);

const QuotationTemplateSchema = new Schema<IQuotationTemplateDocument>(
  {
    _id: { type: String, required: true },
    companyId: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    isDefault: { type: Boolean, default: false, index: true },
    version: { type: Number, default: 1 },
    isPublished: { type: Boolean, default: true },
    workflow: { type: Schema.Types.Mixed, default: () => ({ steps: [...DEFAULT_WORKFLOW_STEPS] }) },
    documentLayout: { type: Schema.Types.Mixed, default: null },
    numberingFormat: { type: NumberingFormatSchema, default: () => ({ ...DEFAULT_NUMBERING_FORMAT }) },
    layoutSettings: { type: LayoutSettingsSchema, default: () => ({ ...DEFAULT_LAYOUT_SETTINGS }) },
    configurableColumns: { type: ConfigurableColumnsSchema, default: () => ({ ...DEFAULT_CONFIGURABLE_COLUMNS }) },
    sectionOrder: { type: [SectionItemSchema], default: () => [...DEFAULT_TEMPLATE_SECTIONS] },
    customFields: { type: [CustomFieldSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
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

QuotationTemplateSchema.virtual("id").get(function () {
  return this._id;
});

// Index to ensure fast querying per company and template name uniqueness per company
QuotationTemplateSchema.index({ companyId: 1, name: 1 }, { unique: true });
QuotationTemplateSchema.index({ companyId: 1, isDefault: 1 });

export const QuotationTemplate: Model<IQuotationTemplateDocument> =
  mongoose.models.QuotationTemplate ||
  mongoose.model<IQuotationTemplateDocument>("QuotationTemplate", QuotationTemplateSchema);
