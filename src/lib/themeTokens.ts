import type { SiteTheme } from "@/models/Company";

export interface ThemePalette {
  primary: string;
  primaryHover: string;
  primaryDark: string;
  primarySoft: string;
  primarySubtle: string;
  primaryBorder: string;
  primaryForeground: string;
  focusRing: string;
  glow: string;
}

export interface ThemeConfig {
  id: SiteTheme;
  name: string;
  subtitle: string;
  badge: string;
  tagline: string;
  description: string;
  bestFor: string;
  pmRationale: string;
  palette: ThemePalette;
}

export const THEME_CONFIGS: Record<SiteTheme, ThemeConfig> = {
  "whyte-rose": {
    id: "whyte-rose",
    name: "Whyte Rose",
    subtitle: "Signature Brand Identity",
    badge: "Official Brand",
    tagline: "The authentic, established Whyte signature hue",
    description:
      "Original Whyte brand rose-pink matching company logo artwork, official hardware accents, and client-facing estimates.",
    bestFor: "Brand consistency across all collateral, existing proposals, and physical hardware badges.",
    pmRationale:
      "Preserves recognizable brand equity, zero transition friction for existing dealers and team members.",
    palette: {
      primary: "#D85B83",
      primaryHover: "#B83E68",
      primaryDark: "#B83E68",
      primarySoft: "#FCEAF0",
      primarySubtle: "#FFF6F8",
      primaryBorder: "#F1B8C8",
      primaryForeground: "#8A2B4D",
      focusRing: "rgba(216, 91, 131, 0.25)",
      glow: "rgba(216, 91, 131, 0.35)",
    },
  },
  "champagne-bronze": {
    id: "champagne-bronze",
    name: "Champagne Bronze",
    subtitle: "Prestige Luxury & Villas",
    badge: "Luxury & Bespoke",
    tagline: "Warm architectural bronze & champagne elegance",
    description:
      "Crafted for high-net-worth residential villas, penthouses, luxury interior designers, and 5-star hotel automation projects.",
    bestFor: "Luxury residential quotation proposals, bespoke switchplate finishes, and ultra-premium estates.",
    pmRationale:
      "Elevates the perception from technical software to a bespoke interior design and luxury living experience.",
    palette: {
      primary: "#C4823F",
      primaryHover: "#A06429",
      primaryDark: "#A06429",
      primarySoft: "#FDF6EE",
      primarySubtle: "#FFFAF4",
      primaryBorder: "#F2D5B1",
      primaryForeground: "#7A4B1A",
      focusRing: "rgba(196, 130, 63, 0.25)",
      glow: "rgba(196, 130, 63, 0.35)",
    },
  },
  "emerald-haven": {
    id: "emerald-haven",
    name: "Emerald Haven",
    subtitle: "Modern Eco & Architectural",
    badge: "Eco & Intelligence",
    tagline: "Deep botanical teal & sustainable smart energy",
    description:
      "Inspired by sustainable smart living, biophilic architecture, green building standards, and intelligent energy management.",
    bestFor: "Eco-conscious villas, modern commercial projects, and energy-efficient automation installations.",
    pmRationale:
      "Speaks to contemporary architectural sensibilities and highlights energy intelligence and wellness.",
    palette: {
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryDark: "#0F766E",
      primarySoft: "#F0FDFA",
      primarySubtle: "#F7FEFD",
      primaryBorder: "#99F6E4",
      primaryForeground: "#115E59",
      focusRing: "rgba(13, 148, 136, 0.25)",
      glow: "rgba(13, 148, 136, 0.35)",
    },
  },
};

export const DEFAULT_THEME: SiteTheme = "whyte-rose";

export const THEME_LIST: ThemeConfig[] = Object.values(THEME_CONFIGS);

export function isValidTheme(val: unknown): val is SiteTheme {
  return typeof val === "string" && val in THEME_CONFIGS;
}

export function getThemeConfig(id?: string | null): ThemeConfig {
  if (id && isValidTheme(id)) {
    return THEME_CONFIGS[id];
  }
  return THEME_CONFIGS[DEFAULT_THEME];
}

/* ─────────────────────────────────────────────────────────────
   LAYOUT STRUCTURE TOKENS & DEFINITIONS
   ───────────────────────────────────────────────────────────── */

export type SidebarStyle = "classic" | "floating" | "minimal";
export type BorderRadius = "sharp" | "balanced" | "smooth";
export type ContentDensity = "comfortable" | "compact";

export interface ThemeLayoutSettings {
  sidebarStyle: SidebarStyle;
  borderRadius: BorderRadius;
  contentDensity: ContentDensity;
}

export const DEFAULT_LAYOUT_SETTINGS: ThemeLayoutSettings = {
  sidebarStyle: "classic",
  borderRadius: "balanced",
  contentDensity: "comfortable",
};

export interface LayoutOption<T extends string> {
  id: T;
  title: string;
  badge?: string;
  description: string;
  previewClass?: string;
}

export const SIDEBAR_STYLE_OPTIONS: LayoutOption<SidebarStyle>[] = [
  {
    id: "classic",
    title: "Classic Docked",
    badge: "Default",
    description: "Full-height solid dark obsidian sidebar with clean division and robust workspace structure.",
  },
  {
    id: "floating",
    title: "Modern Floating Glass",
    badge: "Popular",
    description: "Floating pill dock with rounded corners, subtle translucent elevation, and modern SaaS aesthetics.",
  },
  {
    id: "minimal",
    title: "Clean Minimal Bordered",
    badge: "Subtle",
    description: "Sleek low-profile dark sidebar with subtle hairline dividers and high contrast readability.",
  },
];

export const BORDER_RADIUS_OPTIONS: LayoutOption<BorderRadius>[] = [
  {
    id: "sharp",
    title: "Crisp & Sharp",
    badge: "4px - 6px",
    description: "Crisp architectural corners suited for dense data grids and engineering precision.",
  },
  {
    id: "balanced",
    title: "Modern Balanced",
    badge: "10px - 14px",
    description: "Balanced, contemporary rounded cards and buttons with Whyte signature elegance.",
  },
  {
    id: "smooth",
    title: "Soft & Organic",
    badge: "18px - 22px",
    description: "Generously curved cards and interactive elements for a luxurious, friendly feel.",
  },
];

export const CONTENT_DENSITY_OPTIONS: LayoutOption<ContentDensity>[] = [
  {
    id: "comfortable",
    title: "Comfortable",
    badge: "Spacious",
    description: "Airy padding, relaxed row heights, and generous breathing room. Ideal for executive overviews and tablets.",
  },
  {
    id: "compact",
    title: "High-Density",
    badge: "Efficient",
    description: "Condensed table rows, compact cards, and maximum visible data per screen. Ideal for fast quotation generation.",
  },
];
