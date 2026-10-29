/**
 * Browser check of the custom brand colour (real Chromium against an isolated production server): the editor's
 * scoped live preview and contrast warning, saving applies the colour across the real app and the quotation
 * document without a reload, another company is unaffected, and removing the colour restores the preset.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/brand-color.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

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

const DEFAULT_ACCENT = "#d85b83";

try {
  server = await startIsolatedServer("brand-colour-ui", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 3, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  const company = (id, slug) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([company(10, "alpha"), company(20, "beta")]);
  await db.collection("categories").insertOne({ _id: 101, companyId: 10, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertOne({ _id: 101, companyId: 10, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 101, companyId: 10, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 101, companyId: 10, houseTypeId: 101, roomTypeId: 101, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertOne({ _id: 101, companyId: 10, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 101, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 101, companyId: 10, productId: 101, variantCode: "V-1", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const cookies = { a: await login("ownera@example.com", "admin"), b: await login("ownerb@example.com", "admin"), dealer: await login("dealera@example.com", "user") };
  const created = await api(cookies.dealer, "POST", "/api/quotations", { clientName: "Colour Client", houseTypeId: 101 });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const room = (await api(cookies.dealer, "GET", `/api/quotations/${qid}`)).data.rooms[0];
  assert.equal((await api(cookies.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId: 101, productVariantId: 101, quantity: 1 })).status, 201);

  browser = await chromium.launch({ headless: true });
  const open = async (cookie) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const accent = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase());
  const color = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

  const { page } = await open(cookies.a);
  await page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  const editor = page.locator('[data-testid="brand-color-editor"]');
  await editor.waitFor();
  const hex = page.getByLabel("Brand colour hex value");
  const save = page.getByRole("button", { name: "Save Brand Colour" });
  assert.equal(await accent(page), DEFAULT_ACCENT, "starts on the default preset accent");
  assert.equal(await save.isDisabled(), true);

  // ── scoped preview + contrast gate ──
  await hex.fill("#ffeb3b");
  await editor.getByText(/too light/i).waitFor();
  assert.equal(await save.isDisabled(), true, "a colour that white text cannot be read on cannot be saved");
  await hex.fill("#1b");
  await editor.getByText("Enter a colour as #rrggbb").waitFor();
  assert.equal(await save.isDisabled(), true);
  await hex.fill("#1b3c73");
  await editor.getByText(/Readable: white text/).waitFor();
  assert.equal(await save.isEnabled(), true);
  const previewButton = editor.locator('[data-testid="brand-color-preview"] span', { hasText: "Accent button" });
  assert.equal(await color(previewButton), rgb("#1b3c73"), "the preview uses the chosen colour");
  assert.equal(await accent(page), DEFAULT_ACCENT, "the rest of the app is untouched until Save");
  assert.equal(await editor.locator('[aria-label="Derived shades"] > span').count(), 6, "the derived shades (including the sidebar shade) are shown");
  await page.getByRole("button", { name: /Use Emerald Haven colour/ }).click();
  assert.equal((await hex.inputValue()).toLowerCase(), "#0d9488", "preset swatches fill the hex value");
  await page.getByLabel("Pick a brand colour").fill("#1b3c73");
  assert.equal((await hex.inputValue()).toLowerCase(), "#1b3c73", "the colour picker and the hex value stay in step");
  pass("the editor previews the colour in its own card only, warns about unreadable colours and bad values, and keeps Save disabled for them");

  // ── save: the whole app switches without a reload ──
  await save.click();
  await page.locator("text=Your colour is now used across the app and your quotation documents.").first().waitFor();
  await page.waitForFunction((expected) => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase() === expected, "#1b3c73", { timeout: 15000 });
  assert.equal(await page.locator("style#company-brand-color").count(), 1);
  assert.equal(await color(page.locator('[data-testid="brand-color-active"] + *').first().or(page.locator("main span.bg-\\[var\\(--color-admin-primary\\)\\]").first())), rgb("#1b3c73"), "real app elements that use the accent follow it");
  await editor.getByTestId("brand-color-active").getByText("Active: #1B3C73").waitFor();
  assert.equal(await save.isDisabled(), true, "saved: nothing left to save");
  assert.equal((await db.collection("companies").findOne({ _id: 10 })).brandColor, "#1b3c73");
  pass("saving applies the colour across the real app immediately, without a reload");

  await page.reload({ waitUntil: "load" });
  assert.equal(await accent(page), "#1b3c73", "the colour survives a reload (server-rendered, no flash)");
  pass("the colour is there on the first render after a reload");

  // ── the quotation document follows it ──
  const dealer = await open(cookies.dealer);
  await dealer.page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
  await dealer.page.locator(".proposal-page").first().waitFor();
  assert.equal(await accent(dealer.page), "#1b3c73", "the company's dealers see the same colour");
  const heading = dealer.page.locator(".proposal-page .text-accent").first();
  await heading.waitFor();
  assert.equal(await heading.evaluate((el) => getComputedStyle(el).color), rgb("#1b3c73"), "the quotation document uses the brand colour");
  await dealer.context.close();
  pass("the company's dealers and its quotation document use the brand colour");

  // ── another company is unaffected ──
  const other = await open(cookies.b);
  await other.page.goto(`${baseUrl}/admin/theme`, { waitUntil: "load" });
  await other.page.locator('[data-testid="brand-color-editor"]').waitFor();
  assert.equal(await accent(other.page), DEFAULT_ACCENT, "Company B keeps its own (preset) colour");
  assert.equal(await other.page.locator("style#company-brand-color").count(), 0);
  assert.equal(await other.page.getByTestId("brand-color-active").count(), 0);
  assert.equal(await other.page.getByLabel("Brand colour hex value").inputValue(), "", "and does not see Company A's value in the editor");
  await other.context.close();
  pass("Company B is unaffected: no override, no trace of Company A's colour");

  // ── remove ──
  await page.getByRole("button", { name: "Remove custom colour" }).click();
  await page.locator("text=The selected theme's colours are used again.").first().waitFor();
  await page.waitForFunction((expected) => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase() === expected, DEFAULT_ACCENT, { timeout: 15000 });
  assert.equal(await page.locator("style#company-brand-color").count(), 0);
  assert.equal((await db.collection("companies").findOne({ _id: 10 })).brandColor, null);
  assert.equal(await hex.inputValue(), "");
  pass("removing the custom colour restores the preset accent immediately");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
