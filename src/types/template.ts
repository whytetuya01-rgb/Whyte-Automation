/**
 * Quotation Template & Dynamic Workflow Builder Types
 * 
 * Supports:
 * - Dynamic quotation creation workflows (configurable steps, order, custom forms)
 * - Built-in module references (project_details, space_selection, product_config, pricing_review, proposal_preview)
 * - Custom form sections and layout grids (1-col, 2-col, 3-col, card)
 * - Rich field types (text, textarea, number, date, email, phone, select, multiselect, checkbox, radio, image, file)
 * - Server-side validation rules and declarative visibility conditions (zero-eval)
 * - Field-to-document mapping into final proposal & PDF output
 * - Multi-tenant isolation and immutable template versioning
 */

export type TemplateFontFamily = "inter" | "roboto" | "playfair" | "outfit" | "montserrat";
export type TemplatePageOrientation = "portrait" | "landscape";
export type TemplateLogoPosition = "left" | "center" | "right";

// ---------------------------------------------------------------------------
// 1. DYNAMIC FIELD & FORM TYPES
// ---------------------------------------------------------------------------

export type WorkflowFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "image"
  | "file";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "is_not_empty"
  | "is_empty"
  | "in";

export interface FieldVisibilityCondition {
  fieldKey: string;
  operator: ConditionOperator;
  value?: any;
}

export interface FieldValidationRule {
  pattern?: string;
  min?: number;
  max?: number;
  message?: string;
}

export type SectionLayoutType = "single_column" | "two_column" | "three_column" | "card";
export type FieldWidth = "full" | "half" | "third" | "two_thirds";
export type LayoutAlignment = "left" | "center" | "right";
export type LayoutSpacing = "normal" | "compact" | "relaxed";

export interface WorkflowFieldLayout {
  width?: FieldWidth;
  alignment?: LayoutAlignment;
  order?: number;
}

export type DocumentTargetSection =
  | "cover"
  | "project_overview"
  | "closing_financials"
  | "terms_and_conditions"
  | "custom_annexure";

export type DocumentFieldRenderMode =
  | "text"
  | "badge"
  | "image"
  | "keyValue"
  | "full_page_annexure";

export interface FieldDocumentMapping {
  targetSection: DocumentTargetSection;
  displayLabel?: string;
  renderAs?: DocumentFieldRenderMode;
  sortOrder?: number;
}

export type SystemFieldBinding =
  | "clientName"
  | "clientPhone"
  | "clientEmail"
  | "clientGstNumber"
  | "projectName"
  | "clientAddress"
  | "premisesName"
  | "notes"
  | "customerId"
  | "leadId";

export interface WorkflowFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: WorkflowFieldType;
  placeholder?: string;
  defaultValue?: any;
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
  helpText?: string;
  validationRule?: FieldValidationRule;
  validation?: FieldValidationRule;
  visibilityCondition?: FieldVisibilityCondition;
  layout?: WorkflowFieldLayout;
  documentMapping?: FieldDocumentMapping;
  systemBinding?: SystemFieldBinding;
}

export interface WorkflowFormSection {
  id: string;
  title: string;
  description?: string;
  layout: SectionLayoutType;
  spacing?: LayoutSpacing;
  sortOrder: number;
  fields: WorkflowFieldDefinition[];
}

// ---------------------------------------------------------------------------
// 2. WORKFLOW STEP & DEPENDENCY TYPES
// ---------------------------------------------------------------------------

export type BuiltinModuleType =
  | "project_details"
  | "space_selection"
  | "product_config"
  | "pricing_review"
  | "proposal_preview";

export type BuiltInModuleRef = BuiltinModuleType;

export type WorkflowStepModuleType = "builtin" | "custom_form" | "built_in_module";

export interface WorkflowStepDefinition {
  id: string; // e.g. "step_project", "step_survey", "step_spaces", "step_devices", "step_review", "step_preview"
  title: string;
  subtitle?: string;
  description?: string;
  moduleType: WorkflowStepModuleType;
  type?: WorkflowStepModuleType;
  builtinModule?: BuiltinModuleType;
  moduleRef?: BuiltinModuleType;
  sections?: WorkflowFormSection[];
  isOptional?: boolean;
  canSkip?: boolean;
  sortOrder: number;
}

