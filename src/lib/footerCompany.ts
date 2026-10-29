import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { getAuthenticatedActor } from "@/lib/api-auth";
import { resolveSocialLinks, type SocialLinkItem } from "@/lib/documentSettings";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";

export interface FooterCompany {
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  /** The company's own social links (none until it adds some; the default company keeps Whyte's). */
  socialLinks: SocialLinkItem[];
}

const FALLBACK_COMPANY: FooterCompany = {
  name: "Whyte Automations",
  tagline: null,
  phone: null,
  email: null,
  // Platform context (a Super Admin with no company selected, or no session) carries the platform's own links.
  socialLinks: resolveSocialLinks(undefined, "Whyte Automations", true),
};

/**
 * Company details for the site footer, sourced from Admin → Company Profile.
 *
 * `Company` is the tenant table itself and is not tenant-scoped, so the company is chosen here, from the trusted
 * server-side session (never from client input): a company user's own company, or for a Super Admin the company of
 * a validated "Act as company" grant. A Super Admin in platform context, a missing or invalid session, an unknown or
 * deleted company, and any lookup failure all get the neutral fallback; an arbitrary company is never picked.
 * A footer must never take the whole layout down, so any failure falls back to the brand name alone.
 */
export async function getFooterCompany(): Promise<FooterCompany> {
  try {
    const { companyId } = await getAuthenticatedActor();
    if (companyId === null) return FALLBACK_COMPANY;
    await connectMongoDB();
    const company = await Company.findById(companyId).select("name slug tagline phone email documentSettings").lean();
    if (!company) return FALLBACK_COMPANY;
    return {
      name: company.name?.trim() || FALLBACK_COMPANY.name,
      tagline: company.tagline?.trim() || null,
      phone: company.phone?.trim() || null,
      email: company.email?.trim() || null,
      socialLinks: resolveSocialLinks(company.documentSettings?.socialLinks, company.name?.trim() || FALLBACK_COMPANY.name, company.slug === DEFAULT_COMPANY_SLUG),
    };
  } catch {
    return FALLBACK_COMPANY;
  }
}
