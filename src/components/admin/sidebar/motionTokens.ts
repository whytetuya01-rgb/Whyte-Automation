/**
 * Motion tokens for the admin sidebar/header. One source of truth for the JS
 * (motion/react) side; the CSS side mirrors these as `--motion-*` custom
 * properties on `.admin-theme` in globals.css — keep the two in sync.
 */

/** ease-out-expo feel. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Seconds, for motion/react transitions. */
export const DURATION = {
  /** Hover feedback. */
  fast: 0.18,
  /** State changes (active colour, label fades). */
  base: 0.28,
  /** Sidebar collapse width. */
  layout: 0.38,
} as const;

/** Milliseconds, for timers that must line up with the CSS width transition. */
export const DURATION_MS = {
  fast: 180,
  base: 280,
  layout: 380,
} as const;

/** Layout moves (active indicator glide, mobile drawer). */
export const SPRING = { type: "spring", stiffness: 400, damping: 32 } as const;

/** Entrance stagger between consecutive menu rows. */
export const STAGGER_S = 0.035;

/** Existing Whyte admin pink (`--color-admin-primary` / #D85B83). */
export const ACCENT = "var(--color-admin-primary)";

/**
 * The pink dot baked into `public/company-logo.png` (sampled: rgb 255,108,154).
 * Used only for the overlay that animates that exact dot, so it must match the
 * asset rather than the UI accent.
 */
export const LOGO_DOT_COLOR = "#FF6C9A";

/**
 * Geometry of the logo artwork (4305×1000), as fractions of the image box —
 * measured from the PNG: the dot is x 4103–4304 / y 0–200, the "W" glyph ends
 * at x 986, and the gap before the dot is 154px.
 */
export const LOGO_GEOMETRY = {
  dotLeft: 4103 / 4305,
  dotWidth: 202 / 4305,
  dotHeight: 201 / 1000,
  wordmarkW: 987 / 4305,
  dotGap: 154 / 4305,
} as const;
