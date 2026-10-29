import { brandCssVariables, accentOnDark, rgbChannels, type BrandPalette } from "@/lib/brandColor";

/**
 * The curated preset themes: the one source of their ids, names and accent palettes. The Company model, the theme
 * APIs and the generated stylesheet (`src/app/theme-presets.css`) all read from here, so a preset cannot exist in
 * one place and not another.
 */
export const SITE_THEME_IDS = [
  "whyte-rose",
  "champagne-bronze",
  "emerald-haven",
  "sapphire-tech",
  "royal-amethyst",
  "midnight-graphite",
  "ocean-blue",
  "coral-energy",
  "burgundy-luxe",
  "forest-green",
  "copper-modern",
  "lavender-calm",
  "arctic-silver",
  "orchid-bloom",
  "sunset-amber",
  "slate-professional",
] as const;

export type SiteTheme = (typeof SITE_THEME_IDS)[number];

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

/** Main, hover, soft tint, subtle tint, border and readable text shade; focus ring and glow follow the main colour. */
function palette(primary: string, hover: string, soft: string, subtle: string, border: string, foreground: string): ThemePalette {
  const rgb = rgbChannels(primary);
  return {
    primary,
    primaryHover: hover,
    primaryDark: hover,
    primarySoft: soft,
    primarySubtle: subtle,
    primaryBorder: border,
    primaryForeground: foreground,
    focusRing: `rgba(${rgb}, 0.25)`,
    glow: `rgba(${rgb}, 0.35)`,
  };
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
    palette: palette("#D85B83", "#B83E68", "#FCEAF0", "#FFF6F8", "#F1B8C8", "#8A2B4D"),
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
    palette: palette("#C4823F", "#A06429", "#FDF6EE", "#FFFAF4", "#F2D5B1", "#7A4B1A"),
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
    palette: palette("#0D9488", "#0F766E", "#F0FDFA", "#F7FEFD", "#99F6E4", "#115E59"),
  },
  "sapphire-tech": {
    id: "sapphire-tech",
    name: "Sapphire Tech",
    subtitle: "Professional & Technical",
    badge: "Corporate",
    tagline: "Confident, trustworthy professional blue",
    description: "A clear, dependable blue for system integrators, engineering-led teams and enterprise clients.",
    bestFor: "Commercial automation, corporate offices and technical specification proposals.",
    pmRationale: "Blue reads as reliable and precise; a safe default for B2B audiences.",
    palette: palette("#2563EB", "#1D4ED8", "#EFF6FF", "#F8FBFF", "#BFDBFE", "#1E40AF"),
  },
  "royal-amethyst": {
    id: "royal-amethyst",
    name: "Royal Amethyst",
    subtitle: "Premium & Distinctive",
    badge: "Premium",
    tagline: "Rich, regal violet",
    description: "A saturated violet that feels premium and modern without leaning on gold or black.",
    bestFor: "Boutique integrators, design studios and high-end residential brands.",
    pmRationale: "Stands apart from the common blue and green competitor palettes.",
    palette: palette("#7C3AED", "#6D28D9", "#F5F3FF", "#FAF9FF", "#DDD6FE", "#5B21B6"),
  },
  "midnight-graphite": {
    id: "midnight-graphite",
    name: "Midnight Graphite",
    subtitle: "Monochrome & Minimal",
    badge: "Minimal",
    tagline: "Charcoal, understated and architectural",
    description: "A near-monochrome charcoal accent that lets product imagery and the company logo lead.",
    bestFor: "Minimalist brands, architects and companies whose logo already carries strong colour.",
    pmRationale: "Neutral accents never clash with a colourful logo or product photography.",
    palette: palette("#3F3F46", "#27272A", "#F4F4F5", "#FAFAFA", "#D4D4D8", "#27272A"),
  },
  "ocean-blue": {
    id: "ocean-blue",
    name: "Ocean Blue",
    subtitle: "Fresh & Coastal",
    badge: "Fresh",
    tagline: "Bright sky blue with a cyan edge",
    description: "A lighter, airier blue than Sapphire Tech, with a hint of cyan.",
    bestFor: "Coastal villas, hospitality projects and consumer-facing smart-home brands.",
    pmRationale: "Friendly and open while staying professional.",
    palette: palette("#0284C7", "#0369A1", "#F0F9FF", "#F7FCFF", "#BAE6FD", "#075985"),
  },
  "coral-energy": {
    id: "coral-energy",
    name: "Coral Energy",
    subtitle: "Warm & Energetic",
    badge: "Vibrant",
    tagline: "Lively coral with warm accents",
    description: "An upbeat coral-red that brings energy to dashboards and proposals.",
    bestFor: "Young, consumer-focused brands and retail experience centres.",
    pmRationale: "Warm and approachable; memorable on printed quotations.",
    palette: palette("#E4504A", "#C93A34", "#FEF0EF", "#FFF8F7", "#F9C3C0", "#9B2C27"),
  },
  "burgundy-luxe": {
    id: "burgundy-luxe",
    name: "Burgundy Luxe",
    subtitle: "Deep Red Luxury",
    badge: "Luxury",
    tagline: "Deep wine red with quiet confidence",
    description: "A dark, rich burgundy for brands that want a classic luxury feel.",
    bestFor: "Premium residences, hospitality and heritage properties.",
    pmRationale: "Communicates luxury and craftsmanship without being loud.",
    palette: palette("#9F1239", "#881337", "#FFF1F2", "#FFF8F9", "#FECDD3", "#881337"),
  },
  "forest-green": {
    id: "forest-green",
    name: "Forest Green",
    subtitle: "Natural & Grounded",
    badge: "Natural",
    tagline: "Calm, natural green",
    description: "A true green (warmer than Emerald Haven's teal) for nature-led and wellness brands.",
    bestFor: "Farmhouses, wellness spaces and energy-saving retrofit proposals.",
    pmRationale: "Signals sustainability and calm; distinct from the teal preset.",
    palette: palette("#15803D", "#166534", "#F0FDF4", "#F7FEF9", "#BBF7D0", "#14532D"),
  },
  "copper-modern": {
    id: "copper-modern",
    name: "Copper Modern",
    subtitle: "Industrial Warmth",
    badge: "Industrial",
    tagline: "Warm, burnished copper",
    description: "A deeper, redder metal tone than Champagne Bronze, with an industrial-modern feel.",
    bestFor: "Loft apartments, cafés and contemporary commercial interiors.",
    pmRationale: "Warm and tactile, pairs well with wood and metal finishes.",
    palette: palette("#A14B2B", "#843D23", "#FBF1EC", "#FDF8F6", "#EDC9B9", "#6E321D"),
  },
  "lavender-calm": {
    id: "lavender-calm",
    name: "Lavender Calm",
    subtitle: "Soft & Serene",
    badge: "Calm",
    tagline: "Muted, gentle lavender",
    description: "A softer, greyer purple than Royal Amethyst for a calm, relaxed tone.",
    bestFor: "Wellness, spa and residential interior-design brands.",
    pmRationale: "Gentle and modern; feels considered rather than corporate.",
    palette: palette("#8273C4", "#6556AE", "#F3F1FA", "#F9F8FD", "#D2CCEB", "#43357F"),
  },
  "arctic-silver": {
    id: "arctic-silver",
    name: "Arctic Silver",
    subtitle: "Cool Neutral",
    badge: "Neutral",
    tagline: "Cool, quiet silver-grey",
    description: "A light, cool grey accent that keeps the interface quiet and clean.",
    bestFor: "Companies with a colourful logo, or a preference for a neutral interface.",
    pmRationale: "Neutral and calm; lighter and cooler than Midnight Graphite.",
    palette: palette("#737D8C", "#5E6673", "#F1F4F8", "#F8FAFC", "#CBD5E1", "#3F4752"),
  },
  "orchid-bloom": {
    id: "orchid-bloom",
    name: "Orchid Bloom",
    subtitle: "Bold & Creative",
    badge: "Creative",
    tagline: "Vivid orchid magenta",
    description: "A bold magenta-orchid for creative, design-forward brands.",
    bestFor: "Design studios, lifestyle brands and experience centres.",
    pmRationale: "Fills the magenta gap between Whyte Rose and Royal Amethyst.",
    palette: palette("#A21CAF", "#86198F", "#FDF4FF", "#FEFAFF", "#F5D0FE", "#701A75"),
  },
  "sunset-amber": {
    id: "sunset-amber",
    name: "Sunset Amber",
    subtitle: "Warm & Optimistic",
    badge: "Warm",
    tagline: "Bright sunset orange",
    description: "A saturated, optimistic orange; brighter and more orange than Champagne Bronze.",
    bestFor: "Solar, energy and outdoor-living automation brands.",
    pmRationale: "Highly visible call-to-action colour with a warm, friendly feel.",
    palette: palette("#E8650A", "#C2410C", "#FFF7ED", "#FFFBF5", "#FED7AA", "#9A3412"),
  },
  "slate-professional": {
    id: "slate-professional",
    name: "Slate Professional",
    subtitle: "Understated Blue-Grey",
    badge: "Professional",
    tagline: "Quiet, understated blue-grey",
    description: "A muted blue-grey for a calm, businesslike interface that never shouts.",
    bestFor: "Consultancies, facility managers and enterprise procurement proposals.",
    pmRationale: "Serious and neutral with a hint of colour; bluer than Midnight Graphite.",
    palette: palette("#3D5A73", "#2F475C", "#EEF3F7", "#F7F9FB", "#C6D4E1", "#2A3F52"),
  },
};