export interface WorkflowDefinition {
  steps: WorkflowStepDefinition[];
}

// ---------------------------------------------------------------------------
// 3. PROPOSAL DOCUMENT CONFIGURATION TYPES
// ---------------------------------------------------------------------------

export interface TemplateConfigurableColumns {
  showProductImage: boolean;
  showProductCode: boolean;
  showSurfaceFinish: boolean;
  showAutomationTier: boolean;
  showUnitPrice: boolean;
  showTaxPercent: boolean;
  showLineTotal: boolean;
  showItemNotes: boolean;
}

export interface TemplateSectionItem {
  id: string;
  name: string;
  enabled: boolean;
  canDisable?: boolean;
}

export interface TemplateLayoutSettings {
  primaryColor: string;
  accentColor: string;
  fontFamily: TemplateFontFamily;
  pageOrientation: TemplatePageOrientation;
  logoPosition: TemplateLogoPosition;
  showWatermark: boolean;
  watermarkText: string;
  showPageNumbers: boolean;
  compactSpacing: boolean;
  showDealerContactCard: boolean;
}

export interface TemplateNumberingFormat {
  prefix: string;
  separator: string;
  includeYear: boolean;
  yearFormat: "YYYY" | "YY";
  digitCount: number;
  suffix?: string;
}

// Legacy custom field type for backwards compatibility with existing metadata
export type TemplateCustomFieldType = "text" | "date" | "number" | "select";
export type TemplateCustomFieldSection = "header" | "footer" | "metadata";

export interface TemplateCustomField {
  id: string;
  key: string;
  label: string;
  type: TemplateCustomFieldType;
  options?: string[];
  defaultValue?: string;
  placeholder?: string;
  required: boolean;
  section: TemplateCustomFieldSection;
}

// ---------------------------------------------------------------------------
// 3B. DYNAMIC DOCUMENT BLOCK & PAGE LAYOUT ENGINE (PHASE 4)
// ---------------------------------------------------------------------------

export type DocumentBlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "company_logo"
  | "banner"
  | "spacer"
  | "divider"
  | "custom_field_display"
  | "customer_details"
  | "project_details"
  | "room_breakdown"
  | "product_table"
  | "pricing_summary"
  | "gst_and_discounts"
  | "terms_and_conditions"
  | "bank_details"
  | "signature_section"
  | "custom_annexure"
  | "page_break";

export interface DocumentBlockLayout {
  width?: "full" | "half" | "third" | "two_thirds";
  alignment?: "left" | "center" | "right";
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  padding?: "none" | "compact" | "normal" | "relaxed";
  marginTop?: number;
  marginBottom?: number;
}

export interface DocumentBlockDefinition {
  id: string;
  type: DocumentBlockType;
  title?: string;
  content?: string;
  fieldKey?: string; // Binds to workflow custom field key
  displayLabel?: string;
  renderMode?: "text" | "badge" | "keyValue" | "image" | "full_page_annexure";
  imageUrl?: string;
  imageAlt?: string;
  level?: 1 | 2 | 3 | 4; // for heading
  layout?: DocumentBlockLayout;
  options?: Record<string, any>;
}

export interface DocumentSectionDefinition {
  id: string;
  title: string;
  enabled: boolean;
  pageBreakBefore?: boolean;
  columns?: 1 | 2 | 3;
  backgroundColor?: string;
  blocks: DocumentBlockDefinition[];
}

export interface DocumentLayoutDefinition {
  version: number;
  sections: DocumentSectionDefinition[];
  pageOrientation?: "portrait" | "landscape";
  header?: {
    showLogo?: boolean;
    showQuotationNumber?: boolean;
    showClientName?: boolean;
    customText?: string;
  };
  footer?: {
    showPageNumbers?: boolean;
    showConfidentialityNotice?: boolean;
    customText?: string;
  };
}

// ---------------------------------------------------------------------------
// 4. TEMPLATE & VERSION SNAPSHOT MODELS
// ---------------------------------------------------------------------------

export interface QuotationTemplateVersionSnapshot {
  id: string; // e.g. "tmpl_..._v1"
  templateId: string;
  companyId: number;
  version: number;
  name: string;
  description?: string | null;
  workflow: WorkflowDefinition;
  documentLayout?: DocumentLayoutDefinition | null;
  layoutSettings: TemplateLayoutSettings;
  configurableColumns: TemplateConfigurableColumns;
  sectionOrder: TemplateSectionItem[];
  numberingFormat: TemplateNumberingFormat;
  customFields: TemplateCustomField[];
  publishedBy?: number | string | null;
  publishedAt: string;
}

