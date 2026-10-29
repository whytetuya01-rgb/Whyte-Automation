/**
 * Custom brand colour: one hex colour chosen by a company, expanded into the full set of accent shades the app's
 * theme variables use (hover, soft tint, border, readable text colour, focus ring).
 *
 * Pure functions only (no DOM, no database), shared by the server (validation, the <style> rendered into the page)
 * and the client (editor, preview). The colour is always re-validated as a strict `#rrggbb` before it is ever put
 * into CSS, so nothing else can be injected through it.
 */

export const BRAND_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Accent colour on white must be at least this readable (WCAG 3:1, the threshold for UI components and large text). */
export const MIN_BRAND_CONTRAST_ON_WHITE = 3;

export function normalizeBrandColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return BRAND_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): Rgb {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 – 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function brandContrastOnWhite(hex: string): number {
  return contrastRatio(hex, "#ffffff");
}

/** True when white text on this colour (buttons, badges) stays readable. */
export function isReadableBrandColor(hex: string): boolean {
  return brandContrastOnWhite(hex) >= MIN_BRAND_CONTRAST_ON_WHITE;
}

export interface BrandPalette {
  primary: string;
  hover: string;
  soft: string;
  subtle: string;
  border: string;
  foreground: string;
  /** The accent as drawn on the black admin sidebar / header (lightened when the primary is too dark to see there). */
  onDark: string;
  /** `r, g, b` of the primary colour, for rgba() focus rings. */
  rgb: string;
}

/** The black admin sidebar / header the accent is drawn on. */
export const ADMIN_DARK_SURFACE = "#111111";
/** Accent icons, dots and labels on that surface must stay readable (WCAG 4.5:1). */
export const MIN_ACCENT_CONTRAST_ON_DARK = 4.5;

const shade = (hsl: Hsl, lightness: number, saturation: number = hsl.s): string => rgbToHex(hslToRgb({ h: hsl.h, s: Math.min(1, saturation), l: lightness }));

/** `r, g, b` of a strict `#rrggbb` colour. */
export function rgbChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

/**
 * The accent used on the black sidebar / header: the colour itself when it is already readable there, otherwise the
 * same hue lightened until it is. Every existing preset (rose, bronze, teal) is unchanged by this.
 */
export function accentOnDark(input: string): string {
  const hex = normalizeBrandColor(input);
  if (!hex) throw new Error("An accent colour must be a #rrggbb hex value.");
  if (contrastRatio(hex, ADMIN_DARK_SURFACE) >= MIN_ACCENT_CONTRAST_ON_DARK) return rgbToHex(hexToRgb(hex));
  const hsl = rgbToHsl(hexToRgb(hex));
  let lightness = hsl.l;
  let candidate = rgbToHex(hexToRgb(hex));
  while (contrastRatio(candidate, ADMIN_DARK_SURFACE) < MIN_ACCENT_CONTRAST_ON_DARK && lightness < 0.95) {
    lightness = Math.min(0.95, lightness + 0.02);
    candidate = shade(hsl, lightness);
  }
  return candidate;
}

/** Expands one brand colour into the accent shades. Throws on anything that is not a strict `#rrggbb`. */
export function deriveBrandPalette(input: string): BrandPalette {
  const hex = normalizeBrandColor(input);
  if (!hex) throw new Error("A brand colour must be a #rrggbb hex value.");
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  // Near-greys keep their (low) saturation instead of being pushed towards a colour.
  const tintSaturation = hsl.s < 0.08 ? hsl.s : Math.min(1, Math.max(hsl.s, 0.35));

  // Readable text colour on the soft tint: darken until it clears 4.5:1.
  const soft = shade(hsl, 0.95, tintSaturation);
  let foregroundLightness = 0.3;
  let foreground = shade(hsl, foregroundLightness, hsl.s);
  while (contrastRatio(foreground, soft) < 4.5 && foregroundLightness > 0.05) {
    foregroundLightness -= 0.03;
    foreground = shade(hsl, foregroundLightness, hsl.s);
  }

  return {
    primary: rgbToHex(rgb),
    // Darker on hover; a near-black colour cannot get darker, so it lightens a little instead.
    hover: shade(hsl, hsl.l > 0.2 ? hsl.l * 0.82 : Math.min(1, hsl.l + 0.1)),
    soft,
    subtle: shade(hsl, 0.975, tintSaturation),
    border: shade(hsl, 0.82, tintSaturation),
    foreground,
    onDark: accentOnDark(hex),
    rgb: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
  };
}

/**
 * The CSS custom properties that make up an accent, in the exact names `globals.css` uses. The preset themes
 * (`theme-presets.css`, generated from `themeTokens.ts`) and a custom brand colour both go through this one list.
 */
export function brandCssVariables(palette: BrandPalette): Record<string, string> {
  return {
    "--accent": palette.primary,
    "--accent-hover": palette.hover,
    "--accent-light": palette.soft,
    "--accent-muted": palette.subtle,
    "--accent-border": palette.border,
    "--accent-foreground": palette.foreground,
    "--color-accent": palette.primary,
    "--color-accent-hover": palette.hover,
    "--color-accent-light": palette.soft,
    "--color-accent-muted": palette.subtle,
    "--color-accent-border": palette.border,
    "--color-accent-foreground": palette.foreground,
    "--color-admin-primary": palette.primary,
    "--color-admin-primary-hover": palette.hover,
    "--color-admin-primary-dark": palette.hover,
    "--color-admin-primary-soft": palette.soft,
    "--color-admin-primary-subtle": palette.subtle,
    "--color-admin-primary-border": palette.border,
    "--color-admin-primary-foreground": palette.foreground,
    "--admin-primary": palette.primary,
    "--admin-primary-hover": palette.hover,
    "--admin-primary-dark": palette.hover,
    "--admin-primary-soft": palette.soft,
    "--admin-primary-subtle": palette.subtle,
    "--admin-primary-border": palette.border,
    "--admin-primary-foreground": palette.foreground,
    "--admin-focus-ring": `rgba(${palette.rgb}, 0.2)`,
    "--accent-on-dark": palette.onDark,
    "--color-accent-on-dark": palette.onDark,
    "--admin-primary-on-dark": palette.onDark,
    "--color-admin-primary-on-dark": palette.onDark,
  };
}

/**
 * Set on <html> while a preset is being previewed (Theme page): the saved custom colour steps aside so the preview
 * shows the preset's own accent. Nothing is saved by a preview.
 */
export const THEME_PREVIEW_ATTRIBUTE = "data-theme-preview";

/**
 * The stylesheet injected into the page for a company with a brand colour. It outranks the preset blocks
 * (`:root:root:not(…)` beats `html[data-theme]` / `body[data-theme]`) except during a preset preview. Returns "" for
 * any value that is not a strict `#rrggbb`.
 */
export function buildBrandStyleCss(color: unknown): string {
  const hex = normalizeBrandColor(color);
  if (!hex) return "";
  const declarations = Object.entries(brandCssVariables(deriveBrandPalette(hex)))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  const root = `:root:root:not([${THEME_PREVIEW_ATTRIBUTE}])`;
  return `${root},${root} body{${declarations}}`;
}

/** Inline-style object for a scoped preview (set on a wrapper; does not touch the rest of the app). */
export function brandPreviewStyle(color: unknown): Record<string, string> {
  const hex = normalizeBrandColor(color);
  return hex ? brandCssVariables(deriveBrandPalette(hex)) : {};
}