export const DEFAULT_THEME: SiteTheme = "whyte-rose";

export const THEME_LIST: ThemeConfig[] = SITE_THEME_IDS.map((id) => THEME_CONFIGS[id]);

export function isValidTheme(val: unknown): val is SiteTheme {
  return typeof val === "string" && Object.prototype.hasOwnProperty.call(THEME_CONFIGS, val);
}

export function getThemeConfig(id?: string | null): ThemeConfig {
  if (id && isValidTheme(id)) {
    return THEME_CONFIGS[id];
  }
  return THEME_CONFIGS[DEFAULT_THEME];
}

/** A preset's palette in the shape a custom brand colour uses, so both produce the same CSS variables. */
export function presetBrandPalette(theme: SiteTheme): BrandPalette {
  const { palette: p } = THEME_CONFIGS[theme];
  return {
    primary: p.primary,
    hover: p.primaryHover,
    soft: p.primarySoft,
    subtle: p.primarySubtle,
    border: p.primaryBorder,
    foreground: p.primaryForeground,
    onDark: accentOnDark(p.primary),
    rgb: rgbChannels(p.primary),
  };
}

/** Where the accent the company sees comes from: the selected preset, or a custom colour overriding it. */
export function accentSource(theme: SiteTheme, brandColor: string | null): { kind: "preset" | "custom"; theme: SiteTheme; color: string } {
  return brandColor ? { kind: "custom", theme, color: brandColor.toUpperCase() } : { kind: "preset", theme, color: THEME_CONFIGS[theme].palette.primary };
}