export interface QuotationTemplate {
  id: string;
  _id?: string;
  companyId: number;
  name: string;
  description?: string | null;
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
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 5. CANONICAL DEFAULT & DEMO CONSTANTS
// ---------------------------------------------------------------------------

export const CANONICAL_PROJECT_SECTIONS: WorkflowFormSection[] = [
  {
    id: "sec_client_identity",
    title: "Customer & Client Identity",
    description: "Primary client name, contact numbers, and billing details",
    layout: "two_column",
    spacing: "normal",
    sortOrder: 1,
    fields: [
      {
        id: "fld_client_name",
        key: "clientName",
        label: "Client / Customer Name",
        type: "text",
        placeholder: "e.g. Mr. Rajesh Sharma",
        required: true,
        systemBinding: "clientName",
        layout: { width: "half" },
      },
      {
        id: "fld_client_phone",
        key: "clientPhone",
        label: "Primary Phone Number",
        type: "phone",
        placeholder: "+91 98765 43210",
        required: false,
        systemBinding: "clientPhone",
        layout: { width: "half" },
      },
      {
        id: "fld_client_email",
        key: "clientEmail",
        label: "Email Address",
        type: "email",
        placeholder: "client@example.com",
        required: false,
        systemBinding: "clientEmail",
        layout: { width: "half" },
      },
      {
        id: "fld_client_gst",
        key: "clientGstNumber",
        label: "GSTIN Tax Number",
        type: "text",
        placeholder: "29AABCU9603R1ZM",
        required: false,
        systemBinding: "clientGstNumber",
        layout: { width: "half" },
      },
    ],
  },
  {
    id: "sec_project_parameters",
    title: "Project Parameters & Location",
    description: "Site address, property type, and engineering notes",
    layout: "two_column",
    spacing: "normal",
    sortOrder: 2,
    fields: [
      {
        id: "fld_project_name",
        key: "projectName",
        label: "Project / Property Name",
        type: "text",
        placeholder: "e.g. Palm Meadows Villa 14",
        required: false,
        systemBinding: "projectName",
        layout: { width: "half" },
      },
      {
        id: "fld_site_location",
        key: "clientAddress",
        label: "Site Location / Address",
        type: "text",
        placeholder: "City, State or full site address",
        required: false,
        systemBinding: "clientAddress",
        layout: { width: "half" },
      },
      {
        id: "fld_premises_type",
        key: "premisesName",
        label: "Premises / Residence Type",
        type: "text",
        placeholder: "e.g. 4BHK Luxury Villa, Penthouse",
        required: false,
        systemBinding: "premisesName",
        layout: { width: "half" },
      },
      {
        id: "fld_project_notes",
        key: "notes",
        label: "Special Engineering Notes",
        type: "textarea",
        placeholder: "Specific customer requirements or automation preferences...",
        required: false,
        systemBinding: "notes",
        layout: { width: "full" },
      },
    ],
  },
];

export const BLANK_WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  {
    id: "step_intake",
    title: "Customer & Project Intake",
    description: "Capture client information and project requirements",
    moduleType: "custom_form",
    sortOrder: 1,
    sections: [
      {
        id: "sec_intake_client",
        title: "Client Identification",
        description: "Primary client name and contact details",
        layout: "two_column",
        spacing: "normal",
        sortOrder: 1,
        fields: [
          {
            id: "fld_blank_client_name",
            key: "clientName",
            label: "Client / Customer Name",
            type: "text",
            placeholder: "Enter client or company name...",
            required: true,
            systemBinding: "clientName",
            layout: { width: "half" },
          },
          {
            id: "fld_blank_client_phone",
            key: "clientPhone",
            label: "Contact Phone Number",
            type: "phone",
            placeholder: "+91 98765 43210",
            required: false,
            systemBinding: "clientPhone",
            layout: { width: "half" },
          },
          {
            id: "fld_blank_client_email",
            key: "clientEmail",
            label: "Email Address",
            type: "email",
            placeholder: "client@example.com",
            required: false,
            systemBinding: "clientEmail",
            layout: { width: "half" },
          },
          {
            id: "fld_blank_project_desc",
            key: "notes",
            label: "Scope of Work / Project Description",
            type: "textarea",
            placeholder: "Describe the requirements, services, or equipment needed...",
            required: false,
            systemBinding: "notes",
            layout: { width: "full" },
          },
        ],
      },
    ],
  },
];

