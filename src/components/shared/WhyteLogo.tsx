import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for the Whyte brand logo.
 *
 * The master artwork lives in `public/company-logo.png` and ships as a WHITE
 * logo (with a pink brand accent) on a transparent background. A matching
 * BLACK variant is generated from that exact master, so the two files are the
 * same artwork in the two colours the UI needs — no CSS filter or container
 * inversion is used, which keeps antialiased edges crisp and the pink accent
 * at its true brand colour.
 *
 * `theme` describes the BACKGROUND the logo is placed on, not the logo colour:
 *   - `theme="light"` → black logo, for light/white surfaces
 *   - `theme="dark"`  → white logo, for dark/black surfaces
 *
 * It is explicit by design: the app does not use `prefers-color-scheme`, and
 * the logo must follow the surface it is actually rendered on.
 */

/**
 * Intrinsic pixel size of the source artwork, and the ratio every rendering
 * must preserve.
 */
export const WHYTE_LOGO_INTRINSIC = { width: 4305, height: 1000 } as const;
export const WHYTE_LOGO_ASPECT_RATIO =
  WHYTE_LOGO_INTRINSIC.width / WHYTE_LOGO_INTRINSIC.height;

export const WHYTE_LOGO_SOURCES = {
  /** Light/white surface → black logo. */
  light: "/company-logo-black.png",
  /** Dark/black surface → white logo (the original master asset). */
  dark: "/company-logo.png",
} as const;

/** Background context the logo is rendered on. */
export type WhyteLogoTheme = keyof typeof WHYTE_LOGO_SOURCES;

export interface WhyteLogoProps {
  /**
   * Background context. `light` renders the black logo, `dark` renders the
   * white logo. Defaults to `light` because most surfaces are white.
   */
  theme?: WhyteLogoTheme;
  alt?: string;
  className?: string;
  /**
   * Width the logo is rendered at, in CSS pixels. Rendered size always comes
   * from `className`; this is the hint the image optimizer uses to pick a
   * sensible candidate file, so it should be close to the real size.
   */
  width?: number;
  /**
   * Rendered height in CSS pixels. Derived from the real artwork ratio when
   * omitted, so the logo can never be stretched out of proportion.
   */
  height?: number;
  /**
   * Preload the logo in the document head. Use for above-the-fold logos
   * (Next 16 replacement for the deprecated `priority` prop).
   */
  preload?: boolean;
  /** Serve the raw asset without the image optimizer (print / PDF contexts). */
  unoptimized?: boolean;
  loading?: "eager" | "lazy";
  sizes?: string;
}

export default function WhyteLogo({
  theme = "light",
  alt = "Whyte Automations",
  className,
  width = 220,
  height,
  preload = false,
  unoptimized = false,
  loading,
  sizes,
}: WhyteLogoProps) {
  return (
    <Image
      src={WHYTE_LOGO_SOURCES[theme]}
      alt={alt}
      width={Math.round(width)}
      height={height ?? Math.round(width / WHYTE_LOGO_ASPECT_RATIO)}
      {...(preload ? { preload: true } : {})}
      {...(unoptimized ? { unoptimized: true } : {})}
      {...(loading ? { loading } : {})}
      {...(sizes ? { sizes } : {})}
      // Rendered size always comes from the caller's classes; these defaults
      // only guarantee the logo is never stretched out of proportion.
      className={cn("h-auto w-auto object-contain", className)}
    />
  );
}