export const THEME_PRESETS_CSS_HEADER = "/* Generated from src/lib/themeTokens.ts by scripts/generate-theme-css.ts. Do not edit by hand. */";

/**
 * Every preset's accent variables, keyed by the `data-theme` attribute ThemeProvider sets on <html> and <body>. The
 * output is the checked-in `src/app/theme-presets.css`; tests/theme-presets.test.ts fails if the two drift apart.
 */
export function buildThemePresetCss(): string {
  const blocks = SITE_THEME_IDS.map((id) => {
    const declarations = Object.entries(brandCssVariables(presetBrandPalette(id)))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n");
    return `html[data-theme="${id}"],\nbody[data-theme="${id}"] {\n${declarations}\n}`;
  });
  return `${THEME_PRESETS_CSS_HEADER}\n\n${blocks.join("\n\n")}\n`;
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
    description: "Tighter table rows in the admin panel, so more data fits on one screen. Ideal for fast quotation work.",
  },
];

export const SIDEBAR_STYLES = SIDEBAR_STYLE_OPTIONS.map((option) => option.id);
export const BORDER_RADII = BORDER_RADIUS_OPTIONS.map((option) => option.id);
export const CONTENT_DENSITIES = CONTENT_DENSITY_OPTIONS.map((option) => option.id);

/** Layout settings read back from storage: any missing or unknown value takes the default, so the result is always valid. */
export function normalizeThemeLayout(stored: unknown): ThemeLayoutSettings {
  const source = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
  return {
    sidebarStyle: pick(source.sidebarStyle, SIDEBAR_STYLES, DEFAULT_LAYOUT_SETTINGS.sidebarStyle),
    borderRadius: pick(source.borderRadius, BORDER_RADII, DEFAULT_LAYOUT_SETTINGS.borderRadius),
    contentDensity: pick(source.contentDensity, CONTENT_DENSITIES, DEFAULT_LAYOUT_SETTINGS.contentDensity),
  };
}

/** The <html> attributes the layout settings are applied through (see the "Theme layout" rules in globals.css). */
export function themeLayoutAttributes(layout: ThemeLayoutSettings): Record<"data-sidebar" | "data-radius" | "data-density", string> {
  return { "data-sidebar": layout.sidebarStyle, "data-radius": layout.borderRadius, "data-density": layout.contentDensity };
}