export const DEFAULT_WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  {
    id: "step_project",
    title: "Project Details",
    description: "Client & Location Information",
    moduleType: "builtin",
    builtinModule: "project_details",
    sortOrder: 1,
    sections: CANONICAL_PROJECT_SECTIONS,
  },
  {
    id: "step_spaces",
    title: "Space Selection",
    description: "Select & Manage Rooms",
    moduleType: "builtin",
    builtinModule: "space_selection",
    sortOrder: 2,
  },
  {
    id: "step_devices",
    title: "Device Configuration",
    description: "Configure Smart Devices & Panels",
    moduleType: "builtin",
    builtinModule: "product_config",
    sortOrder: 3,
  },
  {
    id: "step_review",
    title: "Pricing & Review",
    description: "Commercials, Discounts & GST",
    moduleType: "builtin",
    builtinModule: "pricing_review",
    sortOrder: 4,
  },
  {
    id: "step_preview",
    title: "Proposal Preview",
    description: "Proposal Preview & Export",
    moduleType: "builtin",
    builtinModule: "proposal_preview",
    sortOrder: 5,
  },
];

export const DEMO_WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  {
    id: "step_project",
    title: "Project & Client Info",
    description: "Client details and site location",
    moduleType: "builtin",
    builtinModule: "project_details",
    sortOrder: 1,
    sections: CANONICAL_PROJECT_SECTIONS,
  },
  {
    id: "step_site_survey",
    title: "Site Survey & Architecture",
    description: "Site measurements, stage and floor plans",
    moduleType: "custom_form",
    sortOrder: 2,
    sections: [
      {
        id: "sec_arch_specs",
        title: "Architectural & Site Details",
        description: "Project team and site readiness information",
        layout: "two_column",
        spacing: "normal",
        sortOrder: 1,
        fields: [
          {
            id: "fld_lead_arch",
            key: "leadArchitect",
            label: "Lead Architect / Studio",
            type: "text",
            placeholder: "e.g. Zaha Studio Associates",
            defaultValue: "Zaha Studio Associates",
            required: false,
            layout: { width: "half" },
            documentMapping: {
              targetSection: "cover",
              displayLabel: "Lead Architect",
              renderAs: "keyValue",
            },
          },
          {
            id: "fld_proj_stage",
            key: "projectStage",
            label: "Construction Stage",
            type: "select",
            options: [
              { label: "Conduit & Electrical Rough-in", value: "rough_in" },
              { label: "False Ceiling & Plastering Ready", value: "ceiling_ready" },
              { label: "Final Fit-out & Painting", value: "final_fitout" },
            ],
            defaultValue: "rough_in",
            required: true,
            layout: { width: "half" },
            documentMapping: {
              targetSection: "project_overview",
              displayLabel: "Project Stage",
              renderAs: "badge",
            },
          },
          {
            id: "fld_handover_date",
            key: "targetHandoverDate",
            label: "Target Completion Date",
            type: "date",
            defaultValue: "2026-12-15",
            required: false,
            layout: { width: "half" },
            documentMapping: {
              targetSection: "project_overview",
              displayLabel: "Target Handover",
              renderAs: "keyValue",
            },
          },
          {
            id: "fld_client_email",
            key: "secondaryEmail",
            label: "Alternate Site Coordinator Email",
            type: "email",
            placeholder: "coordinator@example.com",
            required: false,
            layout: { width: "half" },
          },
          {
            id: "fld_floor_plan",
            key: "siteFloorPlan",
            label: "Architectural Floor Plan / Layout Drawing",
            type: "image",
            required: false,
            layout: { width: "full" },
            documentMapping: {
              targetSection: "custom_annexure",
              displayLabel: "Architectural Electrical & Conduit Layout Plan",
              renderAs: "full_page_annexure",
            },
          },
        ],
      },
    ],
  },
  {
    id: "step_spaces",
    title: "Space Allocation",
    description: "Organize project rooms and levels",
    moduleType: "builtin",
    builtinModule: "space_selection",
    sortOrder: 3,
  },
  {
    id: "step_devices",
    title: "Device Specifications",
    description: "Assign luxury automation hardware",
    moduleType: "builtin",
    builtinModule: "product_config",
    sortOrder: 4,
  },
  {
    id: "step_review",
    title: "Commercial Review",
    description: "Review investment, discounts and GST",
    moduleType: "builtin",
    builtinModule: "pricing_review",
    sortOrder: 5,
  },
  {
    id: "step_preview",
    title: "Proposal Preview & Export",
    description: "Generate A4 architectural proposal and PDF",
    moduleType: "builtin",
    builtinModule: "proposal_preview",
    sortOrder: 6,
  },
];

