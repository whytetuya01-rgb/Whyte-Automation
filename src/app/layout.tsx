import type { Metadata } from "next";
import { Raleway, Poppins } from "next/font/google";
import "./globals.css";
import "./theme-presets.css";
import WhyteToaster from "@/components/shared/WhyteToaster";
import Providers from "./providers";
import { BrandingProvider } from "@/components/providers/BrandingProvider";
import { getCompanyBranding } from "@/lib/companyBranding";
import { buildBrandStyleCss } from "@/lib/brandColor";
import { accentSource } from "@/lib/themeTokens";

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

export const metadata: Metadata = {
  title: "Whyte Automations — Quotation Platform",
  description: "Smart Home Quotation Management System for Whyte Automations Pvt. Ltd.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Whyte",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

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
      <body className={`${raleway.className} font-sans`} suppressHydrationWarning>
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

