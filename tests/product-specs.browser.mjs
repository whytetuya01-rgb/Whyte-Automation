/**
 * Category-driven product specifications end to end (real Chromium, isolated production server, throwaway MongoDB):
 * a company defines fields on a category (text / number + unit / dropdown), sub-categories inherit them, products fill
 * them in, the quotation picker and the PDF show only the fields marked for them; another company never sees them;
 * in-use types and options are protected; prices, products and quotation totals are untouched.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/product-specs.browser.mjs
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
const dec = (value) => Decimal128.fromString(value);
const str = (value) => (value === null || value === undefined ? null : String(value));

try {
  server = await startIsolatedServer("product-specs", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  const cat = (id, companyId, name, level, parentId) => ({ _id: id, companyId, name, level, parentId, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, 20, "Tactus", 1, null), cat(202, 20, "Tactus Switches", 2, 201), cat(203, 20, "Accessories", 1, null), cat(301, 30, "Tactus", 1, null)]);
  for (const [cid, base] of [[20, 200], [30, 300]]) {
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
  }
  const product = (id, companyId, name, categoryId) => ({ _id: id, companyId, name, code: `P-${id}`, type: "switch_board", categoryId, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(2001, 20, "Smart Switch", 202), product(2002, 20, "Gateway", 203), product(3001, 30, "Beta Switch", 301)]);
  await db.collection("productvariants").insertMany([
    { _id: 2001, companyId: 20, productId: 2001, variantCode: "V-2001", config: {}, price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: 2002, companyId: 20, productId: 2002, variantCode: "V-2002", config: {}, price: dec("500.00"), priceWithoutTax: dec("423.73"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: 3001, companyId: 30, productId: 3001, variantCode: "V-3001", config: {}, price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const before = { products: await db.collection("products").find({}).sort({ _id: 1 }).toArray(), variants: await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray() };
  const cookie = { a: await login("ownera@example.com", "admin"), dealerA: await login("dealera@example.com", "user"), b: await login("ownerb@example.com", "admin") };

  // ── fields API ──
  const put = (c, id, fields) => api(c, "PUT", `/api/categories/${id}/spec-fields`, { fields });
  const warranty = { key: "warranty", label: "Warranty", type: "number", unit: "years", showOnPdf: true, showInPicker: true };
  const load = { key: "load", label: "Load", type: "number", unit: "A", required: true, showOnPdf: true, showInPicker: true };
  const glass = { key: "glass", label: "Glass colour", type: "select", options: ["Black", "White"], showOnPdf: true };
  const note = { key: "internal_note", label: "Internal note", type: "text" };
  assert.equal((await put(cookie.a, 201, [warranty])).status, 200);
  assert.equal((await put(cookie.a, 202, [load, glass, note])).status, 200);
  assert.equal((await put(cookie.a, 202, [{ ...load, key: "warranty" }])).status, 400, "a key already defined above is refused");
  assert.equal((await put(cookie.a, 201, [{ ...warranty }, { key: "load", label: "Other", type: "text" }])).status, 400, "nor one defined below");
  assert.equal((await put(cookie.a, 202, [{ key: "x", label: "X", type: "select" }])).status, 400, "a dropdown needs options");
  assert.equal((await put(cookie.dealerA, 201, [])).status, 403, "dealers cannot define fields");
  assert.equal((await put(cookie.b, 201, [])).status, 404, "another company's category is not found");
  const got = await api(cookie.a, "GET", "/api/categories/202/spec-fields");
  assert.deepEqual([got.data.fields.map((f) => f.key), got.data.inherited.map((f) => f.key)], [["load", "glass", "internal_note"], ["warranty"]]);
  assert.deepEqual((await api(cookie.b, "GET", "/api/categories/301/spec-fields")).data.fields, [], "company B has none");
  assert.equal((await api(cookie.a, "GET", "/api/categories/301/spec-fields")).status, 404);
  pass("fields are defined per category and inherited by sub-categories; clashes, dropdowns without options, dealers and other companies are refused");

  // ── product values API ──
  const patch = (c, id, body) => api(c, "PATCH", `/api/products/${id}`, body);
  assert.equal((await patch(cookie.a, 2001, { specs: { warranty: 5, load: 16, glass: "Black", internal_note: "kept private" } })).status, 200);
  assert.deepEqual((await db.collection("products").findOne({ _id: 2001 })).specs, { warranty: 5, load: 16, glass: "Black", internal_note: "kept private" });
  assert.equal((await patch(cookie.a, 2001, { specs: { warranty: 5, glass: "Red" } })).status, 400, "a dropdown value must be an option");
  assert.equal((await patch(cookie.a, 2001, { specs: { warranty: 5 } })).status, 400, "a required field must be filled");
  assert.equal((await patch(cookie.a, 2001, { specs: { load: "abc" } })).status, 400);
  assert.equal((await patch(cookie.a, 2002, { specs: { load: 1 } })).status, 400, "a product only takes its own category's fields");
  assert.equal((await patch(cookie.b, 2001, { specs: {} })).status, 404, "another company cannot touch the product");
  assert.equal((await patch(cookie.a, 2001, { name: "Smart Switch Pro" })).status, 200, "an unrelated edit keeps the values");
  assert.equal((await db.collection("products").findOne({ _id: 2001 })).specs.load, 16);
  assert.equal((await put(cookie.a, 202, [{ ...load, type: "text" }, glass, note])).status, 409, "a field in use cannot change type");
  assert.equal((await put(cookie.a, 202, [load, { ...glass, options: ["White"] }, note])).status, 409, "an option in use cannot be removed");
  assert.equal((await put(cookie.a, 202, [load, { ...glass, options: ["Black", "White", "Grey"] }, note])).status, 200, "options can be added");
  pass("products take values for their category's fields (typed, required, dropdown options); unrelated edits keep them; in-use types and options are protected");

  // ── product picker and PDF data ──
  const created = await api(cookie.dealerA, "POST", "/api/quotations", { clientName: "Client", houseTypeId: 201 });
  const qid = created.data.id ?? created.data._id;
  const roomId = (await api(cookie.dealerA, "GET", `/api/quotations/${qid}`)).data.rooms[0].id;
  assert.equal((await api(cookie.dealerA, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 2001, quantity: 2 })).status, 201);
  assert.equal((await api(cookie.dealerA, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomId, productId: 2002, productVariantId: 2002, quantity: 1 })).status, 201);
  const itemsBefore = await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray();
  const catalogSpecs = (await api(cookie.dealerA, "GET", "/api/catalog/spec-fields")).json;
  const sw = catalogSpecs.categories.find((c) => c.id === 202);
  assert.deepEqual(sw.specFields.map((f) => f.key), ["load", "glass"], "the PDF endpoint lists only the fields marked for the PDF");
  assert.deepEqual((await api(cookie.b, "GET", "/api/catalog/spec-fields")).json.categories.map((c) => c.id), [301], "company B sees only its own categories");

  // ── screens ──
  browser = await chromium.launch({ headless: true });
  const open = async (c, viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(c.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const onScreen = async (locator, width) => {
    const box = await locator.boundingBox();
    return Boolean(box) && box.x >= 0 && box.x + box.width <= width + 1 && box.width > 0 && box.height > 0;
  };
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };

  // Each pass opens what the previous one saved: the desktop pass starts from no fields, the phone pass finds the desktop's.
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "load" });
    const card = page.locator("div.group", { has: page.getByRole("heading", { name: "Accessories", exact: true }) }).first();
    await card.getByTitle("Actions").click();
    const menuItem = page.getByRole("button", { name: "Specifications" });
    assert.ok(await onScreen(menuItem, viewport.width), `the actions menu is on screen at ${viewport.width}px`);
    await menuItem.click();
    const modal = page.getByTestId("spec-fields");
    await modal.waitFor();
    if (viewport.width >= 768) {
      await modal.getByTestId("spec-empty").waitFor();
    } else {
      await modal.getByTestId("spec-field-row").filter({ hasText: "Finish type" }).waitFor();
    }
    await modal.getByTestId("spec-add-field").click();
    const editor = modal.getByTestId("spec-field-editor");
    const label = viewport.width >= 768 ? "Finish type" : "Pack size";
    await editor.getByTestId("spec-field-label").fill(label);
    await editor.getByRole("button", { name: "Field type" }).click();
    const option = page.getByRole("option", { name: "Dropdown", exact: true });
    assert.ok(await onScreen(option, viewport.width), `the type dropdown opens on screen at ${viewport.width}px`);
    await option.click();
    for (const value of ["Small", "Large"]) {
      await editor.getByTestId("spec-option-input").fill(value);
      await editor.getByTestId("spec-option-input").press("Enter");
    }
    await editor.getByText("Show in product picker").click();
    assert.ok(await onScreen(editor.getByTestId("spec-field-done"), viewport.width), `the field buttons are not clipped at ${viewport.width}px`);
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll with the editor open at ${viewport.width}px`);
    await shot(page, `spec-fields-${viewport.width}`);
    await editor.getByTestId("spec-field-done").click();
    await modal.getByTestId("spec-field-row").filter({ hasText: label }).waitFor();
    await modal.getByTestId("spec-fields-save").click();
    await page.locator("text=Specification fields saved").first().waitFor();
    const saved = (await db.collection("categories").findOne({ _id: 203 })).specFields;
    assert.ok(saved.some((f) => f.label === label && f.type === "select" && f.options.join() === "Small,Large" && f.showInPicker === true));
    await page.context().close();
  }
  // the second pass saw the first pass's field: both are stored, in order
  assert.equal((await db.collection("categories").findOne({ _id: 203 })).specFields.length, 2);
  pass("the Categories page defines a dropdown field (options, picker flag) on desktop and at 375px, saved in order, no overflow");

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    const view = page.getByTestId("product-specs-view");
    await view.getByText("Glass colour").waitFor();
    const [shownLoad, shownGlass] = viewport.width >= 768 ? ["16 A", "Black"] : ["20 A", "White"]; // the phone pass sees what the desktop pass saved
    const viewText = (await view.innerText()).split("\n").join(" ");
    assert.ok(viewText.includes(`Load ${shownLoad}`), `the product page shows Load ${shownLoad}: ${viewText}`);
    assert.ok(viewText.includes(`Glass colour ${shownGlass}`), `the product page shows Glass colour ${shownGlass}: ${viewText}`);
    assert.match(await view.innerText(), /Warranty[\s\S]*5 years/, "the inherited field shows too");
    await page.getByRole("button", { name: "Edit Product" }).click();
    const form = page.getByTestId("product-specs");
    await form.waitFor();
    const loadValue = viewport.width >= 768 ? "20" : "25";
    await form.getByLabel("Load").fill(loadValue);
    await form.getByRole("button", { name: "Glass colour" }).click();
    const option = page.getByRole("option", { name: viewport.width >= 768 ? "White" : "Grey", exact: true });
    assert.ok(await onScreen(option, viewport.width), `the dropdown opens on screen at ${viewport.width}px`);
    await option.click();
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll in the product form at ${viewport.width}px`);
    await shot(page, `product-specs-${viewport.width}`);
    await form.getByLabel("Load").fill("");
    await page.getByRole("button", { name: "Update Product" }).click();
    await form.getByText("Load is required.").waitFor();
    assert.equal((await db.collection("products").findOne({ _id: 2001 })).specs.load !== undefined, true, "a missing required value blocks the save");
    await form.getByLabel("Load").fill(loadValue);
    await page.getByRole("button", { name: "Update Product" }).click();
    await page.locator("text=Product updated").first().waitFor();
    const specs = (await db.collection("products").findOne({ _id: 2001 })).specs;
    assert.deepEqual([specs.load, specs.glass, specs.warranty], [Number(loadValue), viewport.width >= 768 ? "White" : "Grey", 5]);
    await page.context().close();
  }
  pass("the product form shows the category's fields (text / number + unit / dropdown, inherited ones too), requires the required ones and saves at 1280px and 375px");

  {
    const page = await open(cookie.dealerA, { width: 1280, height: 900 });
    await page.goto(`${baseUrl}/quotation/${qid}?step=3`, { waitUntil: "domcontentloaded" });
    const pickerSpecs = page.getByTestId("picker-specs");
    await pickerSpecs.first().waitFor();
    const text = await pickerSpecs.first().innerText();
    assert.match(text, /Warranty[\s\S]*5 years/);
    assert.match(text, /Load[\s\S]*A/);
    assert.ok(!/Glass|Internal|private/.test(text), "only fields marked for the picker show there");
    assert.equal(await pickerSpecs.count(), 1, "a product without specs shows none");
    await page.context().close();
  }
  pass("the quotation product picker shows only the fields marked for it, and nothing for products without values");

  {
    const page = await open(cookie.dealerA, { width: 1280, height: 900 });
    await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.getByTestId("proposal-specs").first().waitFor();
    await page.waitForTimeout(1500);
    const pages = page.locator(".proposal-page");
    const text = (await pages.evaluateAll((els) => els.map((el) => el.innerText))).join("\n");
    assert.match(text, /Load:\s*\d+ A/);
    assert.match(text, /Glass colour:\s*Grey/);
    assert.ok(!/Internal note|kept private/.test(text), "fields not marked for the PDF never appear");
    assert.equal(await page.getByTestId("proposal-specs").count(), 1, "one specification list: the Gateway has none");
    const overflow = await pages.evaluateAll((els) => els.some((el) => el.scrollHeight > 1123 + 2));
    assert.equal(overflow, false, "no page overflows the A4 canvas");
    if (process.env.SCREENSHOT_DIR) await pages.nth(await pages.count() - 2).screenshot({ path: `${process.env.SCREENSHOT_DIR}/spec-pdf-page.png` }).catch(() => {});
    await page.context().close();
  }
  pass("the quotation PDF lists the fields marked for it under the product (units included), none of the others, and no page overflows");

  // ── isolation and nothing else changed ──
  assert.equal((await db.collection("categories").findOne({ _id: 301 })).specFields, undefined, "company B's category untouched");
  assert.equal((await db.collection("products").findOne({ _id: 3001 })).specs, undefined);
  assert.deepEqual(await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray(), itemsBefore, "quotation items are untouched");
  assert.deepEqual((await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()), before.variants, "no variant or price changed");
  const after = await db.collection("products").find({}).sort({ _id: 1 }).toArray();
  assert.deepEqual(after.map((p) => [p._id, p.categoryId, p.companyId]), before.products.map((p) => [p._id, p.categoryId, p.companyId]), "no product moved or was added");
  const totals = (await api(cookie.dealerA, "GET", `/api/quotations/${qid}`)).data;
  assert.equal(Number(totals.subtotal), 2500, "quotation totals are unchanged (2 x 1000 + 500)");
  pass("company B and quotation items, variants, prices, products and totals are untouched");

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