export const DEFAULT_TEMPLATE_SECTIONS: TemplateSectionItem[] = [
  { id: "cover", name: "Cover Page", enabled: true, canDisable: false },
  { id: "about_company", name: "About Us / Company Introduction", enabled: true, canDisable: true },
  { id: "project_overview", name: "Project Overview & Scope", enabled: true, canDisable: true },
  { id: "product_series", name: "Brand & Automation Series", enabled: true, canDisable: true },
  { id: "room_breakdown", name: "Room-by-Room Device Specifications", enabled: true, canDisable: false },
  { id: "closing_financials", name: "Investment & Commercial Summary", enabled: true, canDisable: false },
  { id: "terms_and_conditions", name: "Terms & Conditions", enabled: true, canDisable: true },
  { id: "bank_details", name: "Bank & Payment Details", enabled: true, canDisable: true },
];

export const DEFAULT_CONFIGURABLE_COLUMNS: TemplateConfigurableColumns = {
  showProductImage: true,
  showProductCode: true,
  showSurfaceFinish: true,
  showAutomationTier: true,
  showUnitPrice: true,
  showTaxPercent: false,
  showLineTotal: true,
  showItemNotes: true,
};

export const DEFAULT_LAYOUT_SETTINGS: TemplateLayoutSettings = {
  primaryColor: "#0f172a",
  accentColor: "#c2410c",
  fontFamily: "inter",
  pageOrientation: "portrait",
  logoPosition: "left",
  showWatermark: false,
  watermarkText: "CONFIDENTIAL",
  showPageNumbers: true,
  compactSpacing: false,
  showDealerContactCard: true,
};

export const DEFAULT_NUMBERING_FORMAT: TemplateNumberingFormat = {
  prefix: "QT",
  separator: "-",
  includeYear: true,
  yearFormat: "YYYY",
  digitCount: 4,
  suffix: "",
};

