/**
 * Quotation Template Designer Types
 * 
 * Supports:
 * - Multiple templates per company tenant
 * - Custom fields (header, footer, metadata)
 * - Configurable device table columns (hide/show unit price, photos, codes, etc.)
 * - Section ordering & visibility toggles
 * - Visual layout & styling settings (colors, fonts, watermarks, orientation)
 * - Dynamic quotation numbering formats
 */

export type TemplateFontFamily = "inter" | "roboto" | "playfair" | "outfit" | "montserrat";
export type TemplatePageOrientation = "portrait" | "landscape";
export type TemplateLogoPosition = "left" | "center" | "right";
export type TemplateCustomFieldType = "text" | "date" | "number" | "select";
export type TemplateCustomFieldSection = "header" | "footer" | "metadata";

export interface TemplateCustomField {
  id: string;
  key: string;
  label: string;
  type: TemplateCustomFieldType;
  options?: string[]; // choices for select dropdown
  defaultValue?: string;
  placeholder?: string;
  required: boolean;
  section: TemplateCustomFieldSection;
}

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
  id: string; // "cover" | "about_company" | "project_overview" | "product_series" | "room_breakdown" | "closing_financials" | "terms_and_conditions" | "bank_details"
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

export interface QuotationTemplate {
  id: string;
  _id?: string;
  companyId: number;
  name: string;
  description?: string;
  isDefault: boolean;
  numberingFormat: TemplateNumberingFormat;
  layoutSettings: TemplateLayoutSettings;
  configurableColumns: TemplateConfigurableColumns;
  sectionOrder: TemplateSectionItem[];
  customFields: TemplateCustomField[];
  createdAt: string;
  updatedAt: string;
}

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
