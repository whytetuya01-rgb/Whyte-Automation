"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Building } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_LOGO_SETTINGS, type LogoSettings } from "@/lib/logoSettings";

/**
 * One presentation for every company logo: wordmarks, square marks, circles, transparent PNGs, SVGs and logos with
 * their own background. The artwork is never cropped, stretched or recoloured (`object-contain` inside a box that
 * follows the image's natural proportions), and the image file itself is never touched.
 *
 *  - `header`  – chip in the black admin header: fixed height, width follows the logo's aspect ratio. Collapsed
 *                (rail) mode keeps the whole logo, shrunk into a square chip.
 *  - `thumb`   – fixed-size, bordered tile for company listings (`size` md / sm); a clean icon when there is no logo.
 *  - `loader`  – fills its parent (the loader's reserved logo box), centred.
 *
 * Layout never jumps: boxes have fixed height; the header chip stays invisible at a reserved width until the image's
 * proportions are known, then appears at its final width.
 */

export type CompanyLogoVariant = "header" | "thumb" | "loader";

interface CompanyLogoProps {
  src: string | null | undefined;
  /** Company name, used for the accessible label. */
  name?: string | null;
  variant: CompanyLogoVariant;
  /** `thumb` only. */
  size?: "lg" | "md" | "sm";
  /** `header` only: how the logo fits, its background, padding and corner rounding (the company's saved settings). */
  settings?: LogoSettings;
  /** `header` only: the sidebar rail is collapsed. */
  collapsed?: boolean;
  /** `header` only: chip height in px (the black admin header uses 40; the slimmer white dealer header less). */
  chipHeight?: number;
  /** Rendered instead of the logo when `src` is missing or fails to load. Defaults to a neutral building icon. */
  fallback?: React.ReactNode;
  className?: string;
}

const HEADER_CHIP_HEIGHT = 40;
const HEADER_MAX_INNER_WIDTH = 150;
const HEADER_RESERVED_INNER_WIDTH = 112;

const THUMB_BOX = {
  lg: { className: "h-[72px] w-24", icon: 26 },
  md: { className: "h-12 w-[72px]", icon: 20 },
  sm: { className: "h-10 w-14", icon: 16 },
} as const;

/** Width for a given aspect ratio at the header's fixed logo height, within sane limits. */
export function headerLogoWidth(ratio: number, innerHeight: number): number {
  return Math.round(Math.min(HEADER_MAX_INNER_WIDTH, Math.max(innerHeight, innerHeight * ratio)));
}

export default function CompanyLogo({ src, name, variant, size = "md", collapsed = false, chipHeight = HEADER_CHIP_HEIGHT, settings = DEFAULT_LOGO_SETTINGS, fallback, className }: CompanyLogoProps) {
  // Keyed by URL so a new logo (another company, replaced upload) is measured and retried from scratch.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ src: string; ratio: number } | null>(null);

  // An image that finished loading before hydration reports onLoad/onError while React is still mounting this
  // component; a state update then is invalid ("component hasn't mounted yet"). Updates that arrive early are held
  // and applied as soon as the component has mounted.
  const mounted = useRef(false);
  const early = useRef<Array<() => void>>([]);
  useEffect(() => {
    mounted.current = true;
    early.current.splice(0).forEach((apply) => apply());
    return () => {
      mounted.current = false;
    };
  }, []);
  const whenMounted = useCallback((apply: () => void) => {
    if (mounted.current) apply();
    else early.current.push(apply);
  }, []);

  const label = name ? `${name} logo` : "Company logo";
  const usable = Boolean(src) && failedSrc !== src;

  if (!usable) {
    if (fallback !== undefined) return <>{fallback}</>;
    if (variant === "thumb") {
      const box = THUMB_BOX[size];
      return (
        <div className={cn("flex shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50", box.className, className)}>
          <Building size={box.icon} className="text-gray-300" aria-hidden="true" />
        </div>
      );
    }
    return null;
  }

  const image = (extraClass?: string) => (
    <Image
      src={src as string}
      alt={label}
      fill
      unoptimized
      sizes="160px"
      data-company-logo=""
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
        whenMounted(() => setMeasured({ src: src as string, ratio }));
      }}
      onError={() => whenMounted(() => setFailedSrc(src as string))}
      className={cn(extraClass ?? "object-contain")}
    />
  );

  if (variant === "loader") {
    return (
      <span className={cn("relative block h-full w-full max-w-[210px]", className)}>{image("object-contain object-center")}</span>
    );
  }

  if (variant === "thumb") {
    const box = THUMB_BOX[size];
    return (
      <div className={cn("relative shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white", box.className, className)}>
        <span className="absolute inset-1.5">{image("object-contain object-center")}</span>
      </div>
    );
  }

  // header: fixed-height chip. `contain` keeps the whole logo (width follows its proportions); `cover` fills a
  // fixed-width chip and may crop. Background, padding and rounding come from the company's settings.
  // Padding scales with a smaller chip so the logo keeps the same share of it.
  const pad = Math.round((settings.padding * chipHeight) / HEADER_CHIP_HEIGHT);
  const innerHeight = chipHeight - pad * 2;
  const ratio = measured && measured.src === src ? measured.ratio : null;
  const covers = settings.fit === "cover";
  const innerWidth = collapsed
    ? innerHeight
    : covers
    ? HEADER_RESERVED_INNER_WIDTH
    : ratio
    ? headerLogoWidth(ratio, innerHeight)
    : HEADER_RESERVED_INNER_WIDTH;
  const chipWidth = innerWidth + pad * 2;
  const ready = ratio !== null || covers;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden transition-opacity duration-150",
        settings.background === "white" && "bg-white",
        ready ? "opacity-100" : "opacity-0",
        className
      )}
      style={{ width: chipWidth, height: chipHeight, borderRadius: settings.radius }}
    >
      <span className="relative block" style={{ width: innerWidth, height: innerHeight }}>
        {image(covers ? "object-cover object-center" : "object-contain object-center")}
      </span>
    </span>
  );
}
