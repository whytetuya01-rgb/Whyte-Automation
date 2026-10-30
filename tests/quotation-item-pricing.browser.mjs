/**
 * Quotation item pricing end to end (isolated production server, throwaway local MongoDB, real Chromium for the editor):
 * a variant that stores only its GST-inclusive price (₹5,799) is quoted at ₹5,799, never ₹0, through Add, Edit,
 * re-select, room edit, clone and the editor's Add button; GST-rate-configured, pre-tax-stored, matrix and free (₹0)
 * variants keep their prices; dealer discount, totals and the 18% charge add up; saved quotations keep their prices;
 * the catalogue is not touched.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/quotation-item-pricing.browser.mjs
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
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

try {
  server = await startIsolatedServer("item-pricing", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("roomtypes").insertOne({ _id: 201, companyId: 20, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 201, companyId: 20, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 201, companyId: 20, houseTypeId: 201, roomTypeId: 201, defaultCount: 1, sortOrder: 1 });
  const product = (id, name, extra = {}) => ({ _id: id, companyId: 20, name, code: `P-${id}`, type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("products").insertMany([
    product(2001, "Legacy Switch"),
    product(2002, "Gateway"),
    product(2003, "Taxed Lock"),
    product(2004, "Matrix Switch", { isMatrix: true }),
    product(2005, "Free Bracket"),
    product(2006, "Free Clip"),
  ]);
  const variant = (id, productId, fields, extra = {}) => ({ _id: id, companyId: 20, productId, variantCode: `V-${id}`, config: {}, isActive: true, sortOrder: id, createdAt: now, updatedAt: now, ...fields, ...extra });
  await db.collection("productvariants").insertMany([
    variant(2001, 2001, { price: dec("5799.00") }), // GST-inclusive price only, no tax fields (older catalogue rows)
    variant(2002, 2002, { price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00") }), // as the app saves it
    variant(2003, 2003, { price: dec("147.50") }), // gets a 5% GST rate below
    variant(2041, 2004, { price: dec("2500.00") }, { automationTier: "remote", surfaceFinish: "glass", config: { series: "remote", finish: "glass" } }),
    variant(2042, 2004, { price: dec("3000.00"), priceWithoutTax: dec("2542.37"), taxPercent: dec("18.00") }, { automationTier: "touch", surfaceFinish: "acrylic", config: { series: "touch", finish: "acrylic" } }),
    variant(2005, 2005, { price: dec("0.00") }), // explicitly free
    variant(2006, 2006, { price: dec("0.00"), priceWithoutTax: dec("0.00"), taxPercent: dec("18.00") }),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const owner = await login("ownera@example.com", "admin");
  const dealer = await login("dealera@example.com", "user");

  // A GST rate configured through Batch 2 (prices kept).
  const taxed = await api(owner, "PATCH", "/api/products/2003", { gstRate: 5 });
  assert.equal(taxed.status, 200, taxed.text?.slice(0, 200));
  const catalogBefore = { products: await db.collection("products").find({}).sort({ _id: 1 }).toArray(), variants: await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray() };

  const newQuotation = async (cookie) => {
    const created = await api(cookie, "POST", "/api/quotations", { clientName: "Client", houseTypeId: 201 });
    assert.equal(created.status, 201, created.text?.slice(0, 160));
    const id = created.data.id ?? created.data._id;
    const roomId = (await api(cookie, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    return { id, roomId };
  };
  const add = async (cookie, q, body) => {
    const res = await api(cookie, "POST", `/api/quotations/${q.id}/items`, { quotationRoomId: q.roomId, quantity: 1, ...body });
    return { res, item: res.status === 201 ? await db.collection("quotationitems").findOne({ _id: res.data.id ?? res.data._id }) : null };
  };
  const snap = (item) => [str(item.unitPrice), str(item.taxPercent), str(item.priceWithoutTax), str(item.taxAmount)];

  // ── an existing quotation with saved prices (one saved at ₹0 by the old bug, one at an older catalogue price) ──
  const old = await newQuotation(dealer);
  const oldLegacy = (await add(dealer, old, { productId: 2001, productVariantId: 2001 })).item;
  const oldGateway = (await add(dealer, old, { productId: 2002, productVariantId: 2002 })).item;
  await db.collection("quotationitems").updateOne({ _id: oldLegacy._id }, { $set: { unitPrice: dec("0.00"), priceWithoutTax: dec("0.00"), taxAmount: dec("0.00") } });
  await db.collection("quotationitems").updateOne({ _id: oldGateway._id }, { $set: { unitPrice: dec("950.00") } });
  const oldItems = await db.collection("quotationitems").find({ quotationRoomId: old.roomId }).sort({ _id: 1 }).toArray();

  // ── Add ──
  const q = await newQuotation(dealer);
  const legacy = await add(dealer, q, { productId: 2001, productVariantId: 2001, quantity: 2 });
  assert.deepEqual(snap(legacy.item), ["5799.00", "18.00", "4914.41", "884.59"], "₹5,799 price-only variant: quoted at ₹5,799 (18% split), not ₹0");
  assert.deepEqual(snap((await add(dealer, q, { productId: 2001 })).item).slice(0, 2), ["5799.00", "18.00"], "also when the single variant is chosen implicitly");
  assert.deepEqual(snap((await add(dealer, q, { productId: 2002, productVariantId: 2002 })).item), ["1000.00", "18.00", "847.46", "152.54"], "price + pre-tax stored: unchanged");
  const taxedItem = (await add(dealer, q, { productId: 2003, productVariantId: 2003 })).item;
  assert.deepEqual(snap(taxedItem).slice(0, 2), ["147.50", "5.00"], "GST rate configured: same price, 5% split");
  assert.equal(round2(Number(str(taxedItem.priceWithoutTax)) + Number(str(taxedItem.taxAmount))), 147.5);
  const matrixA = await add(dealer, q, { productId: 2004, productVariantId: 2041 });
  assert.equal(str(matrixA.item.unitPrice), "2500.00", "matrix variant chosen by id (price only)");
  const matrixB = await add(dealer, q, { productId: 2004, variantConfig: { series: "touch", finish: "acrylic" } });
  assert.deepEqual([matrixB.item.productVariantId, str(matrixB.item.unitPrice)], [2042, "3000.00"], "matrix variant chosen by configuration");
  assert.equal((await add(dealer, q, { productId: 2004 })).res.status, 422, "a matrix product still asks which variant");
  assert.equal(str((await add(dealer, q, { productId: 2005, productVariantId: 2005 })).item.unitPrice), "0.00", "a free product stays ₹0");
  assert.equal(str((await add(dealer, q, { productId: 2006, productVariantId: 2006 })).item.unitPrice), "0.00", "a free product with tax fields stays ₹0");
  const ownerQuotation = await newQuotation(owner);
  assert.equal(str((await add(owner, ownerQuotation, { productId: 2001, productVariantId: 2001 })).item.unitPrice), "5799.00", "the same price for an admin and a dealer");
  pass("Add: price-only ₹5,799 -> ₹5,799; GST-rate configured, pre-tax stored, matrix (by id and by configuration) and free (₹0) variants priced from the stored price");

  // ── Add, then Edit ──
  const itemUrl = (id) => `/api/quotations/${q.id}/items/${id}`;
  const legacyId = legacy.item._id;
  const reread = () => db.collection("quotationitems").findOne({ _id: legacyId });
  assert.equal((await api(dealer, "PATCH", itemUrl(legacyId), { quantity: 3 })).status, 200);
  assert.deepEqual([str((await reread()).unitPrice), (await reread()).quantity], ["5799.00", 3], "changing the quantity keeps the price");
  await api(dealer, "PATCH", itemUrl(legacyId), { unitPrice: 5500 });
  let item = await reread();
  assert.deepEqual([str(item.unitPrice), item.isCustomPrice, str(item.originalUnitPrice)], ["5500.00", true, "5799.00"], "an override is measured against ₹5,799");
  await api(dealer, "PATCH", itemUrl(legacyId), { resetToDefaultPrice: true });
  item = await reread();
  assert.deepEqual([str(item.unitPrice), item.isCustomPrice, str(item.originalUnitPrice)], ["5799.00", false, null], "reset returns to ₹5,799");
  await api(dealer, "PATCH", itemUrl(legacyId), { unitPrice: 5799 });
  assert.equal((await reread()).isCustomPrice, false, "typing the catalogue price is not an override");
  await api(dealer, "PATCH", itemUrl(matrixA.item._id), { productVariantId: 2042 });
  assert.equal(str((await db.collection("quotationitems").findOne({ _id: matrixA.item._id })).unitPrice), "3000.00", "re-selecting a variant re-prices from the stored price");
  const roomEdit = await api(dealer, "PATCH", `/api/quotations/${q.id}/rooms/${q.roomId}/items`, { items: [{ itemId: matrixA.item._id, productId: 2004, productVariantId: 2041 }] });
  assert.equal(roomEdit.status, 200, roomEdit.text?.slice(0, 200));
  assert.equal(str((await db.collection("quotationitems").findOne({ _id: matrixA.item._id })).unitPrice), "2500.00", "the room edit uses the same rule");
  pass("Add then Edit stays consistent: quantity, override (vs ₹5,799), reset, re-select and room edit all agree");

  // ── totals with a dealer discount ──
  assert.equal((await api(dealer, "PATCH", `/api/quotations/${q.id}`, { customerDiscountPercent: 5 })).status, 200);
  const live = await db.collection("quotationitems").find({ quotationRoomId: q.roomId, isDeleted: { $ne: true } }).toArray();
  const subtotal = round2(live.reduce((sum, row) => sum + row.quantity * Number(str(row.unitPrice)), 0));
  const discount = Math.round(((subtotal * 5) / 100) * 100) / 100;
  const net = round2(subtotal - discount);
  const charge = round2(net * 0.09);
  const totals = (await api(dealer, "GET", `/api/quotations/${q.id}`)).data;
  assert.deepEqual(
    [Number(totals.subtotal), Number(totals.discountAmount), Number(totals.netSubtotal), Number(totals.cgstAmount), Number(totals.sgstAmount), Number(totals.grandTotal)],
    [subtotal, discount, net, charge, charge, round2(net + 2 * charge)]
  );
  assert.ok(subtotal >= 3 * 5799, "the ₹5,799 line counts in the subtotal");
  pass(`totals: subtotal ₹${subtotal}, 5% dealer discount, 18% Service & Integration charge (9% + 9%) and grand total all add up`);

  // ── clone ──
  const clone = await api(dealer, "POST", `/api/quotations/${q.id}/duplicate`, { includeRooms: true });
  assert.ok([200, 201].includes(clone.status), clone.text?.slice(0, 200));
  const cloneRoomIds = (await db.collection("quotationrooms").find({ quotationId: clone.data.id ?? clone.data._id }).toArray()).map((r) => r._id);
  const cloned = await db.collection("quotationitems").find({ quotationRoomId: { $in: cloneRoomIds } }).toArray();
  const clonedPrice = (variantId) => cloned.filter((row) => row.productVariantId === variantId).map((row) => str(row.unitPrice));
  assert.deepEqual([clonedPrice(2001)[0], clonedPrice(2003)[0], clonedPrice(2005)[0]], ["5799.00", "147.50", "0.00"], "a clone takes the current catalogue prices");
  pass("a clone is priced from the stored catalogue prices (₹5,799, ₹147.50, free ₹0)");

  // ── the editor's Add button ──
  const uiQuotation = await newQuotation(dealer);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${baseUrl}/quotation/${uiQuotation.id}?step=3`, { waitUntil: "domcontentloaded" });
  const qty = page.locator('input[aria-label="Quantity for the next Legacy Switch entry"]:visible');
  await qty.waitFor();
  await page.locator("div.group", { has: qty }).first().getByRole("button", { name: /^Add$|^Adding/ }).click();
  let uiItem = null;
  for (let i = 0; i < 200 && !uiItem; i += 1) {
    uiItem = await db.collection("quotationitems").findOne({ quotationRoomId: uiQuotation.roomId, productId: 2001 });
    if (!uiItem) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(uiItem, "the editor stored the item");
  assert.equal(str(uiItem.unitPrice), "5799.00", "added from the editor at ₹5,799");
  await page.getByText(/5,799/).first().waitFor();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/editor-add-5799.png`, fullPage: true });
  await context.close();
  pass("the quotation editor's Add button stores and shows ₹5,799 for the price-only product");

  // ── nothing else changed ──
  assert.deepEqual(await db.collection("quotationitems").find({ quotationRoomId: old.roomId }).sort({ _id: 1 }).toArray(), oldItems, "the saved quotation keeps its prices (₹0 and ₹950 stay as saved)");
  const oldTotals = (await api(dealer, "GET", `/api/quotations/${old.id}`)).data;
  assert.equal(Number(oldTotals.subtotal), 950, "its total is computed from the saved prices");
  assert.deepEqual({ products: await db.collection("products").find({}).sort({ _id: 1 }).toArray(), variants: await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray() }, catalogBefore, "the catalogue is untouched");
  pass("existing quotations keep their saved prices (even the ₹0 one), and no product or variant was modified");

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
