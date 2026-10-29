"use client";

import WhyteLogo, { type WhyteLogoProps } from "@/components/shared/WhyteLogo";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";

/**
 * The signed-in company's logo in the loaders, or the default Whyte Automations logo when the company has none (or
 * its image fails to load, or there is no company context such as a Super Admin on the platform). Takes the same
 * props as `WhyteLogo`; the Whyte logo itself is rendered exactly as before.
 */
export default function BrandLogo(props: WhyteLogoProps) {
  const { logoUrl, companyName } = useCompanyBranding();
  if (!logoUrl) return <WhyteLogo {...props} />;
  return <CompanyLogo src={logoUrl} name={companyName} variant="loader" fallback={<WhyteLogo {...props} />} />;
}
