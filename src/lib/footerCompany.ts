import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";

export interface FooterCompany {
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
}

const FALLBACK_COMPANY: FooterCompany = {
  name: "Whyte Automations",
  tagline: null,
  phone: null,
  email: null,
};

/**
 * Company details for the site footer, sourced from Admin → Company Profile.
 * A footer must never take the whole layout down, so any lookup failure
 * falls back to the brand name alone.
 */
export async function getFooterCompany(): Promise<FooterCompany> {
  try {
    await connectMongoDB();
    const company = await Company.findOne().select("name tagline phone email").lean();
    if (!company) return FALLBACK_COMPANY;
    return {
      name: company.name?.trim() || FALLBACK_COMPANY.name,
      tagline: company.tagline?.trim() || null,
      phone: company.phone?.trim() || null,
      email: company.email?.trim() || null,
    };
  } catch {
    return FALLBACK_COMPANY;
  }
}
