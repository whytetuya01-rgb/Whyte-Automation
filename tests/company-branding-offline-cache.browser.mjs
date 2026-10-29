/**
 * The service worker caches the offline quotation builder's HTML, which carries the signed-in company's logo.
 * Real Chromium + service worker against an isolated production server: after signing out, or after a different
 * account is signed in on the same device, no cached page rendered for the previous company may remain.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/company-branding-offline-cache.browser.mjs
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
  const USERS = [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 },
    { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 20, companyId: 2 },
  ];
  server = await startIsolatedServer("branding-sw", USERS, { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 1, name: "Company alpha", slug: "alpha", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: "https://logos.test/alpha.svg", tagline: null, createdAt: now, updatedAt: now },
    { _id: 2, name: "Company beta", slug: "beta", status: "active", phone: "2222222222", address: "St", gstNumber: null, email: null, logoUrl: "https://logos.test/beta.svg", tagline: null, createdAt: now, updatedAt: now },
  ]);
  const cookies = (header) => header.split("; ").filter(Boolean).map((pair) => {
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
  });
  const cookieA = await login("dealer_a@example.com", "user");
  const cookieB = await login("dealer_b@example.com", "user");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  await context.route("https://logos.test/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  const page = await context.newPage();
  page.setDefaultTimeout(40000);

  /** Text of every cached /quotation/* page (the builder shell and any visited drafts). */
  const cachedPages = () => page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith("/quotation/")) out.push(await (await cache.match(request)).text());
      }
    }
    return out;
  });
  const waitForShellContaining = async (needle) => {
    await page.waitForFunction(async (n) => {
      const hit = await caches.match("/quotation/draft/new", { ignoreVary: true });
      return Boolean(hit) && (await hit.text()).includes(n);
    }, needle, { timeout: 60000 });
  };

  // ── Company A signs in: the builder shell is cached with A's logo ──
  await context.addCookies(cookies(cookieA));
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitForShellContaining("logos.test/alpha.svg");
  pass("Company A: the cached builder shell carries A's logo");

  // ── Sign out through the UI: every cached page is dropped ──
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByTitle("Sign Out").first().click();
  await page.getByRole("button", { name: /^sign out$/i }).last().click();
  await page.waitForURL(/\/login/);
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) if (new URL(request.url).pathname.startsWith("/quotation/")) return false;
    }
    return true;
  }, null, { timeout: 30000 });
  assert.ok(!(await page.evaluate(() => localStorage.getItem("whyte:offline-identity"))), "offline identity forgotten");
  pass("sign-out removes every cached /quotation page and the remembered identity");

  // ── Company B signs in on the same device: only B's logo is ever cached ──
  await context.clearCookies();
  await context.addCookies(cookies(cookieB));
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await waitForShellContaining("logos.test/beta.svg");
  assert.ok((await cachedPages()).every((text) => !text.includes("alpha.svg")), "no cached page mentions Company A");
  pass("Company B on the same device: the cached shell carries B's logo and nothing of A's");

  // ── Account switched without signing out (session replaced): cached pages are replaced, not kept ──
  await context.clearCookies();
  await context.addCookies(cookies(cookieA));
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await waitForShellContaining("logos.test/alpha.svg");
  assert.ok((await cachedPages()).every((text) => !text.includes("beta.svg")), "no cached page mentions Company B");
  pass("account switched without sign-out: the previous company's cached pages are replaced");

  await context.close();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
