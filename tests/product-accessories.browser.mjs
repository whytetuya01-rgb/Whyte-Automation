/**
 * Suggested accessories end to end (real Chromium, isolated production server, throwaway MongoDB): the product form picks them
 * (search, add, remove, save, shown again), and the quotation editor suggests them for the room: only a click adds one,
 * nothing is added by itself, inactive or already-added ones are not offered. At 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/product-accessories.browser.mjs
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
const waitUntil = async (check, what, ms = 20000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

try {
  server = await startIsolatedServer("accessories-ui", [
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
  const product = (id, name, extra = {}) => ({ _id: id, companyId: 20, name, code: `P-${id}`, type: "accessory", categoryId: 201, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("products").insertMany([
    product(2001, "Smart Switch", { type: "switch_board", accessoryIds: [2002, 2003, 2004] }),
    product(2002, "Switch Frame"),
    product(2003, "Remote Controller"),
    product(2004, "Retired Cover", { isActive: false }),
    product(2005, "Wall Plate"),
  ]);
  const variant = (id, productId, code, price) => ({ _id: id, companyId: 20, productId, variantCode: code, name: code, config: {}, price: dec(price), priceWithoutTax: dec((Number(price) / 1.18).toFixed(2)), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertMany([variant(1, 2001, "SW-1", "1180.00"), variant(2, 2002, "FR-1", "300.00"), variant(3, 2003, "RC-1", "900.00"), variant(4, 2003, "RC-2", "1100.00"), variant(5, 2005, "WP-1", "50.00")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = { a: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user") };

  browser = await chromium.launch({ headless: true });
  const open = async (cookies, viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookies.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const accessories = async () => (await db.collection("products").findOne({ _id: 2001 })).accessoryIds ?? [];

  // ═══ the product form ═══
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    await db.collection("products").updateOne({ _id: 2001 }, { $set: { accessoryIds: [2002, 2003, 2004] } });
    const page = await open(cookie.a, viewport);
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Edit Product" }).click();
    const picker = page.getByTestId("accessory-picker");
    await picker.waitFor();
    const chips = picker.getByTestId("accessory-chip");
    await chips.first().waitFor();
    assert.equal(await chips.count(), 3, "the saved accessories are shown");
    await waitUntil(async () => /Switch Frame/.test(await chips.nth(0).innerText()), "the first accessory to be named");
    assert.ok(await noScroll(page), `no horizontal scroll at ${w}px`);

    // search: not itself, not what is chosen, inactive ones are not offered
    await picker.getByTestId("accessory-search").fill("smart");
    await picker.getByText("No other products match.").waitFor();
    await picker.getByTestId("accessory-search").fill("switch");
    await picker.getByText("No other products match.").waitFor();
    await picker.getByTestId("accessory-search").fill("wall");
    const result = picker.getByTestId("accessory-result");
    await result.first().waitFor();
    assert.equal(await result.count(), 1);
    assert.match(await result.first().innerText(), /Wall Plate/);
    await result.first().click();
    assert.equal(await chips.count(), 4);
    assert.equal(await picker.getByTestId("accessory-results").count(), 0, "the search clears after choosing");

    // remove one and save
    await picker.getByRole("button", { name: "Remove Remote Controller" }).click();
    assert.equal(await chips.count(), 3);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/accessories-form-${w}.png`, fullPage: true });
    await page.getByRole("button", { name: "Update Product" }).click();
    await page.locator("text=Product updated").first().waitFor();
    assert.deepEqual(await accessories(), [2002, 2004, 2005], "saved in the order shown");

    // reopening shows them again, named
    await page.reload({ waitUntil: "load" });
    await page.getByRole("button", { name: "Edit Product" }).click();
    await page.getByTestId("accessory-picker").getByTestId("accessory-chip").first().waitFor();
    const reopened = page.getByTestId("accessory-picker").getByTestId("accessory-chip");
    await waitUntil(async () => /Switch Frame[\s\S]*Retired Cover[\s\S]*Wall Plate/.test((await reopened.allInnerTexts()).join(" | ")), "the chosen accessories to be named");
    await page.context().close();
  }
  pass("the product form: saved accessories are shown by name; search never offers the product itself, what is chosen, or inactive products; add, remove, save in order, reopen; at 1280px and 375px");

  // ═══ the quotation editor ═══
  await db.collection("products").updateOne({ _id: 2001 }, { $set: { accessoryIds: [2002, 2003, 2004] } });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    await db.collection("quotationitems").deleteMany({});
    await db.collection("quotations").deleteMany({});
    const created = await api(cookie.dealer, "POST", "/api/quotations", { clientName: "Client", houseTypeId: 201 });
    const qid = created.data.id ?? created.data._id;
    const roomId = (await api(cookie.dealer, "GET", `/api/quotations/${qid}`)).data.rooms[0].id;

    // an empty room suggests nothing
    let page = await open(cookie.dealer, viewport);
    await page.goto(`${baseUrl}/quotation/${qid}?step=3`, { waitUntil: "domcontentloaded" });
    await page.getByText("Product Catalog").first().waitFor();
    assert.equal(await page.getByTestId("suggested-accessories").count(), 0, "nothing is suggested for an empty room");
    await page.context().close();

    assert.equal((await api(cookie.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 1, quantity: 1 })).status, 201);
    page = await open(cookie.dealer, viewport);
    await page.goto(`${baseUrl}/quotation/${qid}?step=3`, { waitUntil: "domcontentloaded" });
    const strip = page.getByTestId("suggested-accessories");
    await strip.waitFor();
    const names = await strip.getByTestId("suggested-accessory").allInnerTexts();
    assert.equal(names.length, 2, "two suggestions: the inactive product is not offered");
    assert.match(names[0], /Switch Frame/);
    assert.match(names[0], /Add/);
    assert.match(names[1], /Remote Controller/);
    assert.match(names[1], /Choose variant/, "an accessory with several variants asks which one");
    assert.ok(await noScroll(page), `no horizontal scroll with suggestions at ${w}px`);
    assert.equal(await db.collection("quotationitems").countDocuments({}), 1, "nothing was added by itself");
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/accessories-editor-${w}.png`, fullPage: true });

    // a variant choice does not add anything yet
    await strip.getByTestId("suggested-accessory").nth(1).getByTestId("suggested-accessory-add").click();
    await page.waitForTimeout(800);
    assert.equal(await db.collection("quotationitems").countDocuments({}), 1, "'Choose variant' only takes you to the catalogue; it adds nothing");

    // a click on Add adds exactly that accessory
    await strip.getByTestId("suggested-accessory").nth(0).getByTestId("suggested-accessory-add").click();
    await waitUntil(async () => (await db.collection("quotationitems").countDocuments({})) === 2, "the accessory to be added");
    const items = await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray();
    assert.deepEqual(items.map((i) => i.productId), [2001, 2002], "exactly the clicked accessory was added");
    assert.equal(Number(String(items[1].unitPrice)), 300, "at its own catalogue price");
    await waitUntil(async () => (await strip.getByTestId("suggested-accessory").count()) === 1, "the added accessory to leave the suggestions");
    assert.doesNotMatch((await strip.innerText()), /Switch Frame/, "an accessory already in the room is not suggested again");
    assert.equal(await db.collection("quotationitems").countDocuments({}), 2, "and nothing else appeared");
    await page.context().close();
  }
  pass("the quotation editor suggests the room's accessories (inactive ones hidden, nothing for an empty room); a click adds exactly that one at its catalogue price; 'Choose variant' adds nothing; an added one is no longer suggested; at 1280px and 375px");

  console.log(`\nALL ${count} PRODUCT ACCESSORY BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
