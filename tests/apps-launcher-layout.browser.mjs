/**
 * The Apps launcher (/admin/apps) is a full-width home screen like Odoo's: no sidebar, no menu button, content from the left
 * edge. Every other admin page keeps its sidebar. Real Chromium, isolated production server, throwaway MongoDB.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/apps-launcher-layout.browser.mjs
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
  server = await startIsolatedServer("apps-layout", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = await login("owner@example.com", "admin");
  browser = await chromium.launch({ headless: true });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const sidebar = page.locator("[data-admin-sidebar-shell]");
    const menuButton = page.getByRole("button", { name: /sidebar|navigation/i });

    await page.goto(`${baseUrl}/admin/apps`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Apps", exact: true }).waitFor();
    assert.equal(await sidebar.count(), 0, `no sidebar on the Apps screen at ${w}px`);
    assert.equal(await menuButton.count(), 0, `no menu button on the Apps screen at ${w}px`);
    const main = await page.locator("main").boundingBox();
    assert.ok(main && main.x <= 1 && main.width >= w - 2, `the content spans the full width at ${w}px (x=${main?.x}, width=${main?.width})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll at ${w}px`);
    await page.getByRole("link", { name: /CRM/ }).first().waitFor();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/apps-launcher-${w}.png`, fullPage: true });

    // opening an app brings the sidebar back
    await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "load" });
    await sidebar.waitFor({ state: "attached" });
    assert.equal(await sidebar.count(), 1, `the sidebar is there on other pages at ${w}px`);
    assert.ok((await menuButton.count()) >= 1, `and so is the menu button at ${w}px`);
    if (w >= 1024) {
      const content = await page.locator("main").boundingBox();
      assert.ok(content && content.x >= 200, `the content is offset by the sidebar at ${w}px (x=${content?.x})`);
    }

    // and back to Apps: gone again (client-side navigation, no reload)
    await page.getByRole("link", { name: "Apps" }).first().click();
    await page.getByRole("heading", { name: "Apps", exact: true }).waitFor();
    assert.equal(await sidebar.count(), 0, `the sidebar disappears again on returning to Apps at ${w}px`);
    await context.close();
  }
  pass("the Apps launcher has no sidebar or menu button and spans the full width; other pages keep theirs; going back and forth works, at 1280px and 375px");

  console.log(`\nALL ${count} APPS LAUNCHER LAYOUT TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-2500));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
