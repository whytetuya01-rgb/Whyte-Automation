/**
 * Company logo presentation settings: how the logo fits its box, its background, padding and corner rounding.
 * Shared by the server (validation before saving) and the client (editor, live preview, header chip), so both
 * agree on the bounds. Nothing here touches the database or the browser.
 */

export const LOGO_FITS = ["contain", "cover"] as const;
export const LOGO_BACKGROUNDS = ["white", "transparent"] as const;

export type LogoFit = (typeof LOGO_FITS)[number];
export type LogoBackground = (typeof LOGO_BACKGROUNDS)[number];

export interface LogoSettings {
  fit: LogoFit;
  background: LogoBackground;
  /** Inner padding in px. */
  padding: number;
  /** Corner rounding in px. */
  radius: number;
}

export const LOGO_PADDING_RANGE = { min: 0, max: 12 } as const;
export const LOGO_RADIUS_RANGE = { min: 0, max: 16 } as const;

/** What a company gets until it customises (matches how logos were presented before settings existed). */
export const DEFAULT_LOGO_SETTINGS: LogoSettings = { fit: "contain", background: "white", padding: 6, radius: 6 };

/** The two logo uploads: the main logo (header, loader, documents) and the optional square compact sidebar mark. */
export type LogoUploadKind = "logo" | "compactLogo";

export interface LogoUploadSpec {
  /** How the message names it ("logo", "compact logo"). */
  noun: string;
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  /** Allowed width / height range. */
  minAspect: number;
  maxAspect: number;
  aspectText: string;
  recommended: string;
}

/**
 * Per-upload rules, enforced in the browser for instant feedback and again on the server from the file's own bytes
 * (size, real type, pixel dimensions read from the image header).
 */
export const LOGO_UPLOAD_SPECS: Record<LogoUploadKind, LogoUploadSpec> = {
  logo: {
    noun: "logo",
    maxBytes: 2 * 1024 * 1024,
    minWidth: 64,
    minHeight: 32,
    maxWidth: 4096,
    maxHeight: 4096,
    minAspect: 0.5,
    maxAspect: 8,
    aspectText: "between 1:2 (tall) and 8:1 (wide)",
    recommended: "600 × 200 px (3:1) transparent PNG",
  },
  compactLogo: {
    noun: "compact logo",
    maxBytes: 1024 * 1024,
    minWidth: 64,
    minHeight: 64,
    maxWidth: 1024,
    maxHeight: 1024,
    minAspect: 0.8,
    maxAspect: 1.25,
    aspectText: "square (1:1, up to 5:4 either way)",
    recommended: "256 × 256 px transparent PNG",
  },
};

export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** One-line description of an upload's rules, shown beside its file picker. */
export function logoSpecSummary(kind: LogoUploadKind): string {
  const spec = LOGO_UPLOAD_SPECS[kind];
  // PNG and WebP keep transparency, JPEG has none. SVG is refused for both (no safe sanitiser on the server).
  return `PNG, JPG or WebP (PNG/WebP keep transparency), up to ${megabytes(spec.maxBytes)}, ${spec.minWidth}×${spec.minHeight} to ${spec.maxWidth}×${spec.maxHeight} px, ${spec.aspectText}. Recommended: ${spec.recommended}.`;
}

/** The problem with an image's pixel size for this upload, or null when it is acceptable. */
export function logoDimensionProblem(kind: LogoUploadKind, size: { width: number; height: number }): string | null {
  const spec = LOGO_UPLOAD_SPECS[kind];
  const { width, height } = size;
  const actual = `this one is ${width}×${height}`;
  if (width < spec.minWidth || height < spec.minHeight) return `The ${spec.noun} must be at least ${spec.minWidth}×${spec.minHeight} pixels (${actual}).`;
  if (width > spec.maxWidth || height > spec.maxHeight) return `The ${spec.noun} must be no larger than ${spec.maxWidth}×${spec.maxHeight} pixels (${actual}).`;
  const ratio = width / height;
  if (ratio < spec.minAspect || ratio > spec.maxAspect) return `The ${spec.noun} must be ${spec.aspectText} (${actual}).`;
  return null;
}

/** The problem with a file's size for this upload, or null. */
export function logoFileSizeProblem(kind: LogoUploadKind, bytes: number): string | null {
  const spec = LOGO_UPLOAD_SPECS[kind];
  if (bytes === 0) return "That file is empty.";
  return bytes > spec.maxBytes ? `The ${spec.noun} must be ${megabytes(spec.maxBytes)} or smaller.` : null;
}

/** Form-data / API field names for the settings. */
export const LOGO_SETTING_FIELDS = ["logoFit", "logoBackground", "logoPadding", "logoRadius"] as const;

export type LogoSettingsResult = { ok: true; value: LogoSettings } | { ok: false; field: (typeof LOGO_SETTING_FIELDS)[number]; message: string };

function integerInRange(raw: unknown, range: { min: number; max: number }): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value >= range.min && value <= range.max ? value : null;
}

/**
 * Strictly parses untrusted settings (every key optional, missing keys take `base`). Anything outside the allowed
 * values is an error, never silently clamped, so a tampered request is rejected rather than "fixed".
 */
export function parseLogoSettings(input: Partial<Record<(typeof LOGO_SETTING_FIELDS)[number], unknown>>, base: LogoSettings = DEFAULT_LOGO_SETTINGS): LogoSettingsResult {
  const next: LogoSettings = { ...base };

  if (input.logoFit !== undefined) {
    if (!(LOGO_FITS as readonly unknown[]).includes(input.logoFit)) return { ok: false, field: "logoFit", message: "Logo fit must be contain or cover." };
    next.fit = input.logoFit as LogoFit;
  }
  if (input.logoBackground !== undefined) {
    if (!(LOGO_BACKGROUNDS as readonly unknown[]).includes(input.logoBackground)) return { ok: false, field: "logoBackground", message: "Logo background must be white or transparent." };
    next.background = input.logoBackground as LogoBackground;
  }
  if (input.logoPadding !== undefined) {
    const padding = integerInRange(input.logoPadding, LOGO_PADDING_RANGE);
    if (padding === null) return { ok: false, field: "logoPadding", message: `Logo padding must be a whole number from ${LOGO_PADDING_RANGE.min} to ${LOGO_PADDING_RANGE.max}.` };
    next.padding = padding;
  }
  if (input.logoRadius !== undefined) {
    const radius = integerInRange(input.logoRadius, LOGO_RADIUS_RANGE);
    if (radius === null) return { ok: false, field: "logoRadius", message: `Corner rounding must be a whole number from ${LOGO_RADIUS_RANGE.min} to ${LOGO_RADIUS_RANGE.max}.` };
    next.radius = radius;
  }
  return { ok: true, value: next };
}

/** Settings read back from storage (any company created before settings existed has none): always valid. */
export function normalizeLogoSettings(stored: unknown): LogoSettings {
  const source = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const parsed = parseLogoSettings({ logoFit: source.fit, logoBackground: source.background, logoPadding: source.padding, logoRadius: source.radius });
  return parsed.ok ? parsed.value : DEFAULT_LOGO_SETTINGS;
}

export function sameLogoSettings(a: LogoSettings, b: LogoSettings): boolean {
  return a.fit === b.fit && a.background === b.background && a.padding === b.padding && a.radius === b.radius;
}
