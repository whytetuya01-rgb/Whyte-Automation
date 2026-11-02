/**
 * The dealer's own level (Bronze / Silver / Gold / Platinum / Diamond) in the dealer's own screens (real Chromium,
 * isolated production server, throwaway MongoDB): GET /api/dealer/tier is the dealer's own record only and counts only
 * delivered, live quotations of their own company; the header shows a level badge; the profile shows the level card
 * with progress and the whole ladder; it fits 1280px and 375px; other roles cannot read it.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/dealer-level.browser.mjs
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
  server = await startIsolatedServer("dealer-level", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 10 },
    { _id: 2, email: "gold@example.com", role: "dealer", name: "Gold Dealer", discountAllocationPercent: 10, companyId: 10 },
    { _id: 3, email: "new@example.com", role: "dealer", name: "New Dealer", discountAllocationPercent: 10, companyId: 10 },
    { _id: 4, email: "top@example.com", role: "dealer", name: "Top Dealer", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "other@example.com", role: "dealer", name: "Other Company Dealer", discountAllocationPercent: 10, companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  let serial = 0;
  const quotation = (dealerId, status, extra = {}) => ({
    _id: `q_lvl_${(serial += 1)}`, quotationNumber: `QT-2026-${String(serial).padStart(3, "0")}`, companyId: 10, dealerId, clientName: "Client", status,
    createdAt: now, updatedAt: now, ...extra,
  });
  const seed = [];
  for (let i = 0; i < 12; i += 1) seed.push(quotation(2, "delivered")); // Gold: 12 delivered
  seed.push(quotation(2, "approved"), quotation(2, "sent"), quotation(2, "draft"), quotation(2, "rejected")); // never count
  seed.push(quotation(2, "delivered", { isDeleted: true })); // a deleted one never counts
  seed.push(quotation(2, "delivered", { companyId: 20 })); // another company's never counts
  for (let i = 0; i < 45; i += 1) seed.push(quotation(4, "delivered")); // Diamond (40+)
  await db.collection("quotations").insertMany(seed);

  const cookie = {
    owner: await login("owner@example.com", "admin"),
    gold: await login("gold@example.com", "user"),
    fresh: await login("new@example.com", "user"),
    top: await login("top@example.com", "user"),
    other: await login("other@example.com", "user"),
  };

  // ── API ──
  const gold = await api(cookie.gold, "GET", "/api/dealer/tier");
  assert.equal(gold.status, 200, gold.text?.slice(0, 200));
  assert.deepEqual(
    [gold.data.category, gold.data.categoryLabel, gold.data.qualifiedCount, gold.data.nextCategory, gold.data.quotationsRequiredForNextCategory, gold.data.progressPercent],
    ["gold", "Gold", 12, "platinum", 8, 20],
    "12 delivered quotations: Gold, 8 more for Platinum, 20% of the way (10 to 20)"
  );
  assert.deepEqual(gold.data.ladder.map((step) => [step.key, step.minQualified, step.state]), [["bronze", 0, "reached"], ["silver", 5, "reached"], ["gold", 10, "current"], ["platinum", 20, "upcoming"], ["diamond", 40, "upcoming"]]);
  const stored = await db.collection("adminusers").findOne({ _id: 2 });
  assert.equal(stored.dealerTier?.category, "gold", "a dealer whose delivered quotations already earn a level is brought up to it");
  const fresh = await api(cookie.fresh, "GET", "/api/dealer/tier");
  assert.deepEqual([fresh.data.category, fresh.data.qualifiedCount, fresh.data.quotationsRequiredForNextCategory, fresh.data.progressPercent], ["bronze", 0, 5, 0]);
  const top = await api(cookie.top, "GET", "/api/dealer/tier");
  assert.deepEqual([top.data.category, top.data.qualifiedCount, top.data.nextCategory, top.data.quotationsRequiredForNextCategory, top.data.progressPercent], ["diamond", 45, null, 0, 100]);
  assert.deepEqual((await api(cookie.other, "GET", "/api/dealer/tier")).data.qualifiedCount, 0, "another company's dealer sees only their own count");
  assert.equal((await api(cookie.owner, "GET", "/api/dealer/tier")).status, 403, "only a Dealer has a dealer level");
  assert.equal((await api("", "GET", "/api/dealer/tier")).status, 401, "signed out");
  assert.ok(!JSON.stringify(gold.data).match(/dealerId|companyId|passwordHash|email/), "nothing about other people or accounts is returned");
  pass("the level API: the dealer's own count (delivered, live, own company only), the next level and progress, the ladder, upgrades a dealer to what they already earned; other roles refused");

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

  // ── desktop ──
  const desktop = await open(cookie.gold, { width: 1280, height: 900 });
  await desktop.page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded" });
  const chip = desktop.page.getByTestId("dealer-level-chip");
  await chip.waitFor();
  assert.equal((await chip.innerText()).trim(), "Gold", "the header shows the dealer's level");
  assert.match(await chip.getAttribute("title"), /12 delivered quotations · 8 more for Platinum/);
  const card = desktop.page.getByTestId("dealer-level-card");
  await card.waitFor();
  assert.equal((await desktop.page.getByTestId("dealer-level-name").innerText()).trim(), "Gold");
  const cardText = await card.innerText();
  assert.match(cardText, /12 delivered quotations/);
  assert.match(cardText, /8 more to reach Platinum/);
  assert.match(cardText, /approved and delivered/, "the card explains what counts");
  assert.equal(await card.getByRole("progressbar").getAttribute("aria-valuenow"), "20");
  const steps = desktop.page.getByTestId("dealer-level-ladder").locator("li");
  assert.deepEqual(await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-state"))), ["reached", "reached", "current", "upcoming", "upcoming"]);
  assert.equal(await desktop.page.getByTestId("dealer-level-ladder").locator('li[aria-current="step"]').count(), 1);
  assert.match(await steps.nth(3).innerText(), /Platinum[\s\S]*20\+ delivered/);
  assert.ok(await noHorizontalScroll(desktop.page), "no horizontal scroll at 1280px");
  await chip.click();
  await desktop.page.waitForURL(/\/profile#dealer-level/);
  await shot(desktop.page, "dealer-level-1280");
  await desktop.context.close();
  pass("at 1280px the header shows the Gold badge (with a tooltip of the numbers) and the profile shows the level card: name, 12 delivered, 8 more for Platinum, 20% progress, the five-step ladder with the current step marked");

  // ── other levels ──
  const bronze = await open(cookie.fresh, { width: 1280, height: 900 });
  await bronze.page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded" });
  await bronze.page.getByTestId("dealer-level-card").waitFor();
  assert.equal((await bronze.page.getByTestId("dealer-level-chip").innerText()).trim(), "Bronze");
  assert.match(await bronze.page.getByTestId("dealer-level-card").innerText(), /0 delivered quotations[\s\S]*5 more to reach Silver/);
  await bronze.context.close();
  const diamond = await open(cookie.top, { width: 1280, height: 900 });
  await diamond.page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded" });
  await diamond.page.getByTestId("dealer-level-card").waitFor();
  assert.equal((await diamond.page.getByTestId("dealer-level-chip").innerText()).trim(), "Diamond");
  assert.match(await diamond.page.getByTestId("dealer-level-card").innerText(), /top level/i);
  assert.equal(await diamond.page.getByTestId("dealer-level-card").getByRole("progressbar").getAttribute("aria-valuenow"), "100");
  await shot(diamond.page, "dealer-level-diamond-1280");
  await diamond.context.close();
  pass("a new dealer shows Bronze with 5 more for Silver; a 45-delivery dealer shows Diamond, the top level, at 100%");

  // ── phone ──
  const phone = await open(cookie.gold, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded" });
  await phone.page.getByTestId("dealer-level-card").waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px");
  const box = await phone.page.getByTestId("dealer-level-card").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375, "the level card fits the phone screen");
  const ladderBox = await phone.page.getByTestId("dealer-level-ladder").boundingBox();
  assert.ok(ladderBox && ladderBox.x + ladderBox.width <= 375, "and so does the ladder");
  await shot(phone.page, "dealer-level-375");
  await phone.context.close();
  pass("at 375px the level card and ladder fit the screen with no sideways scroll");

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
