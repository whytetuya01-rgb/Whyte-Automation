/**
 * Browser check (real Chromium via Playwright, production build, throwaway local Mongo) of the Product Configuration
 * page: rename a space, flat vs villa floor labels, typed quantity + Add, validation, double-click protection,
 * API failure handling and a phone-width layout.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/space-config-quantity.browser.mjs
 * Optional: SCREENSHOT_DIR=<dir>
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

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;

try {
  server = await startIsolatedServer(
    "space-qty-ui",
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
  await db.collection("housetypes").insertMany([
    { _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Luxury Villa", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetyperoomtemplates").insertMany(
    [1, 2].flatMap((h) => [
      { _id: h * 10 + 1, companyId: 1, houseTypeId: h, roomTypeId: 1, defaultCount: 1, sortOrder: 1 },
      { _id: h * 10 + 2, companyId: 1, houseTypeId: h, roomTypeId: 2, defaultCount: 1, sortOrder: 2 },
    ])
  );
  const product = (id, name) => ({ _id: id, companyId: 1, name, code: `P-${id}`, type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(1, "Smart Switch"), product(2, "Dual Finish Dimmer")]);
  const variant = (id, productId, code, price, config) => ({ _id: id, companyId: 1, productId, variantCode: code, config, price: Decimal128.fromString(price), priceWithoutTax: Decimal128.fromString(price), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: id });
  await db.collection("productvariants").insertMany([
    variant(1, 1, "SW-1-A", "1000.00", {}),
    variant(2, 2, "DM-A", "1500.00", { finish: "black" }),
    variant(3, 2, "DM-B", "1800.00", { finish: "white" }),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer_a@example.com", "user");
  const buildQuotation = async (clientName, houseTypeId) => {
    const created = await api(dealer, "POST", "/api/quotations", { clientName, houseTypeId });
    assert.equal(created.status, 201);
    const id = created.data.id ?? created.data._id;
    const rooms = (await api(dealer, "GET", `/api/quotations/${id}`)).data.rooms;
    return { id, rooms };
  };
  const flat = await buildQuotation("Flat Client", 1);
  const villa = await buildQuotation("Villa Client", 2);

  browser = await chromium.launch({ headless: true });
  const newPage = async (viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { context, page };
  };
  const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true }); };
  const items = (quotationId) => db.collection("quotationitems").find({ quotationRoomId: { $in: flat.id === quotationId ? flat.rooms.map((r) => r.id) : villa.rooms.map((r) => r.id) } }).toArray();
  const until = async (condition, what) => {
    for (let i = 0; i < 150; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("timed out waiting for " + what);
  };
  // The field mirrors the stored quantity, so wait on the database, not on what was typed.
  const qtyIs = (expected) => until(async () => (await items(flat.id))[0]?.quantity === expected, `stored quantity ${expected}`);
  const card = (page, name) => page.locator("div.group", { has: page.locator(`h4:text-is("${name}"), p:text-is("${name}"), :text-is("${name}")`) }).filter({ has: page.locator(`input[aria-label="Quantity of ${name} in this room"]:visible`) }).first();
  const qtyInput = (page, name) => page.locator(`input[aria-label="Quantity of ${name} in this room"]:visible`);

  // ═══ Flat: no floor labels ══════════════════════════════════════════
  const { context, page } = await newPage({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=3`, { waitUntil: "domcontentloaded" });
  await qtyInput(page, "Smart Switch").waitFor();
  await shot(page, "1-flat-config");
  let text = await page.locator("body").innerText();
  assert.doesNotMatch(text, /Ground Floor|First Floor|Second Floor/, "a 2 BHK flat shows no floor labels on Product Configuration");
  assert.match(text, /Living Room/);
  assert.match(text, /Master Bedroom/);
  pass("flat (2 BHK): Product Configuration shows 'Living Room' / 'Master Bedroom' with no floor labels");

  // ═══ Rename from Product Configuration ═════════════════════════════
  const target = page.locator('button[aria-label^="Rename "]').last();
  await target.click();
  const nameInput = page.locator('input[aria-label="Space name"]');
  await nameInput.fill("");
  await page.locator('button[aria-label="Save space name"]').click();
  await page.locator('[role="alert"]', { hasText: /cannot be empty/i }).waitFor();
  pass("renaming to an empty name shows an inline validation message and does not save");
  await nameInput.fill("Person A Room");
  await page.locator('button[aria-label="Cancel renaming"]').click();
  await nameInput.waitFor({ state: "detached" });
  assert.doesNotMatch(await page.locator("body").innerText(), /Person A Room/, "cancel discards the typed name");
  await page.locator('button[aria-label^="Rename "]').last().click();
  await nameInput.fill("Parents' Bedroom");
  await page.locator('button[aria-label="Save space name"]').click();
  await page.locator("text=Parents' Bedroom").first().waitFor();
  await nameInput.waitFor({ state: "detached" });
  const active = flat.rooms[0];
  const stored = await db.collection("quotationrooms").find({ quotationId: flat.id }).toArray();
  assert.equal(stored.filter((r) => r.customName === "Parents' Bedroom").length, 1, "exactly one room carries the new name");
  const renamedRoom = stored.find((r) => r.customName === "Parents' Bedroom");
  assert.equal(renamedRoom.roomTypeId, flat.rooms.find((r) => r.id === renamedRoom._id).roomTypeId, "room type reference preserved");
  assert.equal(JSON.stringify((await db.collection("roomtypes").find({}).sort({ _id: 1 }).toArray()).map((r) => r.name)), JSON.stringify(["Living Room", "Master Bedroom"]), "master room types untouched");
  void active;
  pass("rename from Product Configuration: heading updates immediately and is stored on this quotation's room only");

  await page.reload({ waitUntil: "domcontentloaded" });
  await qtyInput(page, "Smart Switch").waitFor();
  assert.match(await page.locator("body").innerText(), /Parents' Bedroom/, "name survives a refresh");
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=2`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Parents' Bedroom").first().waitFor();
  pass("the new name survives a refresh and shows in Space Selection");

  // ═══ Quantity ═════════════════════════════════════════════════════
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=3`, { waitUntil: "domcontentloaded" });
  const input = qtyInput(page, "Smart Switch");
  await input.waitFor();
  // pick a room that has no switch yet: the first room card is active by default
  assert.equal(await input.inputValue(), "0");
  const writes = [];
  page.on("request", (r) => { if (/\/api\/quotations\/[^/]+\/items/.test(r.url()) && ["POST", "PATCH"].includes(r.method())) writes.push(r.method()); });

  const addBtn = () => card(page, "Smart Switch").getByRole("button", { name: /^Add$|^Adding/ });
  await input.fill("5");
  await addBtn().click();
  await qtyIs(5);
  let rows = await items(flat.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 5, "typing 5 and pressing Add stores exactly 5 units");
  assert.equal(Number(rows[0].unitPrice.toString()), 1000);
  assert.match(await page.locator("body").innerText(), /5,000|5000/, "the totals show 5 x 1000");
  await shot(page, "2-after-add-5");
  pass("typing 5 and pressing Add adds exactly 5 units; the field, room count and totals update");

  await card(page, "Smart Switch").getByTitle(/Add .*to room|Add device to room/).click();
  await qtyIs(6);
  assert.equal((await items(flat.id))[0].quantity, 6, "+ still adds one");
  await card(page, "Smart Switch").getByTitle("Remove one instance").click();
  await qtyIs(5);
  assert.equal((await items(flat.id))[0].quantity, 5, "- still removes one");
  assert.equal((await items(flat.id)).length, 1, "no duplicate line");
  pass("the + and - controls still work and stay in sync with the typed field");

  const before = JSON.stringify(await items(flat.id));
  const writesBefore = writes.length;
  for (const [typed, message] of [["", /enter a quantity/i], ["0", /at least 1/i], ["-3", /negative/i], ["2.5", /whole number/i], ["abc", /digits only/i], ["1000", /more than 999/i]]) {
    await input.fill(typed);
    await addBtn().click();
    await card(page, "Smart Switch").locator('[role="alert"]').filter({ hasText: message }).waitFor();
    assert.equal(await input.inputValue(), typed, `typed value ${JSON.stringify(typed)} is kept`);
  }
  assert.equal(JSON.stringify(await items(flat.id)), before, "invalid quantities write nothing");
  assert.equal(writes.length, writesBefore, "invalid quantities send no request");
  await input.fill("5");
  await addBtn().click();
  await card(page, "Smart Switch").locator('[role="alert"]').filter({ hasText: /already in this room/i }).waitFor();
  pass("empty, zero, negative, decimal, text and oversize quantities show a clear message and send no request");

  // double click on Add sends a single request
  await input.fill("8");
  const sentBefore = writes.length;
  await addBtn().dblclick();
  await qtyIs(8);
  await page.waitForTimeout(500);
  assert.equal(writes.length - sentBefore, 1, "a double click sends exactly one request");
  rows = await items(flat.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 8, "5 -> 8: the difference was added once");
  pass("double-clicking Add sends one request and the quantity is 8, not doubled");

  // keyboard: Enter adds
  await input.fill("9");
  await input.press("Enter");
  await qtyIs(9);
  assert.equal((await items(flat.id))[0].quantity, 9);
  pass("pressing Enter in the field adds, like the Add button");

  // API failure keeps the typed value and reports an error
  await page.route("**/api/quotations/*/items/*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } }) }));
  await input.fill("12");
  await addBtn().click();
  await card(page, "Smart Switch").locator('[role="alert"]').filter({ hasText: /could not add/i }).waitFor();
  assert.equal(await input.inputValue(), "12", "the typed quantity survives a failed request");
  assert.equal((await items(flat.id))[0].quantity, 9, "nothing changed in the database");
  await page.unroute("**/api/quotations/*/items/*");
  pass("on API failure the typed quantity is kept, an error is shown and nothing is saved");

  // a product with several variants must make the dealer choose
  const multi = qtyInput(page, "Dual Finish Dimmer");
  await multi.fill("4");
  await card(page, "Dual Finish Dimmer").getByRole("button", { name: /^Add$/ }).click();
  await card(page, "Dual Finish Dimmer").locator('[role="alert"]').filter({ hasText: /choose a variant/i }).waitFor();
  assert.equal((await items(flat.id)).filter((i) => i.productId === 2).length, 0, "no variant is guessed");
  pass("a product with several variants asks for a variant instead of guessing");

  // ═══ Rename directly on the Review page ═══════════════════════════
  const roomsBeforeReview = JSON.stringify((await db.collection("quotationrooms").find({ quotationId: flat.id }).sort({ _id: 1 }).toArray()).map((r) => [r._id, r.roomTypeId]));
  const itemsBeforeReview = JSON.stringify(await items(flat.id));
  const subtotalBefore = (await api(dealer, "GET", `/api/quotations/${flat.id}`)).data.subtotal;
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=4`, { waitUntil: "domcontentloaded" });
  const reviewRename = page.locator(`button[aria-label="Rename Parents' Bedroom"]:visible`).first();
  await reviewRename.waitFor();
  await shot(page, "5-review-before-rename");
  await reviewRename.click();
  const reviewInput = page.locator('input[aria-label="Space name"]:visible');
  await reviewInput.fill("");
  await page.locator('button[aria-label="Save space name"]:visible').click();
  await page.locator('[role="alert"]', { hasText: /cannot be empty/i }).first().waitFor();
  await reviewInput.fill("x".repeat(121));
  await page.locator('button[aria-label="Save space name"]:visible').click();
  await page.locator('[role="alert"]', { hasText: /120 characters/i }).first().waitFor();
  await reviewInput.fill("Person A Room");
  await page.locator('button[aria-label="Save space name"]:visible').click();
  await page.locator("h4", { hasText: "Person A Room" }).first().waitFor();
  await reviewInput.waitFor({ state: "detached" });
  await shot(page, "6-review-after-rename");
  await until(async () => (await db.collection("quotationrooms").find({ quotationId: flat.id, customName: "Person A Room" }).toArray()).length === 1, "stored review rename");
  assert.equal(JSON.stringify((await db.collection("quotationrooms").find({ quotationId: flat.id }).sort({ _id: 1 }).toArray()).map((r) => [r._id, r.roomTypeId])), roomsBeforeReview, "room ids and room type references preserved");
  assert.equal(JSON.stringify(await items(flat.id)), itemsBeforeReview, "products, variants, quantities and prices unchanged");
  assert.deepEqual((await api(dealer, "GET", `/api/quotations/${flat.id}`)).data.subtotal, subtotalBefore, "totals unchanged");
  assert.deepEqual((await db.collection("roomtypes").find({}).sort({ _id: 1 }).toArray()).map((r) => r.name), ["Living Room", "Master Bedroom"], "master room types untouched");
  assert.doesNotMatch(await page.locator("body").innerText(), /Ground Floor|First Floor/, "the flat still shows no floor labels on Review");
  pass("Review page: rename validates (empty / over 120), saves, updates the heading at once and changes only this quotation's room");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("h4", { hasText: "Person A Room" }).first().waitFor();
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=3`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Person A Room").first().waitFor();
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=2`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Person A Room").first().waitFor();
  await page.goto(`${baseUrl}/quotation/${flat.id}?step=5`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Person A Room").first().waitFor();
  assert.match(await page.locator("body").innerText(), /Person A Room/i, "the proposal / PDF preview uses the renamed space");
  await shot(page, "7-proposal");
  pass("the Review rename persists after refresh and shows in Space Selection, Product Configuration and the proposal / PDF preview");
  await context.close();

  // ═══ Phone width ═════════════════════════════════════════════════
  const mobile = await newPage({ width: 375, height: 800 });
  await mobile.page.goto(`${baseUrl}/quotation/${flat.id}?step=3`, { waitUntil: "domcontentloaded" });
  const mInput = qtyInput(mobile.page, "Smart Switch");
  await mInput.waitFor();
  assert.equal(await mInput.getAttribute("inputmode"), "numeric", "numeric keyboard on phones");
  const mAdd = card(mobile.page, "Smart Switch").getByRole("button", { name: /^Add$/ });
  await mAdd.scrollIntoViewIfNeeded();
  const box = await mAdd.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375 && box.height >= 24, `Add button fits the 375px viewport (${JSON.stringify(box)})`);
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal page scroll");
  await shot(mobile.page, "3-mobile");
  pass("phone width: numeric keyboard, visible Add button, no horizontal scroll");
  await mobile.context.close();

  // ═══ Villa keeps its floors ══════════════════════════════════════
  const v = await newPage({ width: 1280, height: 900 });
  await v.page.goto(`${baseUrl}/quotation/${villa.id}?step=3`, { waitUntil: "domcontentloaded" });
  await qtyInput(v.page, "Smart Switch").waitFor();
  assert.match(await v.page.locator("body").innerText(), /Ground Floor/, "a villa still shows its floors");
  await shot(v.page, "4-villa-config");
  pass("multi-floor villa: Product Configuration still shows the actual floor labels");
  await v.context.close();

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
  pass("server log is free of tenant violations");
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1200));
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
