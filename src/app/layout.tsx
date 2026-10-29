import type { Metadata, Viewport } from "next";
import { Raleway, Poppins } from "next/font/google";
import "./globals.css";
import "./theme-presets.css";
import WhyteToaster from "@/components/shared/WhyteToaster";
import Providers from "./providers";
import { BrandingProvider } from "@/components/providers/BrandingProvider";
import { companyFaviconUrl, getCompanyBranding } from "@/lib/companyBranding";
import { buildBrandStyleCss } from "@/lib/brandColor";
import { accentSource, themeLayoutAttributes } from "@/lib/themeTokens";
import PwaRegister from "@/components/pwa/PwaRegister";

const raleway = Raleway({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-raleway",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#ffffff",
  viewportFit: "cover",
};

/**
 * Browser tab title and icon follow the signed-in company (the same server-resolved branding as the page, deduplicated
 * per request). Signed-out pages and the platform keep the Whyte title and icon. The installed-app (PWA) manifest and
 * Apple web-app entries are platform-wide and unchanged.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getCompanyBranding();
  const companyIcon = companyFaviconUrl(branding.compactLogoUrl ?? branding.logoUrl, branding.settings.background);
  return {
    title: branding.companyName ? `${branding.companyName} — Quotation Platform` : "Whyte Automations — Quotation Platform",
    description: branding.companyName
      ? `Smart home quotations for ${branding.companyName}.`
      : "Smart Home Quotation Management System for Whyte Automations Pvt. Ltd.",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Whyte",
    },
    icons: {
      icon: companyIcon ?? "/icons/icon-192.png",
      apple: "/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved from the trusted server session on every full render; see getCompanyBranding.
  const branding = await getCompanyBranding();
  return (
    <html
      lang="en"
      className={`${raleway.variable} ${poppins.variable}`}
      data-theme={branding.theme}
      {...themeLayoutAttributes(branding.layout)}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content={accentSource(branding.theme, branding.brandColor).color} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Whyte" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* The signed-in company's own brand colour, resolved on the server from the session (never stored in the
            browser), so there is no flash of another company's colours. Built only from a strict #rrggbb value. */}
        {branding.brandColor && <style id="company-brand-color" dangerouslySetInnerHTML={{ __html: buildBrandStyleCss(branding.brandColor) }} />}
      </head>
      <body className={`${raleway.className} font-sans min-h-screen antialiased`} suppressHydrationWarning>
        <BrandingProvider branding={branding}>
          <Providers initialTheme={branding.theme}>
            <PwaRegister />
            {children}
            <WhyteToaster />
          </Providers>
        </BrandingProvider>
      </body>
    </html>
  );
}
