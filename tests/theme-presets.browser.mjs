/**
 * Theme & Brand Customization end to end (real Chromium against an isolated production server and a throwaway local
 * MongoDB): the 16 presets, Preview (never saved, never outlives the page) versus Set as Theme (saved, survives reload
 * and a fresh session), a custom brand colour layered over the preset (kept when the preset changes, stepping aside
 * during a preview, removal restoring the preset), the sidebar's on-dark accent for a dark preset, the live preview
 * scoped to an unsaved colour, Super Admin platform mode, WhatsApp / canonical social links, and the separate logo vs
 * compact-logo upload rules. Company B is checked after each of Company A's changes.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/theme-presets.browser.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
import { png } from "./helpers/imageFixtures.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const presetsCss = readFileSync(join(root, "src", "app", "theme-presets.css"), "utf8").replace(/\r\n/g, "\n");
const presetVar = (theme, name) => new RegExp(`html\\[data-theme="${theme}"\\][^{]*\\{[^}]*?${name}: (#[0-9A-F]{6});`).exec(presetsCss)?.[1].toLowerCase();
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;

try {
  server = await startIsolatedServer("theme-presets", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "dealera@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug, extra = {}) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("companies").insertMany([company(10, "alpha"), company(20, "beta", { theme: "sapphire-tech", brandColor: "#1b3c73" })]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 10 });
  const cookie = {
    super: await login("super@example.com", "admin"),
    a: await login("ownera@example.com", "admin"),
    b: await login("ownerb@example.com", "admin"),
    dealer: await login("dealera@example.com", "user"),
  };
  const stored = (id) => db.collection("companies").findOne({ _id: id });

  // ── API: every preset id is accepted, anything else refused ──
  const patchTheme = (c, body) => fetch(`${baseUrl}/api/theme`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify(body) });
  for (const theme of ["orchid-bloom", "slate-professional", "whyte-rose"]) assert.equal((await patchTheme(cookie.a, { theme })).status, 200, theme);
  for (const theme of ["teal-innovation", "WHYTE-ROSE", "whyte-rose;}", ""]) assert.equal((await patchTheme(cookie.a, { theme })).status, 400, JSON.stringify(theme));
  assert.equal((await stored(10)).theme, "whyte-rose");
  assert.equal((await patchTheme(cookie.dealer, { theme: "orchid-bloom" })).status, 403, "a dealer cannot change the theme");
  assert.equal((await patchTheme(cookie.super, { theme: "orchid-bloom" })).status, 403, "a Super Admin on the platform cannot change an arbitrary company");
  assert.equal((await stored(20)).theme, "sapphire-tech", "Company B is untouched");
  pass("the theme API accepts each new preset id, refuses unknown or malformed ids, dealers and a company-less Super Admin");

  browser = await chromium.launch({ headless: true });
  const newPage = async (header) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies(header.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };
  const rootState = (page) => page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    previewing: document.documentElement.hasAttribute("data-theme-preview"),
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase(),
    onDark: getComputedStyle(document.documentElement).getPropertyValue("--color-admin-primary-on-dark").trim().toLowerCase(),
  }));
  const card = (page, id) => page.locator(`[data-testid="theme-card-${id}"]`);

  // ── Company A: the page, Preview versus Set as Theme ──
  const page = await newPage(cookie.a);
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await card(page, "slate-professional").waitFor();
  assert.equal(await page.locator('[data-testid^="theme-card-"]').count(), 16, "16 preset cards");
  assert.equal(await page.getByTestId("accent-source").getAttribute("data-source"), "preset");
  await page.getByTestId("accent-source").getByText("Accent: Whyte Rose preset").waitFor();
  await card(page, "royal-amethyst").getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "royal-amethyst");
  let s = await rootState(page);
  assert.deepEqual([s.previewing, s.accent], [true, "#7c3aed"], "the preview shows Royal Amethyst's accent");
  await page.getByTestId("theme-preview-banner").getByText("Previewing Royal Amethyst (not saved)").waitFor();
  assert.equal((await stored(10)).theme, "whyte-rose", "Preview saves nothing");
  await page.getByTestId("theme-preview-banner").getByRole("button", { name: "Exit Preview" }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "whyte-rose");
  s = await rootState(page);
  assert.deepEqual([s.previewing, s.accent], [false, "#d85b83"]);
  // A preview never outlives the page: soft-navigate away mid-preview.
  await card(page, "coral-energy").getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "coral-energy");
  await page.locator('a[href="/admin/dashboard"]').first().click();
  await page.waitForURL(/\/admin\/dashboard/);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "whyte-rose" && !document.documentElement.hasAttribute("data-theme-preview"));
  assert.equal((await stored(10)).theme, "whyte-rose");
  pass("Preview applies a preset to the page without saving; Exit Preview and leaving the page both return to the saved theme");

  // Set as Theme: a dark preset, with its lightened sidebar shade.
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await card(page, "midnight-graphite").getByRole("button", { name: "Set as Theme" }).click();
  await page.locator("text=Theme updated to Midnight Graphite!").first().waitFor();
  assert.equal((await stored(10)).theme, "midnight-graphite", "saved to Company A");
  assert.equal((await stored(20)).theme, "sapphire-tech", "Company B untouched");
  s = await rootState(page);
  const graphiteOnDark = presetVar("midnight-graphite", "--color-admin-primary-on-dark");
  assert.deepEqual([s.theme, s.accent, s.onDark], ["midnight-graphite", "#3f3f46", graphiteOnDark]);
  assert.notEqual(graphiteOnDark, "#3f3f46", "the charcoal accent is lightened on the black sidebar");
  assert.equal(await page.locator(".nav-active-dot").first().evaluate((el) => getComputedStyle(el).backgroundColor), rgb(graphiteOnDark), "the sidebar's active marker uses the readable shade");
  await page.reload({ waitUntil: "load" });
  s = await rootState(page);
  assert.deepEqual([s.theme, s.accent], ["midnight-graphite", "#3f3f46"], "after reload");
  await card(page, "midnight-graphite").getByRole("button", { name: "Active Theme" }).waitFor();
  const fresh = await newPage(await login("ownera@example.com", "admin"));
  await fresh.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "load" });
  s = await rootState(fresh);
  assert.deepEqual([s.theme, s.accent], ["midnight-graphite", "#3f3f46"], "in a fresh signed-in session");
  const dealer = await newPage(cookie.dealer);
  await dealer.goto(`${baseUrl}/`, { waitUntil: "load" });
  s = await rootState(dealer);
  assert.deepEqual([s.theme, s.accent], ["midnight-graphite", "#3f3f46"], "Company A's dealer workspace follows the company's preset");
  await fresh.context().close();
  await dealer.context().close();
  pass("Set as Theme saves the preset to the company (database checked), applies at once, survives reload and a fresh session, reaches the dealer workspace; a dark preset stays readable on the black sidebar");

  // ── live preview of an unsaved custom colour, scoped to the panel ──
  const hex = page.locator('input[aria-label="Brand colour hex value"]');
  await hex.fill("#166534");
  const panel = page.getByTestId("branding-live-preview");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="branding-live-preview"]')).getPropertyValue("--accent").trim().toLowerCase() === "#166534");
  assert.equal((await rootState(page)).accent, "#3f3f46", "the rest of the page keeps the saved accent");
  await panel.getByTestId("branding-live-preview-caption").getByText(/unsaved custom colour #166534/i).waitFor();
  for (const id of ["preview-sidebar-expanded", "preview-sidebar-collapsed", "preview-loader", "preview-dealer", "preview-quotation", "preview-focus-ring"]) await panel.getByTestId(id).waitFor();
  // The button animates its colour change, so wait for the final colour rather than reading it mid-transition.
  await panel.getByRole("button", { name: "Accent button" }).evaluate((el, expected) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => (getComputedStyle(el).backgroundColor === expected ? resolve(true) : Date.now() - started > 5000 ? reject(new Error(`the real accent Button takes the draft colour: ${getComputedStyle(el).backgroundColor}`)) : requestAnimationFrame(check));
    check();
  }), rgb("#166534"));
  assert.notEqual(await panel.getByRole("button", { name: "Primary button" }).evaluate((el) => getComputedStyle(el).backgroundColor), rgb("#166534"), "the primary Button stays black, as in the app");
  await page.getByRole("button", { name: "Cancel changes" }).first().click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="branding-live-preview"]')).getPropertyValue("--accent").trim().toLowerCase() === "#3f3f46");
  assert.equal((await stored(10)).brandColor ?? null, null, "nothing was saved");
  pass("the live preview shows an unsaved custom colour on the real components, only inside the preview; Cancel discards it");

  // ── Company B: one accent choice — a preset OR a custom colour ──
  const pageB = await newPage(cookie.b);
  const accentIs = (hex) => pageB.waitForFunction((value) => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase() === value, hex);
  const dialog = () => pageB.getByRole("dialog");
  await pageB.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await card(pageB, "ocean-blue").waitFor();
  assert.equal(await pageB.getByTestId("accent-source").getAttribute("data-source"), "custom");
  await pageB.getByTestId("accent-source").getByText("Accent: custom colour #1B3C73").waitFor();
  s = await rootState(pageB);
  assert.deepEqual([s.theme, s.accent], ["sapphire-tech", "#1b3c73"], "B's custom colour is the accent");
  assert.equal(await pageB.getByRole("button", { name: "Set as Theme" }).count(), 0, "with a custom colour active, presets offer 'Use this preset'");
  // Preview still shows the preset's own colours.
  await card(pageB, "forest-green").getByRole("button", { name: "Preview" }).click();
  await accentIs("#15803d");
  await pageB.getByTestId("theme-preview-banner").getByText(/custom colour #1B3C73 is hidden while previewing/).waitFor();
  await pageB.getByTestId("theme-preview-banner").getByRole("button", { name: "Exit Preview" }).click();
  await accentIs("#1b3c73");
  // Choosing a preset asks first; keeping the colour changes nothing.
  await card(pageB, "ocean-blue").getByRole("button", { name: "Use this preset" }).click();
  await dialog().getByText(/custom colour #1B3C73 will be removed/).waitFor();
  await dialog().getByRole("button", { name: "Keep custom colour" }).click();
  let rowB = await stored(20);
  assert.deepEqual([rowB.theme, rowB.brandColor], ["sapphire-tech", "#1b3c73"], "cancelled: nothing saved");
  assert.equal((await rootState(pageB)).accent, "#1b3c73");
  // Confirming switches to the preset and removes the colour in one save; the screen changes at once.
  await card(pageB, "ocean-blue").getByRole("button", { name: "Use this preset" }).click();
  await dialog().getByRole("button", { name: "Use Ocean Blue" }).click();
  await pageB.locator("text=Switched to Ocean Blue. Your custom colour was removed.").first().waitFor();
  await accentIs("#0284c7");
  rowB = await stored(20);
  assert.deepEqual([rowB.theme, rowB.brandColor], ["ocean-blue", null], "the preset is saved and the custom colour removed together");
  await pageB.getByTestId("accent-source").getByText("Accent: Ocean Blue preset").waitFor();
  await card(pageB, "ocean-blue").getByRole("button", { name: "Active Theme" }).waitFor();
  await pageB.reload({ waitUntil: "load" });
  s = await rootState(pageB);
  assert.deepEqual([s.theme, s.accent], ["ocean-blue", "#0284c7"], "after reload");
  // A custom colour replaces the preset's accent; removing it returns to the saved preset.
  await pageB.locator('input[aria-label="Brand colour hex value"]').fill("#b91c1c");
  await pageB.getByRole("button", { name: "Save Brand Colour" }).click();
  await accentIs("#b91c1c");
  assert.deepEqual([(await stored(20)).theme, (await stored(20)).brandColor], ["ocean-blue", "#b91c1c"]);
  await pageB.getByRole("button", { name: /Remove custom colour/ }).click();
  await pageB.locator("text=The selected theme's colours are used again.").first().waitFor();
  await accentIs("#0284c7");
  assert.equal((await stored(20)).brandColor, null);
  assert.equal((await stored(10)).theme, "midnight-graphite", "Company A untouched by B");
  await pageB.context().close();
  pass("one accent choice: with a custom colour active a preset asks before replacing it (Keep changes nothing; Use switches at once and removes the colour in one save); a new custom colour replaces the preset and removing it returns to the preset");

  // ── Super Admin in platform mode ──
  const superPage = await newPage(cookie.super);
  await superPage.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await superPage.getByTestId("theme-platform-notice").waitFor();
  await superPage.getByTestId("brand-color-disabled").waitFor();
  assert.equal(await card(superPage, "orchid-bloom").getByRole("button", { name: "Set as Theme" }).isDisabled(), true, "nothing can be saved without a company");
  await superPage.goto(`${baseUrl}/admin/company`, { waitUntil: "load" });
  await superPage.getByTestId("company-platform-notice").waitFor();
  await superPage.context().close();
  pass("a Super Admin in platform mode is told to act as a company; save actions are disabled on the theme page");

  // ── WhatsApp and canonical social links ──
  await page.goto(`${baseUrl}/admin/company`, { waitUntil: "load" });
  await page.getByRole("tab", { name: "Document & Social Links" }).click();
  const whatsapp = page.getByLabel("WhatsApp");
  await whatsapp.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Enter a full https:// WhatsApp address.").waitFor();
  await whatsapp.fill("https://WA.ME/919876543210");
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Your quotation documents and page footer use the new content.").first().waitFor();
  const docA = (await stored(10)).documentSettings;
  assert.equal(docA.socialLinks.whatsapp, "https://wa.me/919876543210", "stored in canonical form");
  assert.equal(docA.socialLinks.linkedin ?? null, null, "empty links stay empty: nothing invented");
  await page.reload({ waitUntil: "load" });
  await page.locator('footer a[aria-label="Company alpha on WhatsApp"][href="https://wa.me/919876543210"]').waitFor();
  assert.equal(await page.locator('footer a[aria-label*="LinkedIn"]').count(), 0, "unset networks are hidden");
  assert.equal((await stored(20)).documentSettings?.socialLinks?.whatsapp ?? null, null, "Company B untouched");
  pass("WhatsApp links are validated (javascript: refused), stored in canonical form, shown with an accessible label, and empty links stay hidden");

  // ── separate rules for the logo and the compact logo ──
  await page.getByRole("tab", { name: "Logo Customization" }).click();
  await page.getByTestId("logo-spec").getByText(/2MB/).waitFor();
  await page.getByTestId("compact-logo-spec").getByText(/1MB/).waitFor();
  await page.setInputFiles('input[aria-label="Company logo file"]', { name: "wide.png", mimeType: "image/png", buffer: png(240, 60) });
  await page.locator('[data-testid="company-logo-frame"] img').waitFor();
  await page.setInputFiles('input[aria-label="Compact sidebar logo file"]', { name: "wordmark.png", mimeType: "image/png", buffer: png(300, 100) });
  await page.locator("text=The compact logo must be square").first().waitFor();
  const rejected = await page.request.post(`${baseUrl}/api/company/logo`, { multipart: { compactLogo: { name: "wordmark.png", mimeType: "image/png", buffer: png(300, 100) } } });
  assert.equal(rejected.status(), 400);
  const body = await rejected.json();
  assert.equal(body.error.field, "compactLogo");
  assert.match(body.error.message, /square/);
  const tooTall = await page.request.post(`${baseUrl}/api/company/logo`, { multipart: { logo: { name: "tall.png", mimeType: "image/png", buffer: png(64, 200) } } });
  assert.equal(tooTall.status(), 400, "a logo taller than 1:2 is refused by the server");
  const svg = await page.request.post(`${baseUrl}/api/company/logo`, { multipart: { logo: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') } } });
  assert.equal(svg.status(), 415, "SVG is refused");
  const disguised = await page.request.post(`${baseUrl}/api/company/logo`, { multipart: { logo: { name: "x.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') } } });
  assert.equal(disguised.status(), 415, "an SVG renamed to .png is refused by its bytes");
  const row = await stored(10);
  assert.deepEqual([row.logoUrl ?? null, row.compactLogoUrl ?? null], [null, null], "failed uploads changed nothing");
  pass("the logo and compact logo have separate rules (size, pixels, aspect ratio) in the browser and on the server; SVG and disguised files are refused; failures change nothing");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
