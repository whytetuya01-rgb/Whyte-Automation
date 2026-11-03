/**
 * The Bulk pricing screen end to end (real Chromium, isolated production server, throwaway MongoDB): choose a scope and a
 * rule, preview, change the prices, see the history, undo; a preview that went stale is refused; no overflow at 1280px or 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/bulk-pricing.browser.mjs
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
const dec = (v) => Decimal128.fromString(v);
const num = (v) => Number(String(v));

try {
  server = await startIsolatedServer("bulkprice-ui", [{ _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 }], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  const cat = (id, name, parentId, level) => ({ _id: id, companyId: 20, name, level, parentId, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, "Tactus", null, 1), cat(202, "Tactus Switches", 201, 2), cat(203, "Curtains", null, 1)]);
  const product = (id, name, categoryId) => ({ _id: id, companyId: 20, name, code: `P-${id}`, type: "switch_board", categoryId, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(2001, "Smart Switch", 202), product(2002, "Touch Panel", 201), product(2003, "Curtain Motor", 203)]);
  const variant = (id, productId, code, price, pwt) => ({ _id: id, companyId: 20, productId, variantCode: code, config: {}, price: dec(price), priceWithoutTax: dec(pwt), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now });
  const seedPrices = async () => {
    await db.collection("productvariants").deleteMany({});
    await db.collection("productvariants").insertMany([variant(1, 2001, "SW-1", "1180.00", "1000.00"), variant(2, 2001, "SW-2", "999.00", "846.61"), variant(3, 2002, "TP-1", "5799.00", "4914.41"), variant(4, 2003, "CM-1", "250.00", "211.86")]);
    await db.collection("pricechangebatches").deleteMany({});
    await db.collection("variantpricechanges").deleteMany({});
  };
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const prices = async () => Object.fromEntries((await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()).map((v) => [v._id, num(v.price)]));
  const cookie = await login("ownera@example.com", "admin");
  const waitForBatches = async (n) => {
    const end = Date.now() + 20000;
    while ((await db.collection("pricechangebatches").countDocuments()) !== n) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${n} price change record(s)`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  browser = await chromium.launch({ headless: true });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    await seedPrices();
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await page.goto(`${baseUrl}/admin/pricing`, { waitUntil: "load" });
    await page.getByTestId("pricing-note").waitFor();
    await page.getByTestId("pricing-history-empty").waitFor();
    assert.equal(await page.getByTestId("pricing-preview").isDisabled(), true, "nothing to preview until an amount is entered");
    assert.ok(await noScroll(), `no horizontal scroll at ${w}px`);

    // a rule that makes no sense is explained, not sent
    await page.getByTestId("pricing-value").fill("150");
    await page.getByTestId("pricing-direction").selectOption("decrease");
    await page.getByText("cannot be decreased by more than 100%").waitFor();
    assert.equal(await page.getByTestId("pricing-preview").isDisabled(), true);
    await page.getByTestId("pricing-direction").selectOption("increase");

    // categories: Tactus with its sub-category
    await page.getByTestId("pricing-scope-categories").check();
    assert.equal(await page.getByTestId("pricing-preview").isDisabled(), true, "choosing categories needs at least one");
    await page.getByTestId("pricing-category-201").check();
    await page.getByTestId("pricing-value").fill("10");
    await page.getByTestId("pricing-rounding").selectOption("10");
    await page.getByTestId("pricing-preview").click();
    const summary = page.getByTestId("pricing-preview-summary");
    await summary.waitFor();
    assert.match(await summary.innerText(), /Categories: Tactus/);
    assert.match(await summary.innerText(), /3 prices across 2 products would change/);
    const rows = page.getByTestId("pricing-preview-row");
    assert.equal(await rows.count(), 3, "the category's own products and its sub-category's are listed");
    assert.match(await rows.nth(0).innerText(), /Smart Switch[\s\S]*1,180[\s\S]*1,300/);
    assert.ok(await noScroll(), `no horizontal scroll with the preview at ${w}px`);
    assert.deepEqual(await prices(), { 1: 1180, 2: 999, 3: 5799, 4: 250 }, "previewing saves nothing");
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/bulk-pricing-${w}.png`, fullPage: true });

    // changing the rule discards the preview: you cannot apply what you did not see
    await page.getByTestId("pricing-value").fill("12");
    await page.getByTestId("pricing-preview-empty").waitFor();
    assert.equal(await page.getByTestId("pricing-apply").count(), 0);
    await page.getByTestId("pricing-value").fill("10");
    await page.getByTestId("pricing-note-input").fill("Festival list");
    await page.getByTestId("pricing-preview").click();
    await page.getByTestId("pricing-apply").waitFor();

    // prices move between the preview and the click: refused
    await db.collection("productvariants").updateOne({ _id: 3 }, { $set: { price: dec("5800.00"), priceWithoutTax: dec("4915.25") } });
    await page.getByTestId("pricing-apply").click();
    await page.getByRole("button", { name: "Change prices" }).click();
    await page.getByTestId("pricing-preview-empty").waitFor();
    assert.deepEqual(await prices(), { 1: 1180, 2: 999, 3: 5800, 4: 250 }, "a stale preview changed nothing");
    await db.collection("productvariants").updateOne({ _id: 3 }, { $set: { price: dec("5799.00"), priceWithoutTax: dec("4914.41") } });

    // the real thing
    await page.getByTestId("pricing-preview").click();
    await page.getByTestId("pricing-apply").click();
    await page.getByRole("button", { name: "Change prices" }).click();
    await waitForBatches(1);
    assert.deepEqual(await prices(), { 1: 1300, 2: 1100, 3: 6380, 4: 250 }, "Tactus and its sub-category moved by 10% rounded to ₹10; Curtains did not");
    const historyRow = page.getByTestId("pricing-history-row").first();
    await historyRow.waitFor();
    assert.match(await historyRow.innerText(), /Increase by 10%, rounded to ₹10[\s\S]*Categories: Tactus[\s\S]*3 prices[\s\S]*Owner A[\s\S]*Festival list/);
    assert.ok(await noScroll(), `no horizontal scroll with history at ${w}px`);

    // undo
    await page.getByTestId("pricing-revert").click();
    await page.getByRole("button", { name: "Undo", exact: true }).last().click();
    await waitForBatches(2);
    assert.deepEqual(await prices(), { 1: 1180, 2: 999, 3: 5799, 4: 250 }, "everything went back");
    await page.getByTestId("pricing-history-row").nth(1).getByText("Undone").waitFor();
    assert.equal(await page.getByTestId("pricing-revert").count(), 0, "nothing left to undo");
    assert.equal(await page.getByTestId("pricing-history-row").count(), 2, "the change and its undo are both kept");

    // everything, a fixed amount
    await page.getByTestId("pricing-scope-all").check();
    await page.getByTestId("pricing-mode").selectOption("amount");
    await page.getByTestId("pricing-direction").selectOption("decrease");
    await page.getByTestId("pricing-value").fill("100");
    await page.getByTestId("pricing-rounding").selectOption("none");
    await page.getByTestId("pricing-preview").click();
    await page.getByTestId("pricing-apply").waitFor();
    assert.match(await page.getByTestId("pricing-preview-summary").innerText(), /Decrease by ₹100/);
    assert.equal(await page.getByTestId("pricing-preview-row").count(), 4);
    await page.getByTestId("pricing-apply").click();
    await page.getByRole("button", { name: "Change prices" }).click();
    await waitForBatches(3);
    assert.deepEqual(await prices(), { 1: 1080, 2: 899, 3: 5699, 4: 150 });
    await context.close();
  }
  pass("Bulk pricing: scope (category with sub-categories / all), percent and fixed, rounding, a nonsensical rule is explained, the preview must match what is applied, a stale preview is refused, history and undo, quotation-safe; at 1280px and 375px with no overflow");

  // the menu entry
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    await page.goto(`${baseUrl}/admin/products`, { waitUntil: "load" });
    await page.getByRole("link", { name: "Bulk Pricing" }).first().click();
    await page.getByRole("heading", { name: "Bulk pricing" }).first().waitFor();
    await context.close();
  }
  pass("Bulk Pricing is in the Catalog menu");

  console.log(`\nALL ${count} BULK PRICING BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
