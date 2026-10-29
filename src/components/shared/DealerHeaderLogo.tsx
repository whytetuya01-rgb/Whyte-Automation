"use client";

import WhyteLogo from "@/components/shared/WhyteLogo";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";

/** Chip height in the white dealer header (slimmer than the black admin header's 40px). */
export const DEALER_HEADER_LOGO_HEIGHT = 32;

/**
 * Logo in the white dealer workspace header: the signed-in company's logo with its saved fit, background, padding
 * and rounding, or the Whyte logo when the company has none (or it fails to load). Read from the server-resolved
 * branding context, so a dealer only ever sees their own company's logo.
 */
export default function DealerHeaderLogo() {
  const { logoUrl, companyName, settings } = useCompanyBranding();
  const whyte = <WhyteLogo theme="light" alt="Whyte logo" size="header" preload />;
  if (!logoUrl) return whyte;
  return <CompanyLogo src={logoUrl} name={companyName} variant="header" chipHeight={DEALER_HEADER_LOGO_HEIGHT} settings={settings} fallback={whyte} />;
}
