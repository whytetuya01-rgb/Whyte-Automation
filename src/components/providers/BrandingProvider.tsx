"use client";

import { createContext, useContext, useMemo } from "react";
import type { CompanyBranding } from "@/lib/companyBranding";
import { DEFAULT_LOGO_SETTINGS } from "@/lib/logoSettings";
import { DEFAULT_LAYOUT_SETTINGS, DEFAULT_THEME } from "@/lib/themeTokens";

const DEFAULT_BRANDING: CompanyBranding = { companyId: null, companyName: null, logoUrl: null, compactLogoUrl: null, settings: DEFAULT_LOGO_SETTINGS, brandColor: null, theme: DEFAULT_THEME, layout: DEFAULT_LAYOUT_SETTINGS };

const BrandingContext = createContext<CompanyBranding>(DEFAULT_BRANDING);

/**
 * Holds the signed-in user's company branding, resolved on the server from the trusted session. It is plain
 * per-render props, never persisted in browser storage, so a previous tenant's logo cannot be reused: logout is a
 * full page load, and login / act-as refresh the server tree.
 */
export function BrandingProvider({ branding, children }: { branding: CompanyBranding; children: React.ReactNode }) {
  const { companyId, companyName, logoUrl, compactLogoUrl, settings, brandColor, theme, layout } = branding;
  const { fit, background, padding, radius } = settings;
  const { sidebarStyle, borderRadius, contentDensity } = layout;
  const value = useMemo(
    () => ({ companyId, companyName, logoUrl, compactLogoUrl, settings: { fit, background, padding, radius }, brandColor, theme, layout: { sidebarStyle, borderRadius, contentDensity } }),
    [companyId, companyName, logoUrl, compactLogoUrl, fit, background, padding, radius, brandColor, theme, sidebarStyle, borderRadius, contentDensity]
  );
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useCompanyBranding(): CompanyBranding {
  return useContext(BrandingContext);
}
