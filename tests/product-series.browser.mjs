/**
 * Product series end to end (real Chromium, isolated production server, throwaway local MongoDB): a company admin
 * marks a top-level category as a series (description, image, show on PDF) from the Categories page on desktop and
 * phone; the API refuses sub-categories, other companies' categories and images, dealers and unknown keys; the
 * quotation document gets a Product Series page with only the series its products use, never another company's;
 * existing products and categories are untouched.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/product-series.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";
import { png } from "./helpers/imageFixtures.mjs";

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
const IMG = (cid, name) => ({ url: `https://res.cloudinary.com/testcloud/image/upload/v1/whyte/companies/${cid}/products/${name}.png`, publicId: `whyte/companies/${cid}/products/${name}` });

try {
  server = await startIsolatedServer("product-series", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
    { _id: 4, email: "dealerb@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 10, companyId: 30 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  // Company A: "Tactus" (series-to-be) with a sub-category, and "Accessories" (a type group). Company B: its own "Tactus".
  const cat = (id, companyId, name, level, parentId) => ({ _id: id, companyId, name, level, parentId, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, 20, "Tactus", 1, null), cat(202, 20, "Tactus Switches", 2, 201), cat(203, 20, "Accessories", 1, null), cat(301, 30, "Tactus", 1, null)]);
  for (const [cid, base, categoryId, accessoryCategory] of [[20, 200, 202, 203], [30, 300, 301, 301]]) {
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    for (const [pid, name, catId] of [[base + 1, "Smart Switch", categoryId], [base + 2, "Gateway", accessoryCategory]]) {
      await db.collection("products").insertOne({ _id: pid, companyId: cid, name, code: `P-${pid}`, type: "switch_board", categoryId: catId, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
      await db.collection("productvariants").insertOne({ _id: pid, companyId: cid, productId: pid, variantCode: `V-${pid}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("847.46"), taxPercent: Decimal128.fromString("18.00"), cost: Decimal128.fromString("0.00"), purchaseTaxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
    }
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const before = { products: await db.collection("products").find({}).sort({ _id: 1 }).toArray(), variants: await db.collection("productvariants").countDocuments() };
  const cookie = { a: await login("ownera@example.com", "admin"), dealerA: await login("dealera@example.com", "user"), b: await login("ownerb@example.com", "admin"), dealerB: await login("dealerb@example.com", "user") };
  const makeQuotation = async (c, base) => {
    const created = await api(c, "POST", "/api/quotations", { clientName: "Client", houseTypeId: base + 1 });
    assert.equal(created.status, 201, created.text?.slice(0, 160));
    const id = created.data.id ?? created.data._id;
    const room = (await api(c, "GET", `/api/quotations/${id}`)).data.rooms[0];
    for (const pid of [base + 1, base + 2]) {
      const item = await api(c, "POST", `/api/quotations/${id}/items`, { quotationRoomId: room.id, productId: pid, productVariantId: pid, quantity: 1 });
      assert.equal(item.status, 201, item.text?.slice(0, 160));
    }
    return id;
  };
  const quotationA = await makeQuotation(cookie.dealerA, 200);
  const quotationB = await makeQuotation(cookie.dealerB, 300);

  // ── API ──
  const patch = (c, id, body) => api(c, "PATCH", `/api/categories/${id}/series`, body);
  let res = await patch(cookie.a, 201, { enabled: true, description: "Toughened glass touch panels.\nNight glow.", showOnPdf: true, image: IMG(20, "tactus") });
  assert.equal(res.status, 200, res.text?.slice(0, 200));
  assert.deepEqual([res.data.series.enabled, res.data.series.showOnPdf, res.data.series.imagePublicId], [true, true, "whyte/companies/20/products/tactus"]);
  assert.equal((await patch(cookie.a, 202, { enabled: true })).status, 400, "a sub-category cannot be a series");
  assert.equal((await patch(cookie.a, 301, { enabled: true })).status, 404, "another company's category is not found");
  assert.equal((await patch(cookie.b, 201, { enabled: false })).status, 404, "nor can B touch A's");
  assert.equal((await patch(cookie.a, 203, { image: IMG(30, "stolen") })).status, 403, "another company's image is refused");
  assert.equal((await patch(cookie.a, 203, { image: { url: IMG(20, "a").url, publicId: "whyte/companies/20/products/other" } })).status, 400, "the URL must be the uploaded image");
  assert.equal((await patch(cookie.dealerA, 201, { enabled: false })).status, 403, "dealers cannot manage series");
  assert.equal((await patch(cookie.a, 201, { companyId: 30 })).status, 400, "unknown keys are refused");
  assert.equal((await db.collection("categories").findOne({ _id: 301 })).series ?? null, null, "B's category untouched");
  const catalogA = (await api(cookie.dealerA, "GET", "/api/catalog/series")).json;
  assert.deepEqual(catalogA.series.map((s) => s.name), ["Tactus"], "dealer A sees A's series only (Accessories is not a series)");
  assert.equal(catalogA.rootOf["202"], 201, "the sub-category maps to its series");
  assert.deepEqual((await api(cookie.dealerB, "GET", "/api/catalog/series")).json.series, [], "B has none");
  pass("the series API: top-level only, own categories and images only, dealers refused, strict; the catalog is per company");

  browser = await chromium.launch({ headless: true });
  const open = async (c, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await context.route("https://res.cloudinary.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png(240, 160, [30, 60, 115, 255]) }));
    await context.addCookies(c.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };

  // ── admin screen, desktop then phone (each pass opens what the previous one saved) ──
  let savedDescription = "Toughened glass touch panels.\nNight glow.";
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "load" });
    const tactusCard = page.locator("div.group", { has: page.getByRole("heading", { name: "Tactus", exact: true }) }).first();
    await tactusCard.getByTestId("series-badges").getByText("On PDF").waitFor();
    assert.equal(await page.locator("div.group", { has: page.getByRole("heading", { name: "Accessories", exact: true }) }).getByTestId("series-badges").count(), 0, "type groups carry no series badge");
    const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const onScreen = async (locator) => {
      const box = await locator.boundingBox();
      return Boolean(box) && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.width > 0 && box.height > 0;
    };
    assert.ok(await noHorizontalScroll(), `the Categories page has no horizontal scroll at ${viewport.width}px`);
    await tactusCard.getByTitle("Actions").click();
    const menuItem = page.getByRole("button", { name: "Series settings" });
    await menuItem.waitFor();
    assert.ok(await onScreen(menuItem), `the actions menu is fully on screen at ${viewport.width}px`);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/series-menu-${viewport.width}.png` });
    await menuItem.click();
    const modal = page.getByTestId("series-settings");
    await modal.waitFor();
    assert.equal(await modal.getByTestId("series-description").inputValue(), savedDescription);
    await modal.getByTestId("series-image-frame").locator("img").waitFor();
    assert.ok(await noHorizontalScroll(), `no horizontal scroll with the modal open at ${viewport.width}px`);
    await modal.getByTestId("series-save").scrollIntoViewIfNeeded();
    assert.ok(await onScreen(modal.getByTestId("series-save")), `the Save button is not clipped at ${viewport.width}px`);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/series-modal-${viewport.width}.png` });
    await modal.getByTestId("series-description").fill(`Toughened glass touch panels (${viewport.width}).`);
    await modal.getByTestId("series-save").click();
    await page.locator("text=Series saved").first().waitFor();
    savedDescription = `Toughened glass touch panels (${viewport.width}).`;
    assert.equal((await db.collection("categories").findOne({ _id: 201 })).series.description, savedDescription, "saved to the database");
    await page.context().close();
  }
  pass("the Categories page shows series badges and edits description, image and PDF option on desktop and at 375px (saved to the database)");

  // ── the quotation document ──
  const documentOf = async (c, id) => {
    const page = await open(c);
    await page.goto(`${baseUrl}/quotation/${id}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(2000);
    const text = (await page.locator(".proposal-page").evaluateAll((els) => els.map((el) => el.innerText))).join("\n");
    const seriesPage = page.locator(".proposal-page", { has: page.getByTestId("proposal-series-card") });
    if (process.env.SCREENSHOT_DIR && (await seriesPage.count()) > 0) await seriesPage.first().screenshot({ path: `${process.env.SCREENSHOT_DIR}/series-document-page.png` });
    const result = {
      text,
      pages: await page.locator(".proposal-page").count(),
      amounts: text.match(/₹\s?[\d,]+(?:\.\d+)?/g) ?? [],
      cards: await page.getByTestId("proposal-series-card").count(),
      images: await page.locator('[data-testid="proposal-series-card"] img').evaluateAll((imgs) => imgs.map((img) => img.complete && img.naturalWidth > 0)),
    };
    await page.context().close();
    return result;
  };
  let docA = await documentOf(cookie.dealerA, quotationA);
  assert.equal(docA.cards, 1, "one series card: Tactus (the Gateway is in Accessories, not a series)");
  assert.match(docA.text, /Our Product Series/i);
  assert.match(docA.text, /Toughened glass touch panels \(375\)\./);
  assert.deepEqual(docA.images, [true], "the series image loads");
  const docB = await documentOf(cookie.dealerB, quotationB);
  assert.equal(docB.cards, 0, "B's document shows no series (B marked none; A's never appears)");
  assert.ok(!/Toughened glass/.test(docB.text));
  assert.equal((await patch(cookie.a, 201, { showOnPdf: false })).status, 200);
  const withSeries = docA;
  docA = await documentOf(cookie.dealerA, quotationA);
  assert.equal(docA.cards, 0, "switching 'show on PDF' off removes the page");
  assert.equal(withSeries.pages, docA.pages + 1, "the series adds exactly one page; every other page is unchanged");
  assert.ok(docA.amounts.length > 0, "the document shows amounts");
  assert.deepEqual(withSeries.amounts, docA.amounts, "every amount on the document (items, totals, the 18% line) is identical with and without the series page");
  pass("the quotation document shows a Product Series page with only the series its products use (image + description), never another company's, and none when switched off; one extra page, identical amounts");

  // ── nothing else changed ──
  const after = await db.collection("products").find({}).sort({ _id: 1 }).toArray();
  assert.deepEqual(after.map((p) => [p._id, p.categoryId, p.name]), before.products.map((p) => [p._id, p.categoryId, p.name]), "products keep their categories");
  assert.equal(await db.collection("productvariants").countDocuments(), before.variants);
  pass("existing products, variants and categories are untouched (no migration)");

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
