/**
 * Custom brand colour: strict parsing, contrast gate, shade derivation, and the stylesheet built from it (it must
 * never be able to carry anything but variable declarations). The API behaviour is in tests/brand-color.test.mjs and
 * the editor / live application in tests/brand-color.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/brand-color.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_BRAND_CONTRAST_ON_WHITE,
  brandContrastOnWhite,
  brandCssVariables,
  brandPreviewStyle,
  buildBrandStyleCss,
  contrastRatio,
  deriveBrandPalette,
  isReadableBrandColor,
  normalizeBrandColor,
  accentOnDark,
  ADMIN_DARK_SURFACE,
  MIN_ACCENT_CONTRAST_ON_DARK,
} from "../src/lib/brandColor";
import { THEME_LIST } from "../src/lib/themeTokens";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

function main() {
  // ── parsing ──
  assert.equal(normalizeBrandColor("#1B3C73"), "#1b3c73");
  assert.equal(normalizeBrandColor("  #D85B83 "), "#d85b83");
  for (const bad of ["", "1b3c73", "#fff", "#12345", "#1234567", "#gggggg", "red", "rgb(1,2,3)", "#1b3c73;}body{display:none}", "#1b3c\n73", null, undefined, 123, {}]) {
    assert.equal(normalizeBrandColor(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
  pass("only a strict #rrggbb value is accepted (trimmed and lower-cased)");

  // ── contrast ──
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(Math.round(contrastRatio("#ffffff", "#ffffff")), 1);
  assert.ok(isReadableBrandColor("#1b3c73"));
  assert.ok(!isReadableBrandColor("#ffeb3b"), "a pale yellow fails the white-text gate");
  assert.ok(!isReadableBrandColor("#ffffff"));
  assert.ok(brandContrastOnWhite("#000000") > 20);
  for (const theme of THEME_LIST) assert.ok(isReadableBrandColor(theme.palette.primary), `${theme.name} passes its own gate`);
  assert.equal(MIN_BRAND_CONTRAST_ON_WHITE, 3);
  pass("the contrast gate rejects colours that white text cannot be read on; every preset passes it");

  // ── derived shades ──
  for (const color of ["#1b3c73", "#d85b83", "#0d9488", "#c4823f", "#7c3aed", "#b91c1c", "#374151", "#000000", "#444444"]) {
    const p = deriveBrandPalette(color);
    assert.equal(p.primary.toLowerCase(), color);
    for (const shade of [p.hover, p.soft, p.subtle, p.border, p.foreground, p.onDark]) assert.match(shade, /^#[0-9A-F]{6}$/);
    assert.ok(contrastRatio(p.onDark, ADMIN_DARK_SURFACE) >= MIN_ACCENT_CONTRAST_ON_DARK, `${color}: the sidebar shade is readable on the black sidebar (${contrastRatio(p.onDark, ADMIN_DARK_SURFACE).toFixed(2)})`);
    assert.ok(contrastRatio(p.foreground, p.soft) >= 4.5, `${color}: text on the soft tint reaches 4.5:1 (${contrastRatio(p.foreground, p.soft).toFixed(2)})`);
    assert.notEqual(p.hover.toLowerCase(), color, `${color}: hover is visibly different`);
    if (brandContrastOnWhite(color) < 12) assert.ok(contrastRatio(p.hover, "#ffffff") > contrastRatio(p.primary, "#ffffff"), `${color}: hover is darker than the main colour`);
    assert.ok(contrastRatio(p.soft, "#ffffff") < 1.35 && contrastRatio(p.subtle, "#ffffff") < contrastRatio(p.soft, "#ffffff"), `${color}: soft tints stay light`);
    assert.match(p.rgb, /^\d{1,3}, \d{1,3}, \d{1,3}$/);
  }
  assert.throws(() => deriveBrandPalette("nope"));
  // A colour already readable on the black sidebar keeps its own value there; a dark one is lightened, never recoloured.
  assert.equal(accentOnDark("#d85b83"), "#D85B83");
  assert.equal(accentOnDark("#c4823f"), "#C4823F");
  assert.notEqual(accentOnDark("#1b3c73"), "#1B3C73");
  pass("every derived shade is valid, the text shade is readable on the soft tint, hover is darker, tints stay light, the sidebar shade is readable on black");

  // ── the stylesheet ──
  const css = buildBrandStyleCss("#1B3C73");
  assert.ok(css.startsWith(":root:root:not([data-theme-preview]),:root:root:not([data-theme-preview]) body{") && css.endsWith("}"), "the custom colour steps aside only during a preset preview");
  assert.ok(css.includes("--color-admin-primary-on-dark:"), "the sidebar shade is overridden too");
  assert.ok(css.includes("--accent:#1B3C73") && css.includes("--color-admin-primary:#1B3C73"));
  assert.equal(css.match(/\{/g)?.length, 1, "exactly one rule");
  assert.ok(!/[<>@]|url\(|expression|javascript/i.test(css), "nothing but declarations");
  for (const evil of ["#1b3c73;}body{display:none}", "red;}x{", "#1b3c73</style><script>", "url(x)", null, undefined, 5]) {
    assert.equal(buildBrandStyleCss(evil), "", `rejects ${JSON.stringify(evil)}`);
    assert.deepEqual(brandPreviewStyle(evil), {});
  }
  pass("the injected stylesheet is built only from a validated colour and can only hold variable declarations");

  // ── coverage of the theme variables ──
  const globals = read("src", "app", "globals.css");
  const block = /:root,\s*\[data-theme="whyte-rose"\]\s*\{([\s\S]*?)\n\}/.exec(globals);
  assert.ok(block, "found the default theme block in globals.css");
  const themed = [...block![1].matchAll(/(--(?:color-)?(?:accent|admin-primary)[a-z-]*|--admin-focus-ring):/g)].map((m) => m[1]);
  assert.ok(themed.length >= 20, "found the accent variables");
  const provided = Object.keys(brandCssVariables(deriveBrandPalette("#1b3c73")));
  for (const name of new Set(themed)) assert.ok(provided.includes(name), `${name} is overridden by a custom brand colour`);
  pass("a custom colour overrides every accent variable the preset themes define");

  // ── wiring guards ──
  const layout = read("src", "app", "layout.tsx");
  assert.ok(/branding\.brandColor &&[^\n]*buildBrandStyleCss\(branding\.brandColor\)/.test(layout), "the root layout renders the company's colour from the server-resolved branding");
  const branding = read("src", "lib", "companyBranding.ts");
  assert.ok(/getAuthenticatedActor\(\)/.test(branding) && /normalizeBrandColor\(company\.brandColor\)/.test(branding), "the colour comes from the session's own company and is re-validated");
  const provider = read("src", "components", "providers", "BrandingProvider.tsx");
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(provider), "the colour is never kept in browser storage");
  const themeRoute = read("src", "app", "api", "theme", "route.ts");
  assert.ok(/actor\.companyId/.test(themeRoute) && !/body\.companyId|parsed\.data\.companyId/.test(themeRoute) && /\.strict\(\)/.test(themeRoute), "the theme API writes the session's company only and refuses unknown keys");
  pass("static guards: server-resolved, never stored in the browser, session-derived company, strict API");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
