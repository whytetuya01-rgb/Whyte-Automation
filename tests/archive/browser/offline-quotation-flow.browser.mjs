// Browser regression: with the connection gone, a signed-in dealer can open "New Quotation" and get the local builder.
// Isolated production server + throwaway local Mongo, real Chromium with the service worker enabled.
// Run: PLAYWRIGHT_MODULE=<path to playwright> node tests/offline-quotation-flow.browser.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
let server, browser;
try {
  server = await startIsolatedServer("offline-flow", [{ _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 }], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Company 1", slug: "company-1", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertMany([{ _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 }, { _id: 2, companyId: 1, name: "Master Bedroom", isActive: true, sortOrder: 2 }]);
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([{ _id: 11, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 }, { _id: 12, companyId: 1, houseTypeId: 1, roomTypeId: 2, defaultCount: 1, sortOrder: 2 }]);
  await db.collection("products").insertOne({ _id: 1, companyId: 1, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 1, companyId: 1, productId: 1, variantCode: "SW-1", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer_a@example.com", "user");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // Online: the app prepares itself (service worker, identity, catalog, builder shell) without any user action.
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => /Offline Ready/i.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForFunction(async () => Boolean(await caches.match("/quotation/draft/new", { ignoreVary: true })), null, { timeout: 60000 });
  assert.ok(await page.evaluate(() => localStorage.getItem("whyte:offline-identity")), "identity remembered");

  // The connection drops; the list page is still open.
  await context.setOffline(true);
  await page.getByRole("link", { name: /new quotation/i }).first().click();
  page.on("requestfailed", (r) => console.log("  [requestfailed]", r.url().replace(baseUrl, "").slice(0, 140)));
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (/error|warn/i.test(m.type())) console.log("  [console]", m.text().slice(0, 200)); });
  await page.waitForURL(/\/quotation\/draft\/draft_/, { timeout: 15000 }).catch(async () => {
    throw new Error(`stuck at ${page.url()} :: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  });
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, /No Internet Connection|Offline Catalog Required|signed in/i, `builder should open, got: ${body.slice(0, 200)}`);
  console.log("PASS offline: New Quotation opens the local builder at", page.url().replace(baseUrl, ""));

  // A reload while offline keeps the same draft.
  const draftUrl = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  assert.equal(page.url(), draftUrl);
  assert.doesNotMatch(await page.locator("body").innerText(), /No Internet Connection|was not found/i);
  console.log("PASS offline: reload reopens the same draft");
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
}
