/**
 * GST rates and HSN/SAC codes end to end (real Chromium, isolated production server, throwaway local MongoDB): two
 * companies manage their own rates and codes; products pick a code and a rate; a rate change re-splits variant prices
 * WITHOUT changing any price; existing quotation items keep their snapshot; new items quote the same price; the admin
 * screens work at 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/tax-settings.browser.mjs
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
  server = await startIsolatedServer("tax-settings", [
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
  const cat = (id, companyId, name) => ({ _id: id, companyId, name, level: 1, parentId: null, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, 20, "Tactus"), cat(301, 30, "Tactus")]);
  for (const [cid, base] of [[20, 200], [30, 300]]) {
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
  }
  const product = (id, companyId, name, categoryId) => ({ _id: id, companyId, name, code: `P-${id}`, type: "switch_board", categoryId, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(2001, 20, "Legacy Switch", 201), product(2002, 20, "Gateway", 201), product(3001, 30, "Beta Switch", 301)]);
  await db.collection("productvariants").insertMany([
    // An older catalogue row: GST-inclusive price only, no tax fields stored.
    { _id: 2001, companyId: 20, productId: 2001, variantCode: "V-2001", config: {}, price: dec("5799.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: 2002, companyId: 20, productId: 2002, variantCode: "V-2002", config: {}, price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: 3001, companyId: 30, productId: 3001, variantCode: "V-3001", config: {}, price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const variantPrices = async () => Object.fromEntries((await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()).map((v) => [v._id, str(v.price)]));
  const pricesBefore = await variantPrices();
  const productsBefore = await db.collection("products").countDocuments();
  const betaVariantBefore = await db.collection("productvariants").findOne({ _id: 3001 });
  const cookie = { a: await login("ownera@example.com", "admin"), dealerA: await login("dealera@example.com", "user"), b: await login("ownerb@example.com", "admin") };

  // ── company settings ──
  let res = await api(cookie.a, "GET", "/api/catalog/tax-settings");
  assert.equal(res.status, 200, res.text?.slice(0, 200));
  assert.deepEqual([res.data.gstRates, res.data.defaultGstRate, res.data.hsnCodes, res.data.canManage, res.data.totalProducts, res.data.unclassifiedProducts], [[0, 5, 18, 40], 18, [], true, 2, 2]);
  assert.equal((await api(cookie.dealerA, "PUT", "/api/catalog/tax-settings", { gstRates: [18], defaultGstRate: 18 })).status, 403, "dealers cannot change GST rates");
  res = await api(cookie.a, "PUT", "/api/catalog/tax-settings", { gstRates: [18, 40, 0, 12, 5], defaultGstRate: 18 });
  assert.equal(res.status, 200, res.text?.slice(0, 200));
  assert.deepEqual(res.data.gstRates, [0, 5, 12, 18, 40]);
  assert.equal((await api(cookie.a, "PUT", "/api/catalog/tax-settings", { gstRates: [5], defaultGstRate: 18 })).status, 400, "the default must be allowed");
  assert.equal((await api(cookie.a, "PUT", "/api/catalog/tax-settings", { gstRates: [18], defaultGstRate: 18, companyId: 30 })).status, 400, "unknown keys are refused");

  const post = (c, body) => api(c, "POST", "/api/catalog/tax-settings/hsn-codes", body);
  assert.equal((await post(cookie.a, { kind: "hsn", code: "8536", description: "Switches and sockets", gstRate: 18 })).status, 201);
  assert.equal((await post(cookie.a, { kind: "hsn", code: "8536", gstRate: 18 })).status, 409, "codes are unique per company");
  assert.equal((await post(cookie.a, { kind: "hsn", code: "85", gstRate: 18 })).status, 400);
  assert.equal((await post(cookie.a, { kind: "hsn", code: "8537", gstRate: 7 })).status, 400, "the rate must be one of the company's");
  assert.equal((await post(cookie.a, { kind: "sac", code: "998713", description: "Installation", gstRate: 18 })).status, 201);
  assert.equal((await post(cookie.dealerA, { kind: "hsn", code: "8538", gstRate: 18 })).status, 403, "dealers cannot add codes");

  res = await api(cookie.b, "GET", "/api/catalog/tax-settings");
  assert.deepEqual([res.data.gstRates, res.data.hsnCodes, res.data.totalProducts], [[0, 5, 18, 40], [], 1], "company B sees only its own settings and products");
  assert.equal((await api(cookie.b, "PATCH", "/api/catalog/tax-settings/hsn-codes/8536", { gstRate: 5 })).status, 404, "B cannot edit A's code");
  assert.equal((await api(cookie.b, "DELETE", "/api/catalog/tax-settings/hsn-codes/8536")).status, 404, "nor delete it");
  assert.equal((await api(cookie.b, "POST", "/api/catalog/tax-settings/hsn-codes/8536/apply")).status, 404, "nor apply it");
  assert.equal((await post(cookie.b, { kind: "hsn", code: "8536", gstRate: 18 })).status, 201, "B keeps its own list");
  assert.equal((await api(cookie.a, "GET", "/api/catalog/tax-settings")).data.hsnCodes.find((e) => e.code === "8536").gstRate, 18, "A's code untouched by B");
  pass("each company keeps its own GST rates and HSN/SAC codes; dealers and other companies are refused; input is strict");

  // ── an existing quotation, before any rate change ──
  const created = await api(cookie.dealerA, "POST", "/api/quotations", { clientName: "Client", houseTypeId: 201 });
  assert.equal(created.status, 201, created.text?.slice(0, 160));
  const quotationId = created.data.id ?? created.data._id;
  const roomId = (await api(cookie.dealerA, "GET", `/api/quotations/${quotationId}`)).data.rooms[0].id;
  const addItem = async (productId) => {
    const item = await api(cookie.dealerA, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: roomId, productId, productVariantId: productId, quantity: 2 });
    assert.equal(item.status, 201, item.text?.slice(0, 160));
    return db.collection("quotationitems").findOne({ _id: item.data.id ?? item.data._id });
  };
  const legacyBefore = await addItem(2001);
  const gatewayBefore = await addItem(2002);
  assert.equal(str(gatewayBefore.unitPrice), "1000.00");
  console.log(`    observed before any change (pre-existing behaviour, not asserted): a price-only variant of ₹5799.00 is quoted at ₹${str(legacyBefore.unitPrice)} by POST /items`);
  const itemsBefore = await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray();
  const quotationBefore = await db.collection("quotations").findOne({ _id: quotationId });

  // ── product HSN/SAC + GST ──
  const patchProduct = (c, id, body) => api(c, "PATCH", `/api/products/${id}`, body);
  res = await patchProduct(cookie.a, 2001, { hsnCode: "8536", gstRate: 5 });
  assert.equal(res.status, 200, res.text?.slice(0, 200));
  assert.deepEqual([res.data.hsnCode, res.data.gstRate, res.json.meta?.taxChange?.changed], ["8536", 5, 1]);
  let legacy = await db.collection("productvariants").findOne({ _id: 2001 });
  assert.deepEqual([str(legacy.price), str(legacy.taxPercent)], ["5799.00", "5.00"], "the GST-inclusive price is unchanged; the rate is 5%");
  assert.ok(legacy.priceWithoutTax === null || str(legacy.priceWithoutTax) === "5522.86", `split 5799 = pre-tax + 5% (got ${str(legacy.priceWithoutTax)})`);
  res = await patchProduct(cookie.a, 2002, { hsnCode: "8536", gstRate: 18 });
  assert.deepEqual([res.status, res.json.meta?.taxChange?.changed], [200, 0], "already at 18%: nothing rewritten");
  assert.equal((await patchProduct(cookie.a, 2002, { gstRate: 28 })).status, 400, "a rate outside the company's list is refused");
  assert.equal((await patchProduct(cookie.a, 2002, { hsnCode: "9999" })).status, 400, "a code outside the company's list is refused");
  assert.equal((await patchProduct(cookie.b, 2001, { gstRate: 18 })).status, 404, "B cannot touch A's product");
  res = await patchProduct(cookie.a, 2002, { gstRate: 18, name: "Gateway Pro" });
  assert.deepEqual([res.status, res.json.meta?.taxChange], [200, undefined], "an unchanged rate never touches the variants");
  pass("a product takes an HSN/SAC code and GST rate from its company's lists; a new rate re-splits the variant without changing its price");

  // ── quotations ──
  assert.deepEqual(await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray(), itemsBefore, "existing quotation items keep their exact snapshot");
  assert.deepEqual(await db.collection("quotations").findOne({ _id: quotationId }), quotationBefore, "the quotation itself is untouched");
  const legacyAfter = await addItem(2001);
  const gatewayAfter = await addItem(2002);
  assert.deepEqual([str(legacyAfter.unitPrice), str(legacyAfter.taxPercent)], ["5799.00", "5.00"], "a new item quotes the GST-inclusive price, with the new split");
  assert.deepEqual([str(gatewayAfter.unitPrice), str(gatewayAfter.taxPercent)], ["1000.00", "18.00"]);
  const totals = (await api(cookie.dealerA, "GET", `/api/quotations/${quotationId}`)).data;
  assert.ok(totals.rooms[0].items.length === 4);
  pass("existing quotation items and the quotation are unchanged; new items quote the same GST-inclusive price with the new tax split");

  // ── HSN rate change, applied explicitly ──
  assert.equal((await api(cookie.a, "PATCH", "/api/catalog/tax-settings/hsn-codes/8536", { gstRate: 12 })).status, 200);
  assert.equal((await db.collection("products").findOne({ _id: 2001 })).gstRate, 5, "changing a code's rate does not touch products by itself");
  res = await api(cookie.a, "POST", "/api/catalog/tax-settings/hsn-codes/8536/apply");
  assert.equal(res.status, 200, res.text?.slice(0, 200));
  assert.deepEqual([res.data.products, res.data.variants, res.data.changed, res.data.realigned], [2, 2, 2, 0]);
  const appliedProducts = await db.collection("products").find({ _id: { $in: [2001, 2002] } }).toArray();
  assert.ok(appliedProducts.every((p) => p.gstRate === 12), "both products now at 12%");
  const gateway = await db.collection("productvariants").findOne({ _id: 2002 });
  assert.deepEqual([str(gateway.price), str(gateway.taxPercent)], ["1000.00", "12.00"]);
  assert.equal((await db.collection("products").findOne({ _id: 3001 })).gstRate ?? null, null, "B's product untouched");
  assert.equal((await api(cookie.a, "PUT", "/api/catalog/tax-settings", { gstRates: [0, 5, 18, 40], defaultGstRate: 18 })).status, 409, "a rate in use cannot be removed");
  assert.equal((await api(cookie.a, "DELETE", "/api/catalog/tax-settings/hsn-codes/8536")).status, 409, "a code in use cannot be removed");
  assert.equal((await api(cookie.a, "DELETE", "/api/catalog/tax-settings/hsn-codes/998713")).status, 200);
  assert.equal((await api(cookie.a, "PATCH", "/api/catalog/tax-settings/hsn-codes/8536", { isActive: false })).status, 200);
  assert.equal((await patchProduct(cookie.a, 2002, { hsnCode: "8536", name: "Gateway" })).status, 200, "a product keeps a code that was later deactivated");
  assert.equal((await api(cookie.a, "PATCH", "/api/catalog/tax-settings/hsn-codes/8536", { isActive: true })).status, 200);
  pass("a code's new rate reaches its products only through 'Apply', all prices kept; in-use rates and codes cannot be removed");

  // ── nothing else changed ──
  assert.deepEqual(await variantPrices(), pricesBefore, "every variant price (both companies) is exactly as before");
  assert.equal(await db.collection("products").countDocuments(), productsBefore);
  assert.deepEqual(await db.collection("productvariants").findOne({ _id: 3001 }), betaVariantBefore, "company B's variant is byte-for-byte untouched");
  pass("no price changed anywhere; product and variant counts unchanged; the other company untouched");

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

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/tax-settings`, { waitUntil: "load" });
    await page.getByTestId("gst-rates-card").waitFor();
    await page.getByTestId("tax-inclusive-note").waitFor();
    assert.equal(await page.getByTestId("gst-rate-chip").count(), viewport.width >= 768 ? 5 : 6, "each pass sees the rate the previous one added");
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll at ${viewport.width}px`);
    if (viewport.width >= 768) {
      assert.ok(await page.getByTestId("hsn-table").isVisible(), "a table on wide screens");
    } else {
      assert.ok(await page.getByTestId("hsn-cards").isVisible(), "cards on phones");
      assert.equal(await page.getByTestId("hsn-table").isVisible(), false);
    }
    await shot(page, `tax-settings-${viewport.width}`);

    const rate = viewport.width >= 768 ? "3" : "0.25";
    await page.getByTestId("gst-rate-input").fill(rate);
    await page.getByTestId("gst-rate-add").click();
    await page.getByTestId("gst-rates-save").click();
    await page.locator("text=GST rates saved").first().waitFor();
    assert.ok((await db.collection("companies").findOne({ _id: 20 })).taxSettings.gstRates.includes(Number(rate)), `rate ${rate}% saved`);

    const code = viewport.width >= 768 ? "8517" : "8471";
    await page.getByTestId("hsn-add").click();
    const form = page.getByTestId("hsn-code-form");
    await form.waitFor();
    await form.getByTestId("hsn-code-input").fill(code);
    await form.getByTestId("hsn-description-input").fill(`Controllers ${viewport.width}`);
    await form.getByRole("button", { name: "GST rate for this code" }).click();
    const option = page.getByRole("option", { name: `${rate}%`, exact: true });
    await option.waitFor();
    assert.ok(await onScreen(option, viewport.width), `the rate dropdown opens on screen at ${viewport.width}px`);
    await option.click();
    assert.ok(await onScreen(form.getByTestId("hsn-code-save"), viewport.width), `the Add button is not clipped at ${viewport.width}px`);
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll with the form open at ${viewport.width}px`);
    await shot(page, `tax-code-form-${viewport.width}`);
    await form.getByTestId("hsn-code-save").click();
    await page.locator("text=Code added").first().waitFor();
    const savedCode = (await db.collection("companies").findOne({ _id: 20 })).taxSettings.hsnCodes.find((e) => e.code === code);
    assert.deepEqual([savedCode?.gstRate, savedCode?.description], [Number(rate), `Controllers ${viewport.width}`]);
    await page.getByTestId(viewport.width >= 768 ? "hsn-row" : "hsn-card").filter({ hasText: code }).first().waitFor();
    await page.context().close();
  }
  pass("the GST & HSN/SAC page adds a rate and a code (accessible dropdown) at 1280px and 375px, table vs cards, no overflow");

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/products/2002`, { waitUntil: "load" });
    const [shownCode, shownRate] = viewport.width >= 768 ? ["8536", /12%/] : ["8517", /3%/];
    await page.getByTestId("product-hsn").getByText(shownCode).waitFor();
    assert.match(await page.getByTestId("product-gst").innerText(), shownRate, "the product page shows its code and rate");
    await page.getByRole("button", { name: "Edit Product" }).click();
    const hsnField = page.getByTestId("product-hsn-field");
    await hsnField.waitFor();
    const code = viewport.width >= 768 ? "8517" : "8471";
    const rate = viewport.width >= 768 ? "3%" : "0.25%";
    await hsnField.getByRole("button", { name: "HSN/SAC code" }).click();
    const option = page.getByRole("option", { name: new RegExp(`HSN ${code}`) });
    await option.waitFor();
    assert.ok(await onScreen(option, viewport.width), `the HSN dropdown opens on screen at ${viewport.width}px`);
    await option.click();
    await page.getByTestId("product-gst-field").getByText(rate, { exact: true }).waitFor();
    assert.match(await page.getByTestId("product-gst-help").innerText(), /prices themselves stay the same/);
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll in the product form at ${viewport.width}px`);
    await shot(page, `product-tax-fields-${viewport.width}`);
    await page.getByRole("button", { name: "Update Product" }).click();
    await page.locator("text=Product updated").first().waitFor();
    const saved = await db.collection("products").findOne({ _id: 2002 });
    const variant = await db.collection("productvariants").findOne({ _id: 2002 });
    assert.deepEqual([saved.hsnCode, saved.gstRate, str(variant.price), Number(str(variant.taxPercent))], [code, Number.parseFloat(rate), "1000.00", Number.parseFloat(rate)]);
    await page.context().close();
  }
  pass("the product form picks an HSN/SAC code (searchable, accessible), fills its GST rate and saves at 1280px and 375px; the price stays ₹1000.00");

  assert.deepEqual(await variantPrices(), pricesBefore, "still no price changed after the UI edits");
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
