import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";

/**
 * Per-company quotation document content: contact card, footer line, social links, automation label and the
 * introduction pages. Shared by the server (validation, footer) and the client (PDF preview, settings editor).
 *
 * Nothing company-specific is hard-coded in the document any more. The one exception is the legacy default company
 * (slug `whyte-automations`), which keeps its existing literal text until it saves settings of its own, so no
 * already-issued look changes. Every other company starts neutral: its own profile data, no Whyte marketing.
 */

export const SOCIAL_NETWORKS = ["linkedin", "instagram", "youtube", "facebook", "whatsapp"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

/** Hosts accepted per network (a LinkedIn field cannot point at an arbitrary site). */
export const SOCIAL_HOSTS: Record<SocialNetwork, readonly string[]> = {
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.com"],
  // Click-to-chat (wa.me/<number>, api.whatsapp.com/send?phone=…), business message links and channels.
  whatsapp: ["wa.me", "whatsapp.com"],
};

/**
 * `standard` – the built-in Whyte "About" and "Project Overview" pages (only the default company may use them: the
 *              text and images are Whyte's own marketing).
 * `custom`   – one About page written by the company (title, text, up to four highlights).
 * `none`     – no introduction pages; the document goes straight to the project.
 */
export const INTRO_PAGE_MODES = ["standard", "custom", "none"] as const;
export type IntroPageMode = (typeof INTRO_PAGE_MODES)[number];

export interface AboutHighlight {
  title: string;
  text: string;
}

/**
 * Every fixed heading and label in the quotation document. A company can reword any of them; an unset (or blank)
 * label shows the default below, which is exactly the document's long-standing text, so nothing changes until a
 * company edits it. Labels shown in capitals keep their default wording here: the capitals come from styling.
 */
export const DOCUMENT_LABEL_DEFAULTS = {
  coverTitle: "Smart Automation Proposal",
  quotationReference: "Quotation Reference",
  preparedFor: "Prepared exclusively for",
  projectType: "Project Type",
  automationTypeLabel: "Automation Type",
  projectScope: "Project Scope",
  totalInvestment: "Total Investment",
  productsEyebrow: "Proposed Smart Equipment & Specifications",
  productsTitle: "Product Summary & Specifications",
  productsSubtitle: "Room-wise equipment details, panel specifications & itemized pricing",
  spaceCaption: "Smart Space Configuration",
  continuedBadge: "Continued",
  continuedNote: "Continued on next page",
  spaceNote: "Space Note",
  locationLabel: "Location",
  perUnit: "per unit",
  lineTotal: "Total",
  noImage: "No image",
  siteFallback: "Site Location",
  projectTypeFallback: "Residential Smart Home",
  closingEyebrow: "Pricing & Commercial Summary",
  closingTitle: "Investment & Next Steps",
  financialSummary: "Financial Summary",
  investmentOverview: "Investment Overview",
  subtotal: "Subtotal",
  discount: "Discount",
  netSubtotal: "Net Subtotal",
  netSubtotalNote: "Taxable amount after discount",
  taxSummary: "Tax Summary",
  grandTotal: "Grand Total",
  grandTotalNote: "Total Investment (Incl. Taxes)",
  estimateTitle: "Estimated Project Investment",
  estimateNote: "Final pricing is based on the products and configuration selected in this proposal.",
  includesTitle: "Proposal Includes",
  termsTitle: "Commercial Terms & Validity",
  validityLabel: "Validity",
  termsLabel: "Terms",
  remarksLabel: "Remarks",
  nextStepsTitle: "Next Steps",
} as const;

export type DocumentLabelKey = keyof typeof DOCUMENT_LABEL_DEFAULTS;
export const DOCUMENT_LABEL_KEYS = Object.keys(DOCUMENT_LABEL_DEFAULTS) as DocumentLabelKey[];

/** Per-label length limits: the document is a fixed A4 layout, so long text would overflow its box. */
export const DOCUMENT_LABEL_LIMITS: Record<DocumentLabelKey, number> = {
  coverTitle: 40,
  quotationReference: 40,
  preparedFor: 40,
  projectType: 30,
  automationTypeLabel: 30,
  projectScope: 30,
  totalInvestment: 40,
  productsEyebrow: 70,
  productsTitle: 50,
  productsSubtitle: 120,
  spaceCaption: 40,
  continuedBadge: 20,
  continuedNote: 40,
  spaceNote: 30,
  locationLabel: 20,
  perUnit: 20,
  lineTotal: 20,
  noImage: 20,
  siteFallback: 40,
  projectTypeFallback: 40,
  closingEyebrow: 70,
  closingTitle: 50,
  financialSummary: 40,
  investmentOverview: 40,
  subtotal: 30,
  discount: 30,
  netSubtotal: 30,
  netSubtotalNote: 60,
  taxSummary: 30,
  grandTotal: 30,
  grandTotalNote: 60,
  estimateTitle: 50,
  estimateNote: 160,
  includesTitle: 40,
  termsTitle: 50,
  validityLabel: 30,
  termsLabel: 30,
  remarksLabel: 30,
  nextStepsTitle: 40,
};

/** How the editor groups the labels, in document order. */
export const DOCUMENT_LABEL_GROUPS: ReadonlyArray<{ title: string; keys: readonly DocumentLabelKey[] }> = [
  {
    title: "Cover page",
    keys: ["coverTitle", "quotationReference", "preparedFor", "projectType", "automationTypeLabel", "projectScope", "totalInvestment", "siteFallback", "projectTypeFallback"],
  },
  {
    title: "Products section",
    keys: ["productsEyebrow", "productsTitle", "productsSubtitle", "spaceCaption", "continuedBadge", "continuedNote", "spaceNote", "locationLabel", "perUnit", "lineTotal", "noImage"],
  },
  {
    title: "Pricing page",
    keys: ["closingEyebrow", "closingTitle", "financialSummary", "investmentOverview", "subtotal", "discount", "netSubtotal", "netSubtotalNote", "taxSummary", "grandTotal", "grandTotalNote", "estimateTitle", "estimateNote"],
  },
  { title: "Terms & next steps", keys: ["includesTitle", "termsTitle", "validityLabel", "termsLabel", "remarksLabel", "nextStepsTitle"] },
];

export const DOCUMENT_LABEL_NAMES: Record<DocumentLabelKey, string> = {
  coverTitle: "Cover title",
  quotationReference: "Quotation reference label",
  preparedFor: "Prepared-for label",
  projectType: "Project type label",
  automationTypeLabel: "Automation type label",
  projectScope: "Project scope label",
  totalInvestment: "Total investment label",
  productsEyebrow: "Products section eyebrow",
  productsTitle: "Products section title",
  productsSubtitle: "Products section subtitle",
  spaceCaption: "Space caption",
  continuedBadge: "Continued badge",
  continuedNote: "Continued-on-next-page note",
  spaceNote: "Space note label",
  locationLabel: "Location label",
  perUnit: "Per-unit label",
  lineTotal: "Line total label",
  noImage: "No-image placeholder",
  siteFallback: "Address placeholder (no client address)",
  projectTypeFallback: "Project type placeholder (none chosen)",
  closingEyebrow: "Pricing page eyebrow",
  closingTitle: "Pricing page title",
  financialSummary: "Financial summary heading",
  investmentOverview: "Financial summary caption",
  subtotal: "Subtotal label",
  discount: "Discount label",
  netSubtotal: "Net subtotal label",
  netSubtotalNote: "Net subtotal note",
  taxSummary: "Tax summary heading",
  grandTotal: "Grand total label",
  grandTotalNote: "Grand total note",
  estimateTitle: "Estimate box heading",
  estimateNote: "Estimate box note",
  includesTitle: "Proposal-includes heading",
  termsTitle: "Terms box heading",
  validityLabel: "Validity label",
  termsLabel: "Terms label",
  remarksLabel: "Remarks label",
  nextStepsTitle: "Next steps heading",
};

export interface NextStep {
  title: string;
  text: string;
}

/** The fixed "Proposal Includes" lines (the selected tier / finish lines are added automatically after the first two). */
export const DEFAULT_PROPOSAL_INCLUDES: readonly string[] = [
  "Selected smart automation products",
  "Room-wise space configuration & mapping",
  "Product-specific installation location references",
  "Project-wise pricing and investment breakdown",
];

export const DEFAULT_NEXT_STEPS: readonly NextStep[] = [
  { title: "Review", text: "Review the proposed automation configuration." },
  { title: "Confirm", text: "Confirm product selection and quantities." },
  { title: "Align", text: "Confirm on-site installation requirements." },
  { title: "Proceed", text: "Proceed with final order & commissioning." },
];

/** Used when a quotation has no validity date of its own. */
export const DEFAULT_VALIDITY_DAYS = 30;

export interface DocumentSettings {
  legalName?: string | null;
  website?: string | null;
  footerText?: string | null;
  automationType?: string | null;
  socialLinks?: Partial<Record<SocialNetwork, string | null>> | null;
  introPages?: IntroPageMode | null;
  aboutTitle?: string | null;
  aboutBody?: string | null;
  aboutHighlights?: AboutHighlight[] | null;
  /** Reworded headings and labels (unset or blank = the default wording). */
  labels?: Partial<Record<DocumentLabelKey, string | null>> | null;
  /** The "Proposal Includes" lines; unset = the default list, empty = no fixed lines. */
  includes?: string[] | null;
  /** The "Next Steps" boxes; unset = the default four, empty = the section is hidden. */
  nextSteps?: NextStep[] | null;
  /** Validity shown when a quotation has no validity date of its own (days from the date of issue). */
  defaultValidityDays?: number | null;
  /** Terms shown when a quotation has no terms of its own. */
  defaultTerms?: string | null;
}

export const DOCUMENT_LIMITS = {
  legalName: 160,
  website: 200,
  footerText: 120,
  automationType: 80,
  socialUrl: 300,
  aboutTitle: 120,
  aboutBody: 1200,
  highlights: 4,
  highlightTitle: 60,
  highlightText: 200,
  includes: 6,
  includeItem: 120,
  nextSteps: 4,
  stepTitle: 30,
  stepText: 100,
  validityDaysMin: 1,
  validityDaysMax: 365,
  defaultTerms: 600,
} as const;

export interface SocialLinkItem {
  id: SocialNetwork;
  name: string;
  url: string;
  ariaLabel: string;
}

/** The Company fields the document reads (a subset of the Company type, so server and client rows both fit). */
export interface DocumentCompanyInput {
  slug?: string | null;
  name?: string | null;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  documentSettings?: DocumentSettings | null;
}

export interface ProposalContent {
  /** The company uses Whyte's built-in text and intro pages (default company with nothing customised). */
  isDefaultCompany: boolean;
  brandName: string;
  legalName: string;
  tagline: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  website: { url: string; label: string } | null;
  /** Left side of every page footer (usually the website); null hides it. */
  footerText: string | null;
  automationType: string;
  /** Small label beside the logo in the running page header. */
  headerLabel: string;
  /** Large, very faint text behind content pages. */
  watermark: string;
  /** Short name in "Connect with …" beside the social links. */
  connectName: string;
  socialLinks: SocialLinkItem[];
  introPages: IntroPageMode;
  about: { title: string; body: string; highlights: AboutHighlight[] } | null;
  /** Every heading and label, reworded or default. */
  text: Record<DocumentLabelKey, string>;
  /** "Proposal Includes" lines (the selected tier / finish lines are added by the document). */
  includes: string[];
  nextSteps: NextStep[];
  validityDays: number;
  defaultTerms: string | null;
  logoUrl: string | null;
  /** The company's own cover picture (replaces the default company's built-in illustration). */
  coverImageUrl: string | null;
  /** Download file name, e.g. `QT-2026-001_Acme_Homes.pdf`. */
  fileName: (quotationNumber: string | null | undefined) => string;
}

/** The default company's long-standing links. It never had a WhatsApp link, so none is invented for it. */
export const WHYTE_SOCIAL_URLS: Partial<Record<SocialNetwork, string>> = {
  linkedin: "https://www.linkedin.com/company/whyte-automations-pvt.-ltd/",
  instagram: "https://www.instagram.com/whyte_intelligent_spaces/",
  youtube: "https://www.youtube.com/channel/UCsKv2cjMaRZBoGbtQ9R0l4Q",
  facebook: "https://www.facebook.com/whyte.intelligent.space",
};

/** What the default company's document has always said, kept as its starting values. */
const WHYTE_DEFAULTS = {
  brandName: "Whyte Automations",
  legalName: "Whyte Automations Private Limited",
  tagline: "Next-Gen Smart Living",
  addressLine: "Gandhinagar, Gujarat, India",
  phone: "+91 98982 34336 / +91 98989 26336",
  email: "sales@whyte.co.in",
  website: "https://whyte.co.in/",
  footerText: "www.whyte.co.in",
  automationType: "Whyte Smart Living Ecosystem",
  headerLabel: "Smart Living Ecosystems",
  watermark: "WHYTE",
  connectName: "Whyte",
  fileSuffix: "Whyte_Automation",
} as const;

const NEUTRAL_AUTOMATION_TYPE = "Smart Home Automation";

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/** Host shown for a website URL ("https://www.acme.com/" → "www.acme.com"). */
export function websiteLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Only an absolute https URL is ever rendered as a link. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** True when `url` is https and its host belongs to `network`. */
export function isSocialUrl(network: SocialNetwork, url: string): boolean {
  const safe = safeHttpsUrl(url);
  if (!safe) return false;
  const host = new URL(safe).hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS[network].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function resolveSocialLinks(
  stored: DocumentSettings["socialLinks"],
  brandName: string,
  isDefaultCompany: boolean
): SocialLinkItem[] {
  const links: SocialLinkItem[] = [];
  for (const id of SOCIAL_NETWORKS) {
    const configured = stored?.[id];
    const url = safeHttpsUrl(configured) ?? (isDefaultCompany && configured === undefined ? WHYTE_SOCIAL_URLS[id] ?? null : null);
    if (url && isSocialUrl(id, url)) {
      links.push({ id, name: SOCIAL_LABELS[id], url, ariaLabel: `${brandName} on ${SOCIAL_LABELS[id]}` });
    }
  }
  return links;
}

export function slugForFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * The document content for one company. The company is whatever the caller passes in (the server always derives it
 * from the session), so there is no ambient state and no way to pick another company's text.
 */
export function resolveProposalContent(company: DocumentCompanyInput | null | undefined): ProposalContent {
  const settings = company?.documentSettings ?? null;
  const isDefaultCompany = company?.slug === DEFAULT_COMPANY_SLUG;
  const legacy = isDefaultCompany ? WHYTE_DEFAULTS : null;

  const brandName = clean(company?.name) ?? legacy?.brandName ?? "Your Company";
  const legalName = clean(settings?.legalName) ?? legacy?.legalName ?? brandName;
  const websiteUrl = safeHttpsUrl(settings?.website) ?? (legacy && settings?.website === undefined ? legacy.website : null);
  const website = websiteUrl ? { url: websiteUrl, label: websiteLabel(websiteUrl) } : null;

  // Default company: untouched legacy literals until it customises. Everyone else: their own profile.
  const customised = settings !== null && Object.keys(settings).length > 0;
  const useLegacyContact = Boolean(legacy) && !customised;

  let introPages: IntroPageMode = settings?.introPages ?? (isDefaultCompany ? "standard" : "none");
  if (introPages === "standard" && !isDefaultCompany) introPages = "none";
  const aboutBody = clean(settings?.aboutBody);
  const aboutTitle = clean(settings?.aboutTitle) ?? `About ${brandName}`;
  const highlights = (settings?.aboutHighlights ?? []).filter((item) => clean(item?.title) && clean(item?.text)).slice(0, DOCUMENT_LIMITS.highlights);
  const about = introPages === "custom" && aboutBody ? { title: aboutTitle, body: aboutBody, highlights } : null;
  if (introPages === "custom" && !about) introPages = "none";

  const text = Object.fromEntries(
    DOCUMENT_LABEL_KEYS.map((key) => [key, clean(settings?.labels?.[key])?.slice(0, DOCUMENT_LABEL_LIMITS[key]) ?? DOCUMENT_LABEL_DEFAULTS[key]])
  ) as Record<DocumentLabelKey, string>;
  const includes = Array.isArray(settings?.includes)
    ? settings.includes.map((item) => clean(item)).filter((item): item is string => Boolean(item)).slice(0, DOCUMENT_LIMITS.includes)
    : [...DEFAULT_PROPOSAL_INCLUDES];
  const nextSteps = Array.isArray(settings?.nextSteps)
    ? settings.nextSteps
        .map((step) => ({ title: clean(step?.title) ?? "", text: clean(step?.text) ?? "" }))
        .filter((step) => step.title && step.text)
        .slice(0, DOCUMENT_LIMITS.nextSteps)
    : DEFAULT_NEXT_STEPS.map((step) => ({ ...step }));
  const days = settings?.defaultValidityDays;
  const validityDays =
    typeof days === "number" && Number.isInteger(days) && days >= DOCUMENT_LIMITS.validityDaysMin && days <= DOCUMENT_LIMITS.validityDaysMax ? days : DEFAULT_VALIDITY_DAYS;

  return {
    isDefaultCompany,
    brandName,
    legalName,
    tagline: useLegacyContact ? legacy!.tagline : clean(company?.tagline) ?? (legacy ? legacy.tagline : null),
    addressLine: useLegacyContact ? legacy!.addressLine : clean(company?.address)?.replace(/\s*\n\s*/g, ", ") ?? legacy?.addressLine ?? null,
    phone: useLegacyContact ? legacy!.phone : clean(company?.phone) ?? legacy?.phone ?? null,
    email: useLegacyContact ? legacy!.email : clean(company?.email) ?? legacy?.email ?? null,
    website,
    footerText: clean(settings?.footerText) ?? (legacy && settings?.footerText === undefined ? legacy.footerText : null) ?? (website ? website.label : null),
    automationType: clean(settings?.automationType) ?? legacy?.automationType ?? NEUTRAL_AUTOMATION_TYPE,
    headerLabel: legacy ? legacy.headerLabel : clean(company?.tagline) ?? clean(settings?.automationType) ?? NEUTRAL_AUTOMATION_TYPE,
    watermark: legacy ? legacy.watermark : brandName.toUpperCase().slice(0, 14),
    connectName: legacy ? legacy.connectName : brandName,
    socialLinks: resolveSocialLinks(settings?.socialLinks, brandName, isDefaultCompany),
    introPages,
    about,
    text,
    includes,
    nextSteps,
    validityDays,
    defaultTerms: clean(settings?.defaultTerms),
    logoUrl: safeHttpsUrl(company?.logoUrl),
    coverImageUrl: safeHttpsUrl(company?.coverImageUrl),
    fileName: (quotationNumber) => `${quotationNumber || "Proposal"}_${legacy ? legacy.fileSuffix : slugForFileName(brandName) || "Proposal"}.pdf`,
  };
}
