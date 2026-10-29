import { cache } from "react";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { getAuthenticatedActor } from "@/lib/api-auth";
import { normalizeBrandColor } from "@/lib/brandColor";
import { DEFAULT_THEME, isValidTheme } from "@/lib/themeTokens";
import type { SiteTheme } from "@/models/Company";
import { DEFAULT_LOGO_SETTINGS, normalizeLogoSettings, type LogoSettings } from "@/lib/logoSettings";

/**
 * Per-company branding for the signed-in user: the logo shown in the admin header/sidebar and the loaders.
 * `logoUrl: null` means "use the default Whyte Automations logo".
 */
export interface CompanyBranding {
  /** The company the branding belongs to; null in platform context. Used to key client state so a logo never outlives its tenant. */
  companyId: number | null;
  companyName: string | null;
  logoUrl: string | null;
  /** Optional square logo for the collapsed sidebar; only ever set together with `logoUrl`. */
  compactLogoUrl: string | null;
  /** Fit, background, padding and corner rounding for the logo. */
  settings: LogoSettings;
  /** Custom brand colour (`#rrggbb`), or null to use the selected preset theme. */
  brandColor: string | null;
  /** The company's selected preset theme; resolved with the logo and colour from the same trusted company context. */
  theme: SiteTheme;
}

export const PLATFORM_BRANDING: CompanyBranding = { companyId: null, companyName: null, logoUrl: null, compactLogoUrl: null, settings: DEFAULT_LOGO_SETTINGS, brandColor: null, theme: DEFAULT_THEME };

/** Only absolute https URLs are used as a logo; anything else (data:, javascript:, relative, garbage) falls back. */
export function sanitizeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Branding for one company id. Any lookup failure, unknown company or unusable logo gives the platform default. */
export async function loadBrandingForCompany(companyId: number | null): Promise<CompanyBranding> {
  if (companyId === null) return PLATFORM_BRANDING;
  try {
    await connectMongoDB();
    // `Company` is the tenant table itself (not tenant-scoped), so the id must come from the trusted session.
    const company = await Company.findById(companyId).select("name logoUrl compactLogoUrl logoSettings brandColor theme").lean();
    if (!company) return PLATFORM_BRANDING;
    const logoUrl = sanitizeLogoUrl(company.logoUrl);
    return {
      companyId,
      companyName: company.name?.trim() || null,
      logoUrl,
      compactLogoUrl: logoUrl ? sanitizeLogoUrl(company.compactLogoUrl) : null,
      settings: normalizeLogoSettings(company.logoSettings),
      brandColor: normalizeBrandColor(company.brandColor),
      theme: isValidTheme(company.theme) ? company.theme : DEFAULT_THEME,
    };
  } catch {
    return PLATFORM_BRANDING;
  }
}

/**
 * Branding for the current request, chosen from the trusted server-side session (never client input): a company
 * user's own company, or for a Super Admin the company of a validated "Act as company" grant. A Super Admin in
 * platform context, a missing/invalid session and every failure get the default Whyte logo. Deduplicated per request.
 */
export const getCompanyBranding = cache(async (): Promise<CompanyBranding> => {
  try {
    const { companyId } = await getAuthenticatedActor();
    return await loadBrandingForCompany(companyId);
  } catch {
    return PLATFORM_BRANDING;
  }
});
