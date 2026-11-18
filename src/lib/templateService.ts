import { QuotationTemplate } from "@/models/QuotationTemplate";
import type { IQuotationTemplateDocument } from "@/models/QuotationTemplate";
import { QuotationTemplateVersion } from "@/models/QuotationTemplateVersion";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  DEFAULT_WORKFLOW_STEPS,
  DEMO_WORKFLOW_STEPS,
  DEMO_DOCUMENT_LAYOUT,
  type QuotationTemplate as QuotationTemplateType,
  type QuotationTemplateVersionSnapshot,
} from "@/types/template";
import { validateWorkflowDependencies } from "@/lib/templateValidation";

export const DEFAULT_TEMPLATE_NAME = "Existing Whyte Quotation (Default)";
export const DEMO_TEMPLATE_NAME = "Demo Template";

/**
 * Ensures an immutable published version record exists in QuotationTemplateVersion
 * for a template and version number. Idempotent.
 */
export async function ensurePublishedVersionRecord(
  template: IQuotationTemplateDocument,
  actorId?: number | string | null
): Promise<void> {
  const versionId = `${template._id}_v${template.version || 1}`;
  const existing = await QuotationTemplateVersion.findById(versionId);
  if (!existing) {
    await QuotationTemplateVersion.create({
      _id: versionId,
      templateId: template._id,
      companyId: template.companyId,
      version: template.version || 1,
      name: template.name,
      description: template.description || null,
      workflow: template.workflow || { steps: [...DEFAULT_WORKFLOW_STEPS] },
      documentLayout: template.documentLayout || null,
      layoutSettings: template.layoutSettings || { ...DEFAULT_LAYOUT_SETTINGS },
      configurableColumns: template.configurableColumns || { ...DEFAULT_CONFIGURABLE_COLUMNS },
      sectionOrder: template.sectionOrder || [...DEFAULT_TEMPLATE_SECTIONS],
      numberingFormat: template.numberingFormat || { ...DEFAULT_NUMBERING_FORMAT },
      customFields: template.customFields || [],
      publishedBy: actorId || null,
      publishedAt: new Date(),
    });
  }
}

/**
 * Ensures a company has both canonical templates:
 * 1. Template 1: "Existing Whyte Quotation (Default)" — exact existing Whyte 5-step workflow & design. Default.
 * 2. Template 2: "Demo Template" — visually distinct 6-step workflow with custom Site Survey step. Not default.
 *
 * Idempotent: Never duplicates, never overrides custom user modifications.
 */
