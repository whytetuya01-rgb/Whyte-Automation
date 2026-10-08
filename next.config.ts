import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * Deliberately NOT included: a Content-Security-Policy. This app loads
 * Google Fonts, Cloudinary images, and runs client-side PDF generation
 * (html-to-image / jsPDF, which render through blob: URLs and canvas); a CSP
 * tight enough to matter and loose enough not to break those would need
 * testing against every page before shipping, so it is left for a dedicated
 * follow-up rather than guessed at here.
 */
const securityHeaders = [
  // This app is never meant to be framed by another site.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops the browser from guessing a response's MIME type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sends the full URL only to same-origin requests; a bare origin cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app does not use any of these browser features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {

  experimental: {
    optimizePackageImports: ["lucide-react", "@headlessui/react"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
