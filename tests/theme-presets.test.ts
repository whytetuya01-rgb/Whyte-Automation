/**
 * Preset themes: the 16 curated palettes are complete, accessible and visually distinct; the checked-in stylesheet
 * matches them exactly; every place that accepts a preset id reads the one list in themeTokens.ts; and the preview /
 * custom-colour layering behaves as designed. The API behaviour is in tests/brand-color.test.mjs and the page in
 * tests/theme-presets.browser.mjs.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/theme-presets.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_DARK_SURFACE,
  MIN_ACCENT_CONTRAST_ON_DARK,
  MIN_BRAND_CONTRAST_ON_WHITE,
  brandCssVariables,
  buildBrandStyleCss,
  contrastRatio,
  deriveBrandPalette,
} from "../src/lib/brandColor";
import {
  DEFAULT_THEME,
  SITE_THEME_IDS,
  THEME_CONFIGS,
  THEME_LIST,
  accentSource,
  buildThemePresetCss,
  isValidTheme,
  presetBrandPalette,
} from "../src/lib/themeTokens";
import { updateCompanySchema } from "../src/lib/validation/catalog";
import { Company, VALID_SITE_THEMES } from "../src/models/Company";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");

/** CIEDE2000 colour difference (how different two colours look); ~2 is just noticeable, 10+ is clearly different. */
function deltaE2000(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + bl * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const rad = Math.PI / 180;
  const [L1, a1, b1] = lab(a);
  const [L2, a2, b2] = lab(b);
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const C1 = Math.hypot(ap1, b1);
  const C2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number) => ((Math.atan2(y, x) / rad) + 360) % 360;
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cb = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2 !== 0) {
    if (Math.abs(h1 - h2) > 180) hb += h1 + h2 < 360 ? 360 : -360;
    hb /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const Rc = 2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7));
  const Rt = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * Rc;
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cb;
  const Sh = 1 + 0.015 * Cb * T;
  const dL = L2 - L1;
  const dC = C2 - C1;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

