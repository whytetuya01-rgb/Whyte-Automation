import { QuotationTemplate } from "@/models/QuotationTemplate";
import type { IQuotationTemplateDocument } from "@/models/QuotationTemplate";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  type QuotationTemplate as QuotationTemplateType,
} from "@/types/template";

/**
 * Ensures a company has at least one default template ("Standard Corporate").
 * If no templates exist for the company, automatically creates and returns it.
 */
export async function ensureDefaultCompanyTemplate(companyId: number): Promise<IQuotationTemplateDocument> {
  let defaultTemplate = await QuotationTemplate.findOne({ companyId, isDefault: true });
  if (defaultTemplate) {
    return defaultTemplate;
  }

  // Check if any template exists at all for this company
  const anyTemplate = await QuotationTemplate.findOne({ companyId }).sort({ createdAt: 1 });
  if (anyTemplate) {
    anyTemplate.isDefault = true;
    await anyTemplate.save();
    return anyTemplate;
  }

  // Seed standard default corporate template
  const newTemplateId = "tmpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  defaultTemplate = await QuotationTemplate.create({
    _id: newTemplateId,
    companyId,
    name: "Standard Corporate",
    description: "Standard executive proposal with comprehensive device breakdown, imagery, and commercial summary.",
    isDefault: true,
    numberingFormat: { ...DEFAULT_NUMBERING_FORMAT },
    layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
    configurableColumns: { ...DEFAULT_CONFIGURABLE_COLUMNS },
    sectionOrder: [...DEFAULT_TEMPLATE_SECTIONS],
    customFields: [
      {
        id: "field_architect",
        key: "architectName",
        label: "Architect / Interior Designer",
        type: "text",
        defaultValue: "",
        placeholder: "e.g. Studio Arc Architects",
        required: false,
        section: "metadata",
      },
      {
        id: "field_handover",
        key: "targetHandoverDate",
        label: "Expected Handover Date",
        type: "date",
        defaultValue: "",
        placeholder: "Select expected completion date",
        required: false,
        section: "metadata",
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return defaultTemplate;
}

/**
 * Resolves the active template for a quotation.
 * If quotation has templateId, fetches that template; otherwise falls back to company default template.
 */
export async function resolveQuotationTemplate(
  companyId: number,
  templateId?: string | null
): Promise<QuotationTemplateType> {
  if (templateId) {
    const custom = await QuotationTemplate.findOne({ _id: templateId, companyId }).lean();
    if (custom) {
      return custom as unknown as QuotationTemplateType;
    }
  }

  const defaultTmpl = await ensureDefaultCompanyTemplate(companyId);
  return defaultTmpl.toJSON() as unknown as QuotationTemplateType;
}
