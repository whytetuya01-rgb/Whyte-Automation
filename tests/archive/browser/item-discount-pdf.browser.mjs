/**
 * Browser check (real Chromium, production build, throwaway local Mongo) of how a per-product discount appears on the
 * quotation document that becomes the PDF:
 *  - a discounted line shows Original (struck through), Discount (amount and %), and the Final unit price;
 *  - a line without a discount keeps the plain layout (no extra labels);
 *  - a quotation with no discount anywhere is untouched (no discount labels at all);
 *  - the room subtotal is the final price x quantity, so the GST-inclusive totals are the ones already calculated;
 *  - the pages still fit the A4 canvas.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/item-discount-pdf.browser.mjs
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

let server;
let browser;
let exitCode = 0;
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer(
    "item-discount-pdf",
    [
      { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 1 },
      { _id: 2, email: "dealer@example.com", role: "dealer", name: "Dealer", discountAllocationPercent: 10, companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertOne({ _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 1, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 });
  const product = (id, name) => ({ _id: id, companyId: 1, name, code: `P-${id}`, type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, imageUrl: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(1, "Wide Panel Switch"), product(2, "Fan Regulator")]);
  const variant = (id, productId, price) => ({ _id: id, companyId: 1, productId, variantCode: `V-${id}`, config: {}, price: Decimal128.fromString(price), priceWithoutTax: Decimal128.fromString((Number(price) / 1.18).toFixed(2)), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: id });
  await db.collection("productvariants").insertMany([variant(1, 1, "1000.00"), variant(2, 2, "500.00")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer@example.com", "user");
  const owner = await login("owner@example.com", "admin");
  const makeQuotation = async (clientName) => {
    const created = await api(dealer, "POST", "/api/quotations", { clientName, houseTypeId: 1 });
    assert.equal(created.status, 201);
    const id = created.data.id ?? created.data._id;
    const rooms = (await api(dealer, "GET", `/api/quotations/${id}`)).data.rooms;
    const itemIds = [];
    for (const [productId, quantity, sb] of [[1, 2, "SB01"], [2, 3, "SB02"]]) {
      const res = await api(dealer, "POST", `/api/quotations/${id}/items`, { quotationRoomId: rooms[0].id, productId, productVariantId: productId, quantity, sbNumber: sb });
      assert.equal(res.status, 201, res.text.slice(0, 120));
      itemIds.push(res.data.id ?? res.data._id);
    }
    return { id, itemIds };
  };
  const discounted = await makeQuotation("Discount Client");
  const plain = await makeQuotation("Plain Client");

  const apply = await api(owner, "PATCH", `/api/quotations/${discounted.id}/items/${discounted.itemIds[0]}`, { discountType: "percentage", discountValue: 10 });
  assert.equal(apply.status, 200, apply.text.slice(0, 200));

  browser = await chromium.launch({ headless: true });
  const open = async (id) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies(owner.split("; ").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${baseUrl}/quotation/${id}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(1500);
    return { context, page };
  };

  const { context, page } = await open(discounted.id);
  const blocks = page.locator('[data-testid="proposal-item-discount"]');
  assert.equal(await blocks.count(), 1, "exactly the discounted line shows the discount block");
  const text = (await blocks.first().innerText()).replace(/\s+/g, " ");
  assert.match(text, /Original\s*₹\s?1,000/i, `original unit price shown (${text})`);
  assert.match(text, /Discount\s*[−-]\s*₹\s?100(\.00)?\s*\(10%\)/i, `discount amount and % shown (${text})`);
  assert.equal(await blocks.first().locator(".line-through").count(), 1, "the original price is struck through");
  const row = page.locator(".proposal-page .divide-y > div", { has: page.locator('[data-testid="proposal-item-discount"]') });
  const rowText = (await row.innerText()).replace(/\s+/g, " ");
  assert.match(rowText, /₹\s?900(\.00)?/, "final unit price shown");
  assert.match(rowText, /Final/i, "labelled as the final unit price");
  pass("a discounted line shows Original (struck through), Discount (amount and %) and the Final unit price");

  const otherRow = page.locator(".proposal-page .divide-y > div", { hasText: "Fan Regulator" });
  const otherText = (await otherRow.innerText()).replace(/\s+/g, " ");
  assert.doesNotMatch(otherText, /Original|Discount|Final/i, "a line without a discount keeps the plain layout");
  assert.match(otherText, /₹\s?500(\.00)?/);
  pass("a line without a discount keeps the plain layout");

  const flat = (await page.locator("body").innerText()).replace(/,/g, "");
  const subtotal = 900 * 2 + 500 * 3;
  assert.match(flat, new RegExp(`Living Room Subtotal[\\s\\S]{0,30}${subtotal}`, "i"), "room subtotal = final unit price x quantity");
  const heights = await page.evaluate(() => [...document.querySelectorAll(".proposal-page")].map((el) => el.offsetHeight));
  assert.ok(heights.every((h) => h <= 1124), `every page fits the A4 canvas (${heights})`);
  pass(`the room subtotal uses the final prices (₹${subtotal}) and every page still fits the A4 canvas`);
  await context.close();

  const plainPage = await open(plain.id);
  assert.equal(await plainPage.page.locator('[data-testid="proposal-item-discount"]').count(), 0);
  const plainBody = await plainPage.page.locator(".proposal-page .divide-y").first().innerText();
  assert.doesNotMatch(plainBody, /Original|Discount|Final/i, "a quotation with no discount renders exactly as before");
  assert.match((await plainPage.page.locator("body").innerText()).replace(/,/g, ""), new RegExp(`Living Room Subtotal[\\s\\S]{0,30}${1000 * 2 + 500 * 3}`, "i"));
  pass("a quotation with no discount is unchanged: no discount labels, subtotal = catalogue price x quantity");
  await plainPage.context.close();

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-1200)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  await browser?.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
