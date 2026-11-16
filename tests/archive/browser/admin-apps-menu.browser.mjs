/**
 * The Apps menu for admins (real Chromium, isolated production server, throwaway MongoDB): /apps and /apps/<app> send an
 * admin-panel role to /admin/apps, which is drawn inside the admin panel (its top bar and sidebar); the live apps are
 * listed first with a line on what they open and each tile goes to its admin page; apps not built yet are listed as
 * coming soon and are not links; dealers still cannot reach it; it fits 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/admin-apps-menu.browser.mjs
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

try {
  server = await startIsolatedServer("admin-apps", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Olivia Owner", companyId: 10 },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Adi Admin", companyId: 10 },
    { _id: 3, email: "dealer@example.com", role: "dealer", name: "A Dealer", companyId: 10, discountAllocationPercent: 10 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "c10", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
  };

  browser = await chromium.launch({ headless: true });
  const open = async (who, viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(who.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };

  const desk = await open(cookie.owner, { width: 1280, height: 900 });
  await desk.page.goto(`${baseUrl}/apps`, { waitUntil: "domcontentloaded" });
  await desk.page.waitForURL(/\/admin\/apps$/);
  const available = desk.page.getByTestId("admin-apps-available");
  await available.waitFor();
  assert.deepEqual(await available.locator("li a span.font-semibold").allInnerTexts(), ["Contacts", "CRM", "Sales", "Dashboards", "Inventory", "Employees"], "the six live apps, in the launcher's order");
  assert.match(await available.innerText(), /Leads, pipeline and follow-ups/, "each live app says what it opens");
  const soon = desk.page.getByTestId("admin-apps-soon");
  assert.equal(await soon.locator("a").count(), 0, "coming-soon apps are not links");
  assert.match(await soon.innerText(), /Calendar[\s\S]*Soon/i);
  await desk.page.getByRole("link", { name: "Pipeline" }).first().waitFor({ state: "visible" }); // the admin sidebar
  assert.match(await desk.page.locator("header").first().innerText(), /Apps/, "the admin top bar is there");
  assert.equal(await desk.page.getByText("New Quotation").count(), 0, "not the workspace header");
  // motion: tiles stagger in to full opacity, a hovered tile lifts and its icon tilts
  const tile = available.locator("li").first();
  await desk.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="admin-apps-available"] > li')].every((li) => Number(getComputedStyle(li).opacity) === 1));
  const resting = await tile.locator("> div").evaluate((el) => getComputedStyle(el).transform);
  await tile.hover();
  await desk.page.waitForFunction((before) => getComputedStyle(document.querySelector('[data-testid="admin-apps-available"] > li > div')).transform !== before, resting);
  const iconTilt = await tile.locator("a > span").first().evaluate((el) => getComputedStyle(el).transform);
  assert.notEqual(iconTilt, "none", "the icon tilts on hover");
  await desk.page.mouse.move(5, 5);
  assert.ok(await noHorizontalScroll(desk.page));
  await shot(desk.page, "admin-apps-1280");
  await desk.page.goto(`${baseUrl}/apps/calendar`, { waitUntil: "domcontentloaded" });
  await desk.page.waitForURL(/\/admin\/apps$/);
  await available.getByRole("link", { name: /CRM/ }).click();
  await desk.page.waitForURL(/\/admin\/crm\/pipeline/);
  await desk.context.close();
  pass("at 1280px /apps and /apps/<app> land on /admin/apps inside the admin panel; six live apps with descriptions, the rest listed as coming soon (not links); a tile opens its admin page");

  const adminUser = await open(cookie.admin, { width: 1280, height: 900 });
  await adminUser.page.goto(`${baseUrl}/admin/apps`, { waitUntil: "domcontentloaded" });
  await adminUser.page.getByTestId("admin-apps-available").waitFor();
  await adminUser.context.close();
  pass("an Admin sees the menu too");

  const calm = await open(cookie.owner, { width: 1280, height: 900 });
  await calm.page.emulateMedia({ reducedMotion: "reduce" });
  await calm.page.goto(`${baseUrl}/admin/apps`, { waitUntil: "domcontentloaded" });
  await calm.page.getByTestId("admin-apps-available").waitFor();
  assert.equal(await calm.page.getByTestId("admin-apps-available").locator("li").first().evaluate((el) => getComputedStyle(el).opacity), "1", "with reduced motion the tiles are simply there");
  await calm.context.close();
  pass("motion: tiles stagger in, a hovered tile lifts and its icon tilts, and reduced-motion settings show everything at once");

  const dealer = await open(cookie.dealer, { width: 1280, height: 900 });
  await dealer.page.goto(`${baseUrl}/apps`, { waitUntil: "domcontentloaded" });
  await dealer.page.waitForURL((url) => url.pathname === "/");
  await dealer.page.goto(`${baseUrl}/admin/apps`, { waitUntil: "domcontentloaded" });
  await dealer.page.waitForURL((url) => url.pathname === "/");
  await dealer.context.close();
  pass("a dealer is still sent to the workspace from /apps and /admin/apps");

  const phone = await open(cookie.owner, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/admin/apps`, { waitUntil: "domcontentloaded" });
  await phone.page.getByTestId("admin-apps-available").waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px");
  await shot(phone.page, "admin-apps-375");
  await phone.context.close();
  pass("at 375px the menu fits with no sideways scroll");

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
