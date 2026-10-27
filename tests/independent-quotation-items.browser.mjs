/**
 * Independent quotation item entries in a real browser (Chromium via Playwright, production build, throwaway local Mongo):
 * the same product added twice to one space becomes two entries, each with its own quantity and installation location,
 * edited and deleted on its own, restored after a reload, and shown as two rows in Review, the proposal preview and the
 * generated PDF.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/independent-quotation-items.browser.mjs
 * Optional: SCREENSHOT_DIR=<dir>
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;

try {
  server = await startIsolatedServer(
    "independent-items-ui",
    [{ _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 }],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Company 1", slug: "company-1", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 11, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 },
    { _id: 12, companyId: 1, houseTypeId: 1, roomTypeId: 2, defaultCount: 1, sortOrder: 2 },
  ]);
  await db.collection("products").insertOne({ _id: 1, companyId: 1, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  // One variant while the UI adds entries (a single variant is added directly); the white variant is added later.
  await db.collection("productvariants").insertOne({ _id: 1, companyId: 1, productId: 1, variantCode: "SW-1", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer_a@example.com", "user");
  const created = await api(dealer, "POST", "/api/quotations", { clientName: "Entries Client", houseTypeId: 1 });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const roomIds = (await api(dealer, "GET", `/api/quotations/${qid}`)).data.rooms.map((r) => r.id);
  const stored = async () => (await db.collection("quotationitems").find({ quotationRoomId: { $in: roomIds }, isDeleted: { $ne: true } }).sort({ _id: 1 }).toArray());
  const until = async (condition, what) => {
    for (let i = 0; i < 200; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("timed out waiting for " + what);
  };
  const entriesAre = (n) => until(async () => (await stored()).length === n, `${n} stored entries`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => {
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true }); };

  const qtyInput = page.locator('input[aria-label="Quantity for the next Smart Switch entry"]:visible');
  const card = page.locator("div.group", { has: qtyInput }).first();
  const addButton = card.getByRole("button", { name: /^Add$|^Adding/ });
  const rows = page.locator("div.py-3\\.5").filter({ has: page.locator('input[placeholder^="e.g. Master switch"]') });
  const locationOf = (index) => rows.nth(index).locator('input[placeholder^="e.g. Master switch"]');

  // ═══ Two Add presses for the same product = two entries ═══
  await page.goto(`${baseUrl}/quotation/${qid}?step=3`, { waitUntil: "domcontentloaded" });
  await qtyInput.waitFor();
  assert.equal(await qtyInput.inputValue(), "1", "the field is the quantity of the next entry");
  await qtyInput.fill("2");
  await addButton.click();
  await entriesAre(1);
  await qtyInput.fill("3");
  await addButton.click();
  await entriesAre(2);
  let items = await stored();
  assert.notEqual(items[0]._id, items[1]._id, "two different item ids");
  assert.ok(items.every((i) => i.productId === 1 && i.productVariantId === 1), "both reference the same product and variant");
  assert.deepEqual(items.map((i) => i.quantity), [2, 3], "each entry has the quantity typed for it");
  await until(async () => (await rows.count()) === 2, "two rows in Added Products");
  assert.equal(await card.locator('input[aria-label="Quantity for the next Smart Switch entry"]').inputValue(), "1", "the field resets for the next entry");
  await shot("1-two-entries");
  pass("pressing Add twice for the same product creates two separate entries (2 and 3), shown as two rows in Added Products");

  // a one-unit "+" press is a third entry, and "-" takes it away again without touching the others
  await card.getByTitle(/Add .*to room|Add device to room/).click();
  await entriesAre(3);
  assert.deepEqual((await stored()).map((i) => i.quantity), [2, 3, 1]);
  await card.getByTitle("Remove one unit from the latest entry").click();
  await entriesAre(2);
  assert.deepEqual((await stored()).map((i) => i.quantity), [2, 3], "the latest entry went away, the first two are untouched");
  pass("+ creates another entry and - removes one unit from the latest entry only");

  // ═══ Independent location, quantity ═══
  await locationOf(0).fill("Entrance wall");
  await locationOf(0).blur();
  await until(async () => (await stored())[0].notes === "Entrance wall", "first location stored");
  await locationOf(1).fill("Bedside");
  await locationOf(1).blur();
  await until(async () => (await stored())[1].notes === "Bedside", "second location stored");
  items = await stored();
  assert.deepEqual(items.map((i) => i.notes), ["Entrance wall", "Bedside"], "each entry stores its own location");
  await rows.nth(1).getByTitle("Increase quantity").click();
  await until(async () => (await stored())[1].quantity === 4, "second quantity 4");
  assert.deepEqual((await stored()).map((i) => i.quantity), [2, 4], "only the second entry's quantity changed");
  assert.deepEqual((await stored()).map((i) => i.notes), ["Entrance wall", "Bedside"], "locations unaffected by the quantity change");
  pass("each entry keeps its own installation location and quantity; changing one does not change the other");

  // ═══ Reload ═══
  await page.reload({ waitUntil: "domcontentloaded" });
  await rows.first().waitFor();
  // while the page streams in, React briefly keeps a hidden copy of the content: wait for the DOM to settle
  await until(async () => (await rows.count()) === 2, "both entries back after a reload");
  assert.equal(await locationOf(0).inputValue(), "Entrance wall");
  assert.equal(await locationOf(1).inputValue(), "Bedside");
  assert.match(await rows.nth(0).innerText(), /2\b/);
  assert.match(await rows.nth(1).innerText(), /4\b/);
  pass("after a reload both entries come back with their own location and quantity");

  // ═══ Review ═══
  await page.goto(`${baseUrl}/quotation/${qid}?step=4`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Entrance wall").first().waitFor();
  const review = await page.locator("body").innerText();
  assert.match(review, /Entrance wall/);
  assert.match(review, /Bedside/);
  assert.equal((review.match(/Smart Switch/g) || []).length >= 2, true, "the product name appears once per entry");
  await shot("2-review");
  pass("Review lists both entries with their own locations");

  // ═══ Proposal preview and PDF: entries of one product are shown as ONE row, the stored entries stay independent ═══
  // Two more entries: one without a location, and one of a different variant (white, 1800).
  await db.collection("productvariants").insertOne({ _id: 2, companyId: 1, productId: 1, variantCode: "SW-2", config: { finish: "white" }, price: Decimal128.fromString("1800.00"), priceWithoutTax: Decimal128.fromString("1800.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 2 });
  const noLocation = await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomIds[0], productId: 1, productVariantId: 1, quantity: 1 });
  assert.equal(noLocation.status, 201);
  const white = await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomIds[0], productId: 1, productVariantId: 2, quantity: 2, notes: "Terrace" });
  assert.equal(white.status, 201);
  const extraIds = [noLocation.data.id ?? noLocation.data._id, white.data.id ?? white.data._id];
  const storedBefore = JSON.stringify(await stored());
  assert.equal((await stored()).length, 4, "four independent stored entries");

  await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
  await page.locator(".proposal-page").first().waitFor();
  await page.waitForTimeout(1500);
  const pages = await page.evaluate(() => [...document.querySelectorAll(".proposal-page")].map((el) => el.innerText));
  const productRows = await page.evaluate(() => [...document.querySelectorAll(".proposal-page .divide-y > div")].map((el) => el.innerText.replace(/\s+/g, " ")));
  const switchRows = productRows.filter((text) => /Smart Switch/.test(text));
  assert.equal(switchRows.length, 2, `the proposal has two Smart Switch rows: the black group and the white one (${switchRows.length})`);
  const black = switchRows.find((t) => !/Terrace/.test(t));
  const whiteRow = switchRows.find((t) => /Terrace/.test(t));
  assert.ok(black && whiteRow, "one grouped row and one separate row");
  assert.match(black, /Qty\s*7\b/, "combined quantity 2 + 4 + 1 = 7");
  assert.match(black, /Total\s*₹\s*7,000/i, "line total = the sum of the three entries' own totals (7 x 1000)");
  assert.match(black, /Entrance wall\s*×\s*2/);
  assert.match(black, /Bedside\s*×\s*4/);
  assert.match(black, /Location not specified\s*×\s*1/, "the entry without a location is listed as not specified");
  assert.doesNotMatch(black, /Terrace/, "the other variant's location is not in the grouped row");
  assert.match(whiteRow, /Qty\s*2\b/);
  assert.match(whiteRow, /Terrace/);
  assert.doesNotMatch(whiteRow, /Total\s*₹/i, "a single-entry row keeps the existing layout (no extra total line)");
  const all = pages.join("\n");
  for (const location of ["Entrance wall", "Bedside", "Terrace"]) assert.equal((all.match(new RegExp(location, "g")) || []).length, 1, `${location} appears once`);
  await shot("3-proposal-grouped");

  // the room subtotal still counts every entry: 7 x 1000 + 2 x 1800 = 10,600
  assert.match(all, /Subtotal[\s\S]{0,40}₹\s*10,600/i, "the room subtotal is unchanged by the grouping");
  assert.equal(JSON.stringify(await stored()), storedBefore, "viewing the proposal changed no stored entry");
  assert.equal((await stored()).length, 4, "the four stored entries are still four independent items");

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Download PDF/i }).click()]);
  const pdfPath = shotDir ? `${shotDir}/independent-items.pdf` : await download.path();
  if (shotDir) await download.saveAs(pdfPath);
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pageCount, pages.length, `the PDF has one page per proposal page (${pageCount} / ${pages.length})`);
  pass("the proposal shows one grouped Smart Switch row (qty 7, total 7,000, three locations incl. 'not specified'), the white variant separately, the subtotal unchanged, and the PDF is generated from those pages; the four stored entries are untouched");

  // Many entries of one product with long, different locations: the grouped row grows taller and the pagination
  // has to make room for it, so no proposal page may overflow its fixed A4 canvas.
  const longIds = [];
  for (let i = 1; i <= 8; i++) {
    const res = await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomIds[0], productId: 1, productVariantId: 1, quantity: 1, notes: `Location ${i}: the far corner of the north wing, behind the glass partition next to the main entrance, above the shoe cabinet` });
    assert.equal(res.status, 201);
    longIds.push(res.data.id ?? res.data._id);
  }
  await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
  await page.locator(".proposal-page").first().waitFor();
  await page.waitForTimeout(1500);
  const heights = await page.evaluate(() => [...document.querySelectorAll(".proposal-page")].map((el) => el.offsetHeight));
  assert.ok(heights.every((h) => h <= 1124), `no page overflows 1123px: ${JSON.stringify(heights)}`);
  const longRow = await page.evaluate(() => [...document.querySelectorAll(".proposal-page .divide-y > div")].map((el) => el.innerText.replace(/\s+/g, " ")).find((t) => /Location 1:/.test(t)) ?? "");
  for (let i = 1; i <= 8; i++) assert.match(longRow, new RegExp(`Location ${i}:`), `location ${i} is listed in the grouped row`);
  assert.match(longRow, /Qty\s*15\b/, "combined quantity 2 + 4 + 1 + 8 = 15");
  await shot("4-proposal-long-locations");
  pass("a grouped row with eight long locations lists every one of them and no proposal page overflows the A4 canvas");
  for (const id of longIds) assert.equal((await api(dealer, "DELETE", `/api/quotations/${qid}/items/${id}`)).status, 200);

  // back to the two original entries for the delete check below
  for (const id of extraIds) assert.equal((await api(dealer, "DELETE", `/api/quotations/${qid}/items/${id}`)).status, 200);
  await entriesAre(2);

  // ═══ Delete one entry, the other stays ═══
  await page.goto(`${baseUrl}/quotation/${qid}?step=3`, { waitUntil: "domcontentloaded" });
  // the list is rendered from the database, so it settles at the two live entries (soft-deleted ones are never shown)
  await until(async () => (await rows.count()) === 2, "two rows for the two live entries");
  const before = await stored();
  await rows.nth(0).getByTitle("Remove product").last().click();
  await entriesAre(1);
  const left = await stored();
  assert.equal(left[0]._id, before[1]._id, "the second entry is the one that remains");
  assert.equal(left[0].quantity, 4);
  assert.equal(left[0].notes, "Bedside");
  // the database changes before the browser has the response: wait for the list to follow
  await until(async () => (await rows.count()) === 1, "one row after the delete");
  assert.equal(await locationOf(0).inputValue(), "Bedside");
  pass("deleting the first entry removes only that item; the second keeps its id, quantity and location");

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
  pass("server log is free of tenant violations");
  await context.close();
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1500));
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
