/**
 * The last branding pieces end to end (real Chromium against an isolated production server and a throwaway local
 * MongoDB): the company logo in the white dealer header, the browser-tab title and icon per company, and the layout
 * settings (sidebar style, corner radius, content density): shown on the Theme page at once, saved only with "Save
 * Layout", rendered by the server on every page after that, and never reaching another company.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/theme-layout.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="${color}"/></svg>`;

try {
  server = await startIsolatedServer("theme-layout", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "dealera@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 5, email: "dealerb@example.com", role: "dealer", name: "Dealer B", companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug, extra = {}) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("companies").insertMany([company(10, "alpha", { logoUrl: "https://logos.test/alpha.svg" }), company(20, "beta")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 10 });
  const cookie = {
    super: await login("super@example.com", "admin"),
    a: await login("ownera@example.com", "admin"),
    b: await login("ownerb@example.com", "admin"),
    dealerA: await login("dealera@example.com", "user"),
    dealerB: await login("dealerb@example.com", "user"),
  };
  const stored = (id) => db.collection("companies").findOne({ _id: id });

  // ── API ──
  const patch = (c, body) => fetch(`${baseUrl}/api/theme`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify(body) });
  for (const bad of [{ layout: {} }, { layout: { sidebarStyle: "wild" } }, { layout: { borderRadius: "round" } }, { layout: { contentDensity: "tiny" } }, { layout: { sidebarStyle: "floating", extra: 1 } }, { layout: "floating" }]) {
    assert.equal((await patch(cookie.a, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await patch(cookie.dealerA, { layout: { sidebarStyle: "floating" } })).status, 403, "a dealer cannot change the layout");
  assert.equal((await patch(cookie.super, { layout: { sidebarStyle: "floating" } })).status, 403, "a company-less Super Admin cannot change an arbitrary company");
  assert.equal((await stored(10)).themeLayout?.sidebarStyle ?? "classic", "classic");
  pass("the layout API refuses empty, unknown and malformed settings, dealers and a company-less Super Admin");

  browser = await chromium.launch({ headless: true });
  const newPage = async (header) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.route("https://logos.test/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg("#c33") }));
    await context.addCookies(header.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };
  const attrs = (page) => page.evaluate(() => {
    const html = document.documentElement;
    const sidebar = document.querySelector("[data-admin-sidebar]");
    return {
      sidebar: html.getAttribute("data-sidebar"),
      radius: html.getAttribute("data-radius"),
      density: html.getAttribute("data-density"),
      radiusXl: getComputedStyle(html).getPropertyValue("--radius-xl").trim(),
      sidebarCorner: sidebar ? getComputedStyle(sidebar).borderTopLeftRadius : null,
    };
  });

  // ── dealer header logo and tab title / icon ──
  const dealerA = await newPage(cookie.dealerA);
  await dealerA.goto(`${baseUrl}/`, { waitUntil: "load" });
  await dealerA.locator('header img[alt="Company alpha logo"]').waitFor();
  assert.equal(await dealerA.title(), "Company alpha — Quotation Platform");
  assert.equal(await dealerA.locator('link[rel="icon"]').first().getAttribute("href"), "https://logos.test/alpha.svg", "the tab icon is the company's logo");
  const dealerB = await newPage(cookie.dealerB);
  await dealerB.goto(`${baseUrl}/`, { waitUntil: "load" });
  assert.equal(await dealerB.locator('header img[alt="Company alpha logo"]').count(), 0, "B never sees A's logo");
  await dealerB.locator('header img[alt="Whyte logo"]').first().waitFor();
  assert.equal(await dealerB.title(), "Company beta — Quotation Platform");
  assert.match(await dealerB.locator('link[rel="icon"]').first().getAttribute("href"), /\/icons\/icon-192\.png/, "a company without a logo keeps the default tab icon");
  await dealerB.context().close();
  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto(`${baseUrl}/login`, { waitUntil: "load" });
  assert.equal(await signedOut.title(), "Whyte Automations — Quotation Platform", "signed-out pages keep the platform title");
  await signedOut.context().close();
  pass("the dealer header shows the company's own logo (Whyte's when it has none); the tab title and icon follow the company; signed-out pages keep Whyte's");

  // ── layout: preview on the page, saved only with Save ──
  const page = await newPage(cookie.a);
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  const editor = page.getByTestId("theme-layout-editor");
  await editor.waitFor();
  let s = await attrs(page);
  assert.deepEqual([s.sidebar, s.radius, s.density], ["classic", "balanced", "comfortable"], "defaults");
  const defaultXl = s.radiusXl;
  await editor.getByRole("radio", { name: /Modern Floating Glass/ }).click();
  await editor.getByRole("radio", { name: /Crisp & Sharp/ }).click();
  await editor.getByRole("radio", { name: /High-Density/ }).click();
  s = await attrs(page);
  assert.deepEqual([s.sidebar, s.radius, s.density], ["floating", "sharp", "compact"], "choices show at once");
  assert.equal(s.radiusXl, "0.375rem", "sharp corners shrink Tailwind's radius tokens");
  assert.equal(s.sidebarCorner, "18px", "the floating sidebar is a rounded card");
  assert.equal((await stored(10)).themeLayout?.sidebarStyle ?? "classic", "classic", "nothing is saved yet");
  await editor.getByRole("button", { name: "Cancel changes" }).click();
  s = await attrs(page);
  assert.deepEqual([s.sidebar, s.radius, s.density, s.radiusXl], ["classic", "balanced", "comfortable", defaultXl], "Cancel puts the saved layout back");
  // Leaving the page with an unsaved choice never keeps it.
  await editor.getByRole("radio", { name: /Clean Minimal Bordered/ }).click();
  assert.equal((await attrs(page)).sidebar, "minimal");
  await page.locator('a[href="/admin/dashboard"]').first().click();
  await page.waitForURL(/\/admin\/dashboard/);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-sidebar") === "classic");
  pass("layout choices show on the page at once without saving; Cancel and leaving the page restore the saved layout");

  // ── save, then every page renders it from the server ──
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await editor.getByRole("radio", { name: /Modern Floating Glass/ }).click();
  await editor.getByRole("radio", { name: /Soft & Organic/ }).click();
  await editor.getByRole("radio", { name: /High-Density/ }).click();
  await editor.getByRole("button", { name: "Save Layout" }).click();
  await page.locator("text=The sidebar, corners and density now apply across the app for your company.").first().waitFor();
  const layoutA = (await stored(10)).themeLayout;
  assert.deepEqual([layoutA.sidebarStyle, layoutA.borderRadius, layoutA.contentDensity], ["floating", "smooth", "compact"], "saved to Company A");
  const html = await (await fetch(`${baseUrl}/admin/dashboard`, { headers: { Cookie: cookie.a } })).text();
  assert.match(html, /<html[^>]*data-sidebar="floating"[^>]*data-radius="smooth"[^>]*data-density="compact"/, "the server renders the saved layout in the first HTML (no flash)");
  await page.reload({ waitUntil: "load" });
  s = await attrs(page);
  assert.deepEqual([s.sidebar, s.radius, s.density, s.radiusXl], ["floating", "smooth", "compact", "1.125rem"], "after reload");
  await dealerA.reload({ waitUntil: "load" });
  assert.equal((await attrs(dealerA)).radius, "smooth", "Company A's dealers get the company's corners too");
  await dealerA.context().close();
  const pageB = await newPage(cookie.b);
  await pageB.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "load" });
  s = await attrs(pageB);
  assert.deepEqual([s.sidebar, s.radius, s.density], ["classic", "balanced", "comfortable"], "Company B keeps its own (default) layout");
  assert.equal((await stored(20)).themeLayout?.sidebarStyle ?? "classic", "classic");
  await pageB.context().close();
  pass("Save stores the layout on the company (database checked); the server renders it on every page, for its dealers too, and never for another company");

  // ── platform mode ──
  const superPage = await newPage(cookie.super);
  await superPage.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await superPage.getByTestId("theme-layout-editor").waitFor();
  assert.equal(await superPage.getByTestId("theme-layout-editor").getByRole("radio", { name: /Modern Floating Glass/ }).isDisabled(), true, "nothing can be chosen without a company");
  await superPage.context().close();
  pass("a Super Admin in platform mode cannot change any company's layout");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-2000)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