export async function ensureCompanyTemplates(companyId: number): Promise<void> {
  // 1. Verify / Create Template 1: Existing Whyte Quotation (Default)
  let defaultTemplate = await QuotationTemplate.findOne({ companyId, isDefault: true });

  if (!defaultTemplate) {
    // Check if an existing template was previously seeded as "Standard Corporate"
    const legacyStandard = await QuotationTemplate.findOne({ companyId, name: "Standard Corporate" });
    if (legacyStandard) {
      legacyStandard.name = DEFAULT_TEMPLATE_NAME;
      legacyStandard.isDefault = true;
      if (!legacyStandard.workflow || !legacyStandard.workflow.steps) {
        legacyStandard.workflow = { steps: [...DEFAULT_WORKFLOW_STEPS] };
      }
      legacyStandard.version = legacyStandard.version || 1;
      legacyStandard.isPublished = true;
      legacyStandard.updatedAt = new Date();
      await legacyStandard.save();
      defaultTemplate = legacyStandard;
    } else {
      // Check if a template named DEFAULT_TEMPLATE_NAME already exists
      const existingNamedDefault = await QuotationTemplate.findOne({ companyId, name: DEFAULT_TEMPLATE_NAME });
      if (existingNamedDefault) {
        existingNamedDefault.isDefault = true;
        if (!existingNamedDefault.workflow || !existingNamedDefault.workflow.steps) {
          existingNamedDefault.workflow = { steps: [...DEFAULT_WORKFLOW_STEPS] };
        }
        existingNamedDefault.version = existingNamedDefault.version || 1;
        existingNamedDefault.isPublished = true;
        await existingNamedDefault.save();
        defaultTemplate = existingNamedDefault;
      } else {
        // Create canonical Existing Whyte Quotation template
        const newTemplateId = "tmpl_" + Date.now().toString(36) + "_def_" + Math.random().toString(36).slice(2, 6);
        defaultTemplate = await QuotationTemplate.create({
          _id: newTemplateId,
          companyId,
          name: DEFAULT_TEMPLATE_NAME,
          description: "The canonical Whyte Quotation layout with executive cover, full room-by-room device specifications, imagery, commercial summary, and official branding.",
          isDefault: true,
          version: 1,
          isPublished: true,
          workflow: { steps: [...DEFAULT_WORKFLOW_STEPS] },
          numberingFormat: {
            prefix: "QT",
            separator: "-",
            includeYear: true,
            yearFormat: "YYYY",
            digitCount: 3,
            suffix: "",
          },
          layoutSettings: {
            primaryColor: "#09090b",
            accentColor: "#e11d48",
            fontFamily: "inter",
            pageOrientation: "portrait",
            logoPosition: "left",
            showWatermark: false,
            watermarkText: "CONFIDENTIAL",
            showPageNumbers: true,
            compactSpacing: false,
            showDealerContactCard: true,
          },
          configurableColumns: {
            showProductImage: true,
            showProductCode: true,
            showSurfaceFinish: true,
            showAutomationTier: true,
            showUnitPrice: true,
            showTaxPercent: false,
            showLineTotal: true,
            showItemNotes: true,
          },
          sectionOrder: [...DEFAULT_TEMPLATE_SECTIONS],
          customFields: [
            {
              id: "f_arch",
              key: "architectName",
              label: "Architect / Interior Designer",
              type: "text",
              defaultValue: "",
              placeholder: "e.g. Studio Arc Architects",
              required: false,
              section: "metadata",
            },
            {
              id: "f_handover",
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
      }
    }
  }

  // Ensure default template has published version snapshot
  if (defaultTemplate) {
    if (!defaultTemplate.workflow || !defaultTemplate.workflow.steps) {
      defaultTemplate.workflow = { steps: [...DEFAULT_WORKFLOW_STEPS] };
      await defaultTemplate.save();
    }
    await ensurePublishedVersionRecord(defaultTemplate);
  }

  // 2. Verify / Create Template 2: Demo Template (visually distinct alternative, NOT default)
  let existingDemo = await QuotationTemplate.findOne({ companyId, name: DEMO_TEMPLATE_NAME });
  if (!existingDemo) {
    const demoId = "tmpl_" + Date.now().toString(36) + "_demo_" + Math.random().toString(36).slice(2, 6);
    existingDemo = await QuotationTemplate.create({
      _id: demoId,
      companyId,
      name: DEMO_TEMPLATE_NAME,
      description: "Modern architectural sample template demonstrating 6-step workflow, custom Site Survey form, deep teal palette, hidden part codes, disabled intro pages, and distinct custom fields.",
      isDefault: false,
      version: 1,
      isPublished: true,
      workflow: { steps: [...DEMO_WORKFLOW_STEPS] },
      documentLayout: JSON.parse(JSON.stringify(DEMO_DOCUMENT_LAYOUT)),
      numberingFormat: {
        prefix: "DEMO",
        separator: "/",
        includeYear: true,
        yearFormat: "YYYY",
        digitCount: 4,
        suffix: "PR",
      },
      layoutSettings: {
        primaryColor: "#0f766e", // Deep Teal
        accentColor: "#0284c7",  // Ocean Sky
        fontFamily: "outfit",    // Contemporary architectural typography
        pageOrientation: "portrait",
        logoPosition: "left",
        showWatermark: true,
        watermarkText: "PRELIMINARY ESTIMATE",
        showPageNumbers: true,
        compactSpacing: true,    // Compact spacing demonstrated
        showDealerContactCard: true,
      },
      configurableColumns: {
        showProductImage: true,
        showProductCode: false, // Clean look: hidden SKU/part codes
        showSurfaceFinish: true,
        showAutomationTier: true,
        showUnitPrice: true,
        showTaxPercent: false,
        showLineTotal: true,
        showItemNotes: true,
      },
      sectionOrder: [
        { id: "cover", name: "Cover Page", enabled: true, canDisable: false },
        { id: "about_company", name: "About Us / Company Introduction", enabled: false, canDisable: true },
        { id: "project_overview", name: "Project Overview & Scope", enabled: true, canDisable: true },
        { id: "product_series", name: "Brand & Automation Series", enabled: false, canDisable: true },
        { id: "room_breakdown", name: "Room-by-Room Device Specifications", enabled: true, canDisable: false },
        { id: "closing_financials", name: "Investment & Commercial Summary", enabled: true, canDisable: false },
        { id: "terms_and_conditions", name: "Terms & Conditions", enabled: true, canDisable: true },
        { id: "bank_details", name: "Bank & Payment Details", enabled: true, canDisable: true },
      ],
      customFields: [
        {
          id: "f_demo_arch",
          key: "leadArchitect",
          label: "Lead Architect",
          type: "text",
          defaultValue: "Zaha Studio Associates",
          placeholder: "e.g. Zaha Studio Associates",
          required: false,
          section: "metadata",
        },
        {
          id: "f_demo_stage",
          key: "projectStage",
          label: "Project Stage",
          type: "text",
          defaultValue: "rough_in",
          placeholder: "e.g. Electrical Rough-in",
          required: false,
          section: "metadata",
        },
        {
          id: "f_demo_handover",
          key: "targetHandoverDate",
          label: "Project Completion Target",
          type: "date",
          defaultValue: "2026-12-15",
          placeholder: "Target date",
          required: false,
          section: "metadata",
        },
      ],
      createdAt: new Date(Date.now() + 1000),
      updatedAt: new Date(Date.now() + 1000),
    });
  }

  if (existingDemo) {
    let demoNeedsSave = false;
    if (!existingDemo.workflow || !existingDemo.workflow.steps) {
      existingDemo.workflow = { steps: [...DEMO_WORKFLOW_STEPS] };
      demoNeedsSave = true;
    }
    if (!existingDemo.documentLayout) {
      existingDemo.documentLayout = JSON.parse(JSON.stringify(DEMO_DOCUMENT_LAYOUT));
      demoNeedsSave = true;
    }
    if (demoNeedsSave) {
      await existingDemo.save();
    }
    await ensurePublishedVersionRecord(existingDemo);
  }
}

/**
 * Publishes an immutable version snapshot of a template.
 * Validates dependencies before publishing and increments template.version.
 */
export async function publishTemplateVersion(
  companyId: number,
  templateId: string,
  actorId?: number | string | null
): Promise<QuotationTemplateVersionSnapshot> {
  const template = await QuotationTemplate.findOne({ _id: templateId, companyId });
  if (!template) {
    throw new Error("Quotation template not found.");
  }

  // Validate workflow dependencies before publishing
  const workflowSteps = template.workflow?.steps || DEFAULT_WORKFLOW_STEPS;
  const validation = validateWorkflowDependencies(workflowSteps);
  if (!validation.isValid) {
    throw new Error(`Cannot publish workflow: ${validation.errors.join("; ")}`);
  }

  // Determine next version number
  const latestVersion = await QuotationTemplateVersion.findOne({ companyId, templateId }).sort({ version: -1 });
  const nextVersion = Math.max((template.version || 0), (latestVersion?.version || 0)) + 1;
  const versionId = `${templateId}_v${nextVersion}`;

  const published = await QuotationTemplateVersion.create({
    _id: versionId,
    templateId,
    companyId,
    version: nextVersion,
    name: template.name,
    description: template.description || null,
    workflow: template.workflow || { steps: [...DEFAULT_WORKFLOW_STEPS] },
    documentLayout: template.documentLayout || null,
    layoutSettings: template.layoutSettings || { ...DEFAULT_LAYOUT_SETTINGS },
    configurableColumns: template.configurableColumns || { ...DEFAULT_CONFIGURABLE_COLUMNS },
    sectionOrder: template.sectionOrder || [...DEFAULT_TEMPLATE_SECTIONS],
    numberingFormat: template.numberingFormat || { ...DEFAULT_NUMBERING_FORMAT },
    customFields: template.customFields || [],
    publishedBy: actorId || null,
    publishedAt: new Date(),
  });

  // Update working template version and published flag
  template.version = nextVersion;
  template.isPublished = true;
  template.updatedAt = new Date();
  await template.save();

  return published.toJSON() as unknown as QuotationTemplateVersionSnapshot;
}

/**
 * Ensures and returns the default template for a company.
 */
export async function ensureDefaultCompanyTemplate(companyId: number): Promise<IQuotationTemplateDocument> {
  await ensureCompanyTemplates(companyId);
  const defaultTemplate = await QuotationTemplate.findOne({ companyId, isDefault: true });
  if (defaultTemplate) {
    return defaultTemplate;
  }
  const fallback = await QuotationTemplate.findOne({ companyId }).sort({ createdAt: 1 });
  return fallback as IQuotationTemplateDocument;
}

/**
 * Resolves the active template for a quotation.
 * If quotation has templateId and version, resolves from immutable version storage.
 * Otherwise resolves from template document or default template.
 */
export async function resolveQuotationTemplate(
  companyId: number,
  templateId?: string | null,
  version?: number | null
): Promise<QuotationTemplateType> {
  await ensureCompanyTemplates(companyId);

  // 1. Try resolving exact immutable published version if version specified
  if (templateId && typeof version === "number" && version > 0) {
    const versionRecord = await QuotationTemplateVersion.findOne({
      companyId,
      templateId,
      version,
    }).lean();

    if (versionRecord) {
      return {
        ...versionRecord,
        id: versionRecord.templateId,
        _id: versionRecord.templateId,
        isDefault: false,
        isPublished: true,
        createdAt: (versionRecord.publishedAt || new Date()).toISOString(),
        updatedAt: (versionRecord.publishedAt || new Date()).toISOString(),
      } as unknown as QuotationTemplateType;
    }
  }

  // 2. Try resolving active working template by templateId
  if (templateId) {
    const custom = await QuotationTemplate.findOne({ _id: templateId, companyId }).lean();
    if (custom) {
      return custom as unknown as QuotationTemplateType;
    }
  }

  // 3. Fallback to default company template
  const defaultTmpl = await QuotationTemplate.findOne({ companyId, isDefault: true }).lean();
  if (defaultTmpl) {
    return defaultTmpl as unknown as QuotationTemplateType;
  }
  const fallback = await QuotationTemplate.findOne({ companyId }).sort({ createdAt: 1 }).lean();
  return fallback as unknown as QuotationTemplateType;
}