async function main() {
  // ── catalogue ──
  assert.equal(SITE_THEME_IDS.length, 16);
  assert.equal(new Set(SITE_THEME_IDS).size, 16, "ids are unique");
  assert.equal(new Set(THEME_LIST.map((theme) => theme.name)).size, 16, "names are unique");
  assert.deepEqual(THEME_LIST.map((theme) => theme.id), [...SITE_THEME_IDS], "the list follows the id order");
  assert.deepEqual(SITE_THEME_IDS.slice(0, 3), ["whyte-rose", "champagne-bronze", "emerald-haven"], "the three original presets come first");
  assert.equal(DEFAULT_THEME, "whyte-rose");
  for (const theme of THEME_LIST) {
    assert.equal(theme.id, THEME_CONFIGS[theme.id].id);
    for (const field of ["name", "subtitle", "badge", "tagline", "description", "bestFor", "pmRationale"] as const) assert.ok(theme[field].trim().length > 0, `${theme.id}.${field}`);
  }
  assert.ok(isValidTheme("orchid-bloom") && !isValidTheme("teal-innovation") && !isValidTheme("toString") && !isValidTheme("__proto__"));
  pass("16 curated presets with unique ids and names; the three original presets are kept first");

  // ── the original three are unchanged ──
  const original = {
    "whyte-rose": ["#D85B83", "#B83E68", "#FCEAF0", "#FFF6F8", "#F1B8C8", "#8A2B4D", "rgba(216, 91, 131, 0.25)", "rgba(216, 91, 131, 0.35)"],
    "champagne-bronze": ["#C4823F", "#A06429", "#FDF6EE", "#FFFAF4", "#F2D5B1", "#7A4B1A", "rgba(196, 130, 63, 0.25)", "rgba(196, 130, 63, 0.35)"],
    "emerald-haven": ["#0D9488", "#0F766E", "#F0FDFA", "#F7FEFD", "#99F6E4", "#115E59", "rgba(13, 148, 136, 0.25)", "rgba(13, 148, 136, 0.35)"],
  } as const;
  for (const [id, values] of Object.entries(original)) {
    const p = THEME_CONFIGS[id as keyof typeof original].palette;
    assert.deepEqual([p.primary, p.primaryHover, p.primarySoft, p.primarySubtle, p.primaryBorder, p.primaryForeground, p.focusRing, p.glow], [...values], id);
    assert.equal(presetBrandPalette(id as keyof typeof original).onDark, p.primary, `${id} looks the same on the sidebar as before`);
  }
  pass("Whyte Rose, Champagne Bronze and Emerald Haven keep their exact established colours");

  // ── accessibility and internal consistency ──
  for (const theme of THEME_LIST) {
    const p = presetBrandPalette(theme.id);
    for (const value of [p.primary, p.hover, p.soft, p.subtle, p.border, p.foreground, p.onDark]) assert.match(value, /^#[0-9A-F]{6}$/, `${theme.id}: ${value}`);
    assert.ok(contrastRatio(p.primary, "#ffffff") >= MIN_BRAND_CONTRAST_ON_WHITE, `${theme.id}: white text on the accent ≥ 3:1 (${contrastRatio(p.primary, "#ffffff").toFixed(2)})`);
    assert.ok(contrastRatio(p.hover, "#ffffff") > contrastRatio(p.primary, "#ffffff"), `${theme.id}: hover is darker`);
    assert.ok(contrastRatio(p.foreground, p.soft) >= 4.5, `${theme.id}: text on the soft tint ≥ 4.5:1 (${contrastRatio(p.foreground, p.soft).toFixed(2)})`);
    assert.ok(contrastRatio(p.foreground, "#ffffff") >= 4.5, `${theme.id}: accent text on white ≥ 4.5:1`);
    assert.ok(contrastRatio(p.soft, "#ffffff") < 1.25 && contrastRatio(p.subtle, "#ffffff") <= contrastRatio(p.soft, "#ffffff"), `${theme.id}: tints stay light`);
    assert.ok(contrastRatio(p.border, "#ffffff") < contrastRatio(p.primary, "#ffffff"), `${theme.id}: the border is lighter than the accent`);
    assert.ok(contrastRatio(p.onDark, ADMIN_DARK_SURFACE) >= MIN_ACCENT_CONTRAST_ON_DARK, `${theme.id}: readable on the black sidebar (${contrastRatio(p.onDark, ADMIN_DARK_SURFACE).toFixed(2)})`);
  }
  pass("every preset: white text on the accent ≥ 3:1, accent text ≥ 4.5:1, hover darker, tints light, sidebar shade ≥ 4.5:1 on black");

  // ── visually distinct ──
  let closest = { distance: Infinity, pair: "" };
  for (let i = 0; i < THEME_LIST.length; i += 1) {
    for (let j = i + 1; j < THEME_LIST.length; j += 1) {
      const distance = deltaE2000(THEME_LIST[i].palette.primary, THEME_LIST[j].palette.primary);
      if (distance < closest.distance) closest = { distance, pair: `${THEME_LIST[i].id} / ${THEME_LIST[j].id}` };
    }
  }
  assert.ok(closest.distance >= 12, `the closest pair (${closest.pair}) differs by ΔE00 ${closest.distance.toFixed(1)}`);
  pass(`no two preset accents look alike (closest pair ${closest.pair}: ΔE00 ${closest.distance.toFixed(1)})`);

  // ── the generated stylesheet ──
  const css = read("src", "app", "theme-presets.css");
  assert.equal(css, buildThemePresetCss(), "src/app/theme-presets.css is out of date: run scripts/generate-theme-css.ts");
  for (const id of SITE_THEME_IDS) {
    const block = new RegExp(`html\\[data-theme="${id}"\\],\\nbody\\[data-theme="${id}"\\] \\{([^}]*)\\}`).exec(css);
    assert.ok(block, `${id} has a block`);
    const names = [...block![1].matchAll(/(--[a-z-]+):/g)].map((match) => match[1]);
    assert.deepEqual(names.sort(), Object.keys(brandCssVariables(presetBrandPalette(id))).sort(), `${id} defines the full variable set`);
  }
  assert.ok(!/[<>@]|url\(|expression|javascript/i.test(css), "only selectors and declarations");
  assert.ok(read("src", "app", "layout.tsx").includes('import "./theme-presets.css";'), "the root layout loads the presets");
  const globals = read("src", "app", "globals.css");
  assert.ok(!/\[data-theme="(?!whyte-rose)[a-z-]+"\]/.test(globals), "globals.css keeps only the default; the presets live in the generated file");
  // The custom brand colour and every preset set exactly the same variables, so an override can never miss one.
  assert.deepEqual(Object.keys(brandCssVariables(deriveBrandPalette("#1b3c73"))).sort(), Object.keys(brandCssVariables(presetBrandPalette("sapphire-tech"))).sort());
  pass("theme-presets.css is exactly what themeTokens.ts generates; every preset defines the full variable set");

  // ── one list everywhere ──
  assert.deepEqual(VALID_SITE_THEMES, [...SITE_THEME_IDS]);
  assert.deepEqual((Company.schema.path("theme") as unknown as { enumValues: string[] }).enumValues, [...SITE_THEME_IDS], "the model accepts exactly the presets");
  for (const id of SITE_THEME_IDS) assert.equal(updateCompanySchema.safeParse({ theme: id }).success, true, id);
  assert.equal(updateCompanySchema.safeParse({ theme: "teal-innovation" }).success, false);
  assert.equal(updateCompanySchema.safeParse({ theme: "whyte-rose;}body{" }).success, false);
  const themeRoute = read("src", "app", "api", "theme", "route.ts");
  assert.ok(/z\.enum\(SITE_THEME_IDS/.test(themeRoute) && !/"emerald-haven"/.test(themeRoute), "the theme API validates against the shared list");
  for (const file of [["src", "models", "Company.ts"], ["src", "lib", "validation", "catalog.ts"]]) {
    assert.ok(!/"champagne-bronze"/.test(read(...file)), `${file.join("/")} has no hard-coded preset list`);
  }
  pass("the model, the theme API and the company schema all accept exactly the shared preset list");

  // ── layering: preset, custom override, preview ──
  const override = buildBrandStyleCss("#1b3c73");
  assert.ok(override.startsWith(":root:root:not([data-theme-preview]),:root:root:not([data-theme-preview]) body{"), "the override outranks html[data-theme] / body[data-theme] but yields during a preview");
  assert.deepEqual(accentSource("forest-green", null), { kind: "preset", theme: "forest-green", color: "#15803D" });
  assert.deepEqual(accentSource("forest-green", "#1b3c73"), { kind: "custom", theme: "forest-green", color: "#1B3C73" });
  const provider = read("src", "components", "providers", "ThemeProvider.tsx");
  assert.ok(/setAttribute\(THEME_PREVIEW_ATTRIBUTE/.test(provider) && /removeAttribute\(THEME_PREVIEW_ATTRIBUTE/.test(provider), "ThemeProvider marks a preview so the override steps aside");
  assert.ok(!/localStorage\.(set|get)Item/.test(provider), "the preset is never read from or written to browser storage");
  const page = read("src", "app", "admin", "(panel)", "theme", "page.tsx");
  assert.ok(/useEffect\(\(\) => cancelPreview, \[cancelPreview\]\)/.test(page), "leaving the Theme page ends the preview");
  assert.ok(/clearBrandColor: true/.test(page) && /await confirm\(/.test(page), "choosing a preset while a custom colour is active asks, then removes the colour");
  assert.ok(/\{ theme: newTheme, brandColor: null \}/.test(provider), "the preset and the colour removal are saved in one request");
  pass("one accent choice: a custom colour replaces the preset; choosing a preset asks, then removes the colour in the same save; previews never outlive the page");
}

main()
  .then(() => {
    console.log(`\n${count} passed`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
