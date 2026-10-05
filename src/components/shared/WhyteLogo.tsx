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

export type WhyteLogoSize =
  | "header"
  | "sidebar"
  | "login"
  | "auth"
  | "loader"
  | "document-cover"
  | "document-header"
  | "document-footer"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl";

interface WhyteLogoSizeConfig {
  className: string;
  hintWidth: number;
}

export const WHYTE_LOGO_SIZES: Record<WhyteLogoSize, WhyteLogoSizeConfig> = {
  header: {
    className: "h-6 sm:h-7 md:h-7.5 w-auto max-w-[135px]",
    hintWidth: 140,
  },
  sidebar: {
    className: "h-6 sm:h-6.5 w-auto max-w-[120px]",
    hintWidth: 120,
  },
  login: {
    className: "h-6.5 sm:h-7.5 w-auto max-w-[145px]",
    hintWidth: 145,
  },
  auth: {
    className: "h-6.5 sm:h-7.5 w-auto max-w-[145px]",
    hintWidth: 145,
  },
  loader: {
    className: "w-full h-auto max-w-[210px]",
    hintWidth: 210,
  },
  "document-cover": {
    className: "h-7.5 sm:h-8.5 w-auto max-w-[150px]",
    hintWidth: 150,
  },
  "document-header": {
    className: "h-4.5 sm:h-5 w-auto max-w-[95px]",
    hintWidth: 95,
  },
  "document-footer": {
    className: "h-5 sm:h-5.5 w-auto max-w-[105px]",
    hintWidth: 105,
  },
  xs: {
    className: "h-4.5 w-auto max-w-[80px]",
    hintWidth: 80,
  },
  sm: {
    className: "h-5.5 w-auto max-w-[100px]",
    hintWidth: 100,
  },
  md: {
    className: "h-6.5 sm:h-7 w-auto max-w-[130px]",
    hintWidth: 130,
  },
  lg: {
    className: "h-8 w-auto max-w-[150px]",
    hintWidth: 150,
  },
  xl: {
    className: "h-9 sm:h-10 w-auto max-w-[180px]",
    hintWidth: 180,
  },
};

export interface WhyteLogoProps {
  /**
   * Background context. `light` renders the black logo, `dark` renders the
   * white logo. Defaults to `light` because most surfaces are white.
   */
  theme?: WhyteLogoTheme;
  alt?: string;
  className?: string;
  /**
   * Semantic size variant tailored for standard UI contexts.
   * Defaults to 'md' when not specified.
   */
  size?: WhyteLogoSize;
  /**
   * Width the logo is rendered at, in CSS pixels. Rendered size always comes
   * from `className` / `size`; this is the hint the image optimizer uses to pick a
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
  size = "md",
  width,
  height,
  preload = false,
  unoptimized = false,
  loading,
  sizes,
}: WhyteLogoProps) {
  const sizeConfig = size ? WHYTE_LOGO_SIZES[size] : null;
  const effectiveWidth = width ?? sizeConfig?.hintWidth ?? 140;
  const effectiveHeight =
    height ?? Math.round(effectiveWidth / WHYTE_LOGO_ASPECT_RATIO);

  return (
    <Image
      src={WHYTE_LOGO_SOURCES[theme]}
      alt={alt}
      width={Math.round(effectiveWidth)}
      height={effectiveHeight}
      {...(preload ? { preload: true } : {})}
      {...(unoptimized ? { unoptimized: true } : {})}
      {...(loading ? { loading } : {})}
      {...(sizes ? { sizes } : {})}
      className={cn(
        "aspect-[4305/1000] object-contain shrink-0",
        sizeConfig?.className,
        className
      )}
    />
  );
}
