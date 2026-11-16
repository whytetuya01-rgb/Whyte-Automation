/**
 * One company's preset theme must never appear for another. Real Chromium against an isolated production server:
 * the preset and the custom brand colour are resolved from the same trusted server-side company context on every
 * render, nothing is read from (or written to) browser storage or a cookie, and the right theme shows after reloads,
 * login, logout, account switching and Super Admin act-as in the SAME browser, even with a stale shared
 * `whyte_site_theme` key left behind by the old implementation.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/theme-isolation.browser.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;

const ACCENT = { "whyte-rose": "#d85b83", "champagne-bronze": "#c4823f", "emerald-haven": "#0d9488" };

try {
  // ── static guards ──
  const layout = read("src", "app", "layout.tsx");
  assert.ok(!/<script/.test(layout) && !/localStorage/.test(layout), "the root layout has no inline theme script and no storage access");
  assert.ok(/data-theme=\{branding\.theme\}/.test(layout) && /<Providers initialTheme=\{branding\.theme\}>/.test(layout) && /buildBrandStyleCss\(branding\.brandColor\)/.test(layout), "preset and brand colour both come from the one server-resolved branding");
  const provider = read("src", "components", "providers", "ThemeProvider.tsx");
  assert.ok(!/localStorage\.(getItem|setItem)/.test(provider) && !/fetch\("\/api\/theme"\)\s*\.then/.test(provider), "the provider neither reads nor writes the preset in browser storage");
  assert.ok(/removeItem\(LEGACY_STORAGE_KEY\)/.test(provider), "the legacy shared key is cleaned up");
  assert.ok(!/cookies\(\)|cookieStore/.test(read("src", "app", "api", "theme", "route.ts")), "the theme API sets no cookie");
  const branding = read("src", "lib", "companyBranding.ts");
  assert.ok(/getAuthenticatedActor\(\)/.test(branding) && /theme: isValidTheme\(company\.theme\)/.test(branding), "the preset is resolved from the session's company, like the logo and colour");
  pass("static guards: no inline script, no browser storage or cookie for the preset; preset and colour share one server-resolved source");

  server = await startIsolatedServer("theme-iso", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "ownerc@example.com", role: "company_owner", name: "Owner C", companyId: 30 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug, extra = {}) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("companies").insertMany([
    company(10, "alpha", { theme: "emerald-haven", brandColor: "#1b3c73" }),
    company(20, "beta", { theme: "champagne-bronze" }),
    company(30, "gamma"),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 10 });
  const cookie = { super: await login("super@example.com", "admin"), a: await login("ownera@example.com", "admin"), b: await login("ownerb@example.com", "admin"), c: await login("ownerc@example.com", "admin") };

  // ── server HTML: the theme in the very first byte of every page ──
  const htmlOf = async (c, path = "/admin/dashboard") => (await fetch(`${baseUrl}${path}`, { headers: c ? { Cookie: c } : {} })).text();
  const themeOf = (html) => /<html[^>]*data-theme="([^"]+)"/.exec(html)?.[1];
  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.super }, body: JSON.stringify({ companyId: 20, reason: "theme isolation" }) });
  assert.equal(act.status, 200);
  const acting = [cookie.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  const htmlA = await htmlOf(cookie.a);
  assert.equal(themeOf(htmlA), "emerald-haven");
  assert.ok(htmlA.includes('id="company-brand-color"') && htmlA.includes("--accent:#1B3C73"), "A's preset and custom colour arrive together");
  assert.equal(themeOf(await htmlOf(cookie.b)), "champagne-bronze");
  assert.ok(!(await htmlOf(cookie.b)).includes("company-brand-color"));
  assert.equal(themeOf(await htmlOf(cookie.c)), "whyte-rose", "a company that never chose a preset gets the default");
  assert.equal(themeOf(await htmlOf(cookie.super)), "whyte-rose", "a Super Admin on the platform gets the default");
  assert.equal(themeOf(await htmlOf(acting)), "champagne-bronze", "a Super Admin acting as B gets B's preset");
  assert.equal(themeOf(await htmlOf(null, "/login")), "whyte-rose", "a signed-out visitor gets the default");
  for (const html of [htmlA, await htmlOf(cookie.b)]) assert.ok(!html.includes("whyte_site_theme"), "no storage key or script in the page");
  pass("the server renders each company's own preset (with its brand colour) in the first HTML; platform, signed-out and company-less users get the default; act-as uses the acted company");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // A stale shared key, as the old implementation left behind: it must have no effect at all.
  await context.addInitScript(() => { try { localStorage.setItem("whyte_site_theme", "emerald-haven"); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const setCookies = async (header) => {
    await context.clearCookies();
    if (header) await context.addCookies(header.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  };
  const state = () => page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase(),
    customStyle: document.querySelectorAll("style#company-brand-color").length,
    cookie: document.cookie.includes("whyte_site_theme"),
  }));
  /** Visit a page and check the theme right after load and again after the app has had time to run its effects. */
  const visit = async (path, expectTheme, expectAccent, label) => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    for (const wait of [0, 1500]) {
      if (wait) await page.waitForTimeout(wait);
      const s = await state();
      assert.equal(s.theme, expectTheme, `${label}: data-theme (${wait}ms)`);
      assert.equal(s.accent, expectAccent, `${label}: accent (${wait}ms)`);
      assert.equal(s.cookie, false, `${label}: no theme cookie`);
    }
  };

  // ── same browser, accounts switched, with reloads ──
  await setCookies(cookie.a);
  await visit("/admin/dashboard", "emerald-haven", "#1b3c73", "A");
  await page.reload({ waitUntil: "load" });
  await visit("/admin/dashboard", "emerald-haven", "#1b3c73", "A after reload");
  await setCookies(cookie.b);
  await visit("/admin/dashboard", "champagne-bronze", ACCENT["champagne-bronze"], "B right after A (stale key says emerald)");
  assert.equal((await state()).customStyle, 0, "B has no custom colour override");
  await page.reload({ waitUntil: "load" });
  await visit("/admin/dashboard", "champagne-bronze", ACCENT["champagne-bronze"], "B after reload");
  await setCookies(cookie.c);
  await visit("/admin/dashboard", "whyte-rose", ACCENT["whyte-rose"], "C");
  await setCookies(cookie.a);
  await visit("/admin/dashboard", "emerald-haven", "#1b3c73", "A again");
  await setCookies(cookie.b);
  await visit("/admin/dashboard", "champagne-bronze", ACCENT["champagne-bronze"], "B again");
  pass("Company A, B and C in the same browser with a stale shared key: every visit and reload shows only that company's preset and colour, immediately and after the app's effects have run");

  // ── Super Admin act-as ──
  await setCookies(acting);
  await visit("/admin/dashboard", "champagne-bronze", ACCENT["champagne-bronze"], "act-as B");
  await page.request.delete(`${baseUrl}/api/platform/act-as`);
  await visit("/admin/dashboard", "whyte-rose", ACCENT["whyte-rose"], "after ending act-as");
  pass("Super Admin act-as shows the acted company's preset, and the default again once it ends");

  // ── login and logout through the real UI (soft navigation, no manual reload) ──
  await setCookies(cookie.a);
  await visit("/admin/dashboard", "emerald-haven", "#1b3c73", "A before sign-out");
  await page.getByRole("button", { name: /sign out/i }).first().click();
  await page.getByRole("button", { name: /^sign out$/i }).last().click();
  await page.waitForURL(/\/admin\/login/);
  await page.waitForTimeout(800);
  let s = await state();
  assert.deepEqual([s.theme, s.accent, s.customStyle], ["whyte-rose", ACCENT["whyte-rose"], 0], "the login page after sign-out carries nothing of A");
  await page.fill("#admin-identifier", "ownerb@example.com");
  await page.fill("#admin-password", "Password123!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin\/dashboard/);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "champagne-bronze", null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  s = await state();
  assert.deepEqual([s.theme, s.accent, s.customStyle], ["champagne-bronze", ACCENT["champagne-bronze"], 0], "signing in as B (soft navigation) shows B's preset, not A's");
  pass("sign out of A then sign in as B in the same tab: the login page is neutral and B gets B's preset without a manual reload");

  // ── choosing a preset still works, and is saved per company ──
  await setCookies(cookie.c);
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Set as Theme" }).nth(1).click(); // champagne is nth(0), emerald nth(1)
  await page.locator("text=Theme updated to Emerald Haven!").first().waitFor();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "emerald-haven");
  assert.equal((await db.collection("companies").findOne({ _id: 30 })).theme, "emerald-haven");
  assert.equal((await db.collection("companies").findOne({ _id: 20 })).theme, "champagne-bronze", "other companies are unaffected");
  assert.equal(await page.evaluate(() => localStorage.getItem("whyte_site_theme")), null, "the legacy shared key was cleaned up and nothing wrote it again after the change");
  assert.equal((await state()).cookie, false);
  await visit("/admin/dashboard", "emerald-haven", ACCENT["emerald-haven"], "C after choosing emerald (reload)");
  await setCookies(cookie.b);
  await visit("/admin/dashboard", "champagne-bronze", ACCENT["champagne-bronze"], "B after C chose emerald");
  pass("choosing a preset applies at once, is stored per company, survives reloads and does not leak to another company");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
