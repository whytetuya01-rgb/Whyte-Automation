import type { NextConfig } from "next";

/**
 * Content Security Policy (CSP)
 *
 * Scoped to Whyte Automation application requirements:
 * - Scripts: 'self', 'unsafe-eval' & 'unsafe-inline' (required for Next.js App Router chunk loading & hydration)
 * - Styles: 'self', 'unsafe-inline' (Tailwind CSS, dynamic brand palettes & theme presets)
 * - Fonts: 'self', data: (Geist next/font & embedded vector fonts)
 * - Images: 'self', data:, blob:, https://res.cloudinary.com (Cloudinary catalog, html-to-image canvas captures)
 * - Connect: 'self', https://res.cloudinary.com (SWR data fetching, Cloudinary uploads)
 * - Workers/Frames: 'self', blob: (jsPDF client-side generation & PDF worker threads)
 * - Object: 'none' (blocks legacy plugin execution like Flash/Java)
 * - Base URI & Form Action: 'self' (prevents base-tag hijacking & cross-domain form post-backs)
 * - Frame Ancestors: 'none' (blocks clickjacking framing)
 */
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "connect-src 'self' https://res.cloudinary.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const contentSecurityPolicyHeaderValue = cspDirectives.join("; ");

/**
 * Production Security Headers applied to every request.
 */
const securityHeaders = [
  // Content Security Policy
  { key: "Content-Security-Policy", value: contentSecurityPolicyHeaderValue },
  // Strict-Transport-Security: 1 year. (Subdomains & preload enabled conditionally once all domains support HTTPS)
  {
    key: "Strict-Transport-Security",
    value:
      process.env.ENABLE_HSTS_PRELOAD === "true"
        ? "max-age=63072000; includeSubDomains; preload"
        : "max-age=31536000",
  },
  // Stops site from being framed (matches frame-ancestors: 'none')
  { key: "X-Frame-Options", value: "DENY" },
  // Stops the browser from sniffing response MIME types
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sends the full URL only to same-origin requests; bare origin cross-origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Isolates browsing context to protect against Spectre-style attacks
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Explicitly disable unused device permissions
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
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
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