export const DEMO_DOCUMENT_LAYOUT: DocumentLayoutDefinition = {
  version: 1,
  pageOrientation: "portrait",
  header: {
    showLogo: true,
    showQuotationNumber: true,
    showClientName: true,
  },
  footer: {
    showPageNumbers: true,
    showConfidentialityNotice: true,
    customText: "Whyte Architectural Automation • Confidential Client Proposal",
  },
  sections: [
    {
      id: "sec_demo_cover",
      title: "Executive Cover Page",
      enabled: true,
      columns: 1,
      blocks: [
        {
          id: "blk_cov_banner",
          type: "banner",
          title: "ARCHITECTURAL SMART LIVING",
          content: "Engineered Automation Proposal & Technical Specification",
          layout: { width: "full", backgroundColor: "#0f766e", textColor: "#ffffff", padding: "relaxed" },
        },
        {
          id: "blk_cov_spacer1",
          type: "spacer",
          layout: { marginTop: 16, marginBottom: 16 },
        },
        {
          id: "blk_cov_client",
          type: "customer_details",
          title: "Client & Site Identification",
          layout: { width: "half", alignment: "left" },
        },
        {
          id: "blk_cov_project",
          type: "project_details",
          title: "Project Parameters",
          layout: { width: "half", alignment: "left" },
        },
        {
          id: "blk_cov_arch",
          type: "custom_field_display",
          fieldKey: "leadArchitect",
          displayLabel: "Lead Architectural Consultant",
          renderMode: "keyValue",
          layout: { width: "half", backgroundColor: "#f0fdfa", borderColor: "#ccfbf1", padding: "compact" },
        },
        {
          id: "blk_cov_handover",
          type: "custom_field_display",
          fieldKey: "targetHandoverDate",
          displayLabel: "Target Site Handover",
          renderMode: "keyValue",
          layout: { width: "half", backgroundColor: "#f0fdfa", borderColor: "#ccfbf1", padding: "compact" },
        },
      ],
    },
    {
      id: "sec_demo_survey",
      title: "Site Survey & Architectural Scope",
      enabled: true,
      pageBreakBefore: true,
      columns: 1,
      blocks: [
        {
          id: "blk_sur_head",
          type: "heading",
          title: "Site Survey & Conduit Readiness",
          level: 2,
          layout: { width: "full", alignment: "left" },
        },
        {
          id: "blk_sur_desc",
          type: "paragraph",
          content: "Comprehensive electrical survey conducted on site. Below is the approved conduit routing and architectural electrical layout plan for this automation installation.",
          layout: { width: "full", alignment: "left" },
        },
        {
          id: "blk_sur_stage",
          type: "custom_field_display",
          fieldKey: "projectStage",
          displayLabel: "Project Construction Stage",
          renderMode: "badge",
          layout: { width: "full", alignment: "left" },
        },
        {
          id: "blk_sur_plan",
          type: "custom_field_display",
          fieldKey: "siteFloorPlan",
          displayLabel: "Architectural Conduit & Lighting Floor Plan",
          renderMode: "image",
          layout: { width: "full", alignment: "center", padding: "compact" },
        },
      ],
    },
    {
      id: "sec_demo_spaces",
      title: "Configured Living Spaces",
      enabled: true,
      pageBreakBefore: true,
      columns: 1,
      blocks: [
        {
          id: "blk_spc_head",
          type: "heading",
          title: "Space-by-Space Automation Allocation",
          level: 2,
          layout: { width: "full" },
        },
        {
          id: "blk_spc_list",
          type: "room_breakdown",
          title: "Configured Architectural Spaces",
          layout: { width: "full" },
        },
      ],
    },
    {
      id: "sec_demo_products",
      title: "Hardware Specifications",
      enabled: true,
      pageBreakBefore: true,
      columns: 1,
      blocks: [
        {
          id: "blk_prd_head",
          type: "heading",
          title: "Luxury Automation Device Bill of Materials",
          level: 2,
          layout: { width: "full" },
        },
        {
          id: "blk_prd_table",
          type: "product_table",
          title: "Device Specification Matrix",
          layout: { width: "full" },
        },
      ],
    },
    {
      id: "sec_demo_financials",
      title: "Investment & Commercial Summary",
      enabled: true,
      pageBreakBefore: true,
      columns: 1,
      blocks: [
        {
          id: "blk_fin_head",
          type: "heading",
          title: "Commercial Investment Summary",
          level: 2,
          layout: { width: "full" },
        },
        {
          id: "blk_fin_summary",
          type: "pricing_summary",
          title: "Total Investment",
          layout: { width: "full" },
        },
        {
          id: "blk_fin_gst",
          type: "gst_and_discounts",
          title: "GST (18%) & Authorized Dealer Discounts",
          layout: { width: "full" },
        },
        {
          id: "blk_fin_bank",
          type: "bank_details",
          title: "Payment Transfer & Escrow Details",
          layout: { width: "full" },
        },
        {
          id: "blk_fin_terms",
          type: "terms_and_conditions",
          title: "Standard Commercial Terms & Warranty Clauses",
          layout: { width: "full" },
        },
      ],
    },
    {
      id: "sec_demo_annexure",
      title: "Technical Annexure & Client Sign-off",
      enabled: true,
      pageBreakBefore: true,
      columns: 1,
      blocks: [
        {
          id: "blk_anx_head",
          type: "heading",
          title: "Technical SLD & Acceptance Annexure",
          level: 2,
          layout: { width: "full" },
        },
        {
          id: "blk_anx_schematic",
          type: "custom_annexure",
          title: "Single Line Diagram (SLD) Schematic & Load Schedule",
          content: "All conduits, neutral loops, and dimming circuits must comply with IEC 60364-7 standards.",
          layout: { width: "full" },
        },
        {
          id: "blk_anx_sig",
          type: "signature_section",
          title: "Formal Client Approval & Execution Sign-Off",
          layout: { width: "full", marginTop: 20 },
        },
      ],
    },
  ],
};
