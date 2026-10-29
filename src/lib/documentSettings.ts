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
  logoUrl: string | null;
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
    logoUrl: safeHttpsUrl(company?.logoUrl),
    fileName: (quotationNumber) => `${quotationNumber || "Proposal"}_${legacy ? legacy.fileSuffix : slugForFileName(brandName) || "Proposal"}.pdf`,
  };
}
