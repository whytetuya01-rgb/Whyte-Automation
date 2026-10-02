import type { Metadata } from "next";
import { Raleway, Poppins } from "next/font/google";
import "./globals.css";
import WhyteToaster from "@/components/shared/WhyteToaster";
import Providers from "./providers";

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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${raleway.variable} ${poppins.variable}`}
      suppressHydrationWarning
    >
      <body className={`${raleway.className} font-sans`} suppressHydrationWarning>
        <Providers>
          {children}
          <WhyteToaster />
        </Providers>
      </body>
    </html>
  );
}

