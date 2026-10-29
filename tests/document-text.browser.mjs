/**
 * Browser check of the Document text settings (real Chromium against an isolated production server): the default
 * company's document keeps its long-standing wording; another company rewords headings, the "Proposal Includes"
 * lines, Next Steps and default validity / terms in the Document Content tab with a live preview, and its real
 * quotation document then shows exactly that, while the default company's document is unchanged.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/document-text.browser.mjs
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

const DEFAULT_TEXT = ["Investment & Next Steps", "Selected smart automation products", "1. Review", "4. Proceed", "Valid for 30 days from date of issue.", "Product Summary & Specifications"];

try {
  server = await startIsolatedServer("doc-text", [
    { _id: 1, email: "whytedealer@example.com", role: "dealer", name: "Whyte Dealer", discountAllocationPercent: 10, companyId: 1 },
    { _id: 2, email: "acmedealer@example.com", role: "dealer", name: "Acme Dealer", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "acmeowner@example.com", role: "company_owner", name: "Acme Owner", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "active", phone: "9898234336", address: "Gandhinagar", gstNumber: null, email: "sales@whyte.co.in", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "12 Main Street", gstNumber: null, email: "hello@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  for (const [cid, base] of [[1, 100], [20, 200]]) {
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const dealers = { whyte: await login("whytedealer@example.com", "user"), acme: await login("acmedealer@example.com", "user") };
  const owner = await login("acmeowner@example.com", "admin");
  const makeQuotation = async (cookie, base) => {
    const created = await api(cookie, "POST", "/api/quotations", { clientName: "Client", houseTypeId: base + 1 });
    assert.equal(created.status, 201);
    const id = created.data.id ?? created.data._id;
    const room = (await api(cookie, "GET", `/api/quotations/${id}`)).data.rooms[0];
    assert.equal((await api(cookie, "POST", `/api/quotations/${id}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 1 })).status, 201);
    return id;
  };
  const whyteQ = await makeQuotation(dealers.whyte, 100);
  const acmeQ = await makeQuotation(dealers.acme, 200);

  browser = await chromium.launch({ headless: true });
  const open = async (cookie) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const documentOf = async (cookie, id) => {
    const { page, context } = await open(cookie);
    await page.goto(`${baseUrl}/quotation/${id}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(1200);
    const text = (await page.locator(".proposal-page").allInnerTexts()).join("\n");
    const steps = await page.locator('[data-testid="proposal-next-steps"] li').count();
    const includes = await page.locator('[data-testid="proposal-includes"]').count();
    await context.close();
    return { text, steps, includes };
  };

  // ── defaults ──
  const whyteBefore = await documentOf(dealers.whyte, whyteQ);
  for (const phrase of DEFAULT_TEXT) assert.ok(whyteBefore.text.includes(phrase), `default company shows "${phrase}"`);
  assert.match(whyteBefore.text, /Smart\s*Automation\s*Proposal/);
  assert.match(whyteBefore.text, /PREPARED EXCLUSIVELY FOR/);
  assert.equal(whyteBefore.steps, 4);
  const acmeBefore = await documentOf(dealers.acme, acmeQ);
  for (const phrase of DEFAULT_TEXT) assert.ok(acmeBefore.text.includes(phrase), `a company that changed nothing shows "${phrase}"`);
  pass("with nothing customised, both companies' documents show the long-standing headings, lists, steps and validity");

  // ── the editor ──
  const { page } = await open(owner);
  await page.goto(`${baseUrl}/admin/company`, { waitUntil: "load" });
  await page.getByRole("tab", { name: /^Document/ }).click();
  await page.locator('[data-testid="document-text-editor"]').waitFor();
  const cover = page.locator('[data-testid="document-preview-cover"]');
  const pricing = page.locator('[data-testid="document-preview-pricing"]');
  assert.match(await cover.innerText(), /Smart\s*Automation\s*Proposal/);
  assert.equal(await page.getByRole("button", { name: "Save Document Content" }).isDisabled(), true);

  await page.locator("summary", { hasText: "Cover page" }).click();
  await page.getByLabel("Cover title").fill("Home Automation Quote");
  await page.getByLabel("Prepared-for label").fill("Prepared for");
  await page.locator("summary", { hasText: "Pricing page" }).click();
  await page.getByLabel("Pricing page title").fill("Pricing & Way Forward");
  assert.match(await cover.innerText(), /Home\s*Automation\s*Quote/);
  assert.match(await cover.innerText(), /PREPARED FOR/);
  assert.match(await pricing.innerText(), /Pricing & Way Forward/);

  // Reset brings the standard wording back (unsaved)
  await page.getByRole("button", { name: "Reset document text" }).click();
  assert.match(await cover.innerText(), /Smart\s*Automation\s*Proposal/);
  assert.equal(await page.getByLabel("Cover title").inputValue(), "");
  pass("the live preview follows each label as it is typed; Reset document text restores the standard wording");

  await page.getByLabel("Cover title").fill("Home Automation Quote");
  await page.getByLabel("Prepared-for label").fill("Prepared for");
  await page.getByLabel("Pricing page title").fill("Pricing & Way Forward");
  await page.getByRole("button", { name: "Remove included item 4" }).click();
  await page.getByRole("button", { name: "Remove included item 3" }).click();
  await page.getByLabel("Included item 1", { exact: true }).fill("Smart switches and scenes");
  await page.getByRole("button", { name: "Remove next step 4" }).click();
  await page.getByRole("button", { name: "Remove next step 3" }).click();
  await page.getByLabel("Next step 1 title").fill("Approve");
  await page.getByLabel("Next step 1 description").fill("Approve this quotation.");
  await page.getByLabel("Default terms").fill("50% advance with order.");
  const pricingText = await pricing.innerText();
  assert.match(pricingText, /Smart switches and scenes/);
  assert.doesNotMatch(pricingText, /Project-wise pricing/);
  assert.match(pricingText, /1\. Approve/);
  assert.match(pricingText, /50% advance with order\./);
  assert.equal(await pricing.locator('[data-testid="proposal-next-steps"] li').count(), 2);

  // validation
  await page.getByLabel("Default validity (days)").fill("999");
  await page.locator("summary", { hasText: "Cover page" }).click(); // closed now
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Enter a whole number of days from 1 to 365.").waitFor();
  assert.equal((await db.collection("companies").findOne({ _id: 20 })).documentSettings, undefined, "nothing saved while invalid");
  await page.getByLabel("Default validity (days)").fill("15");
  assert.match(await pricing.innerText(), /Valid for 15 days from date of issue\./);
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Your quotation documents and page footer use the new content.").first().waitFor();
  const saved = (await db.collection("companies").findOne({ _id: 20 })).documentSettings;
  assert.deepEqual(saved.labels, { coverTitle: "Home Automation Quote", preparedFor: "Prepared for", closingTitle: "Pricing & Way Forward" }, "only the changed labels are stored");
  assert.deepEqual(saved.includes, ["Smart switches and scenes", "Room-wise space configuration & mapping"]);
  assert.deepEqual(saved.nextSteps, [{ title: "Approve", text: "Approve this quotation." }, { title: "Confirm", text: "Confirm product selection and quantities." }]);
  assert.equal(saved.defaultValidityDays, 15);
  assert.equal(saved.defaultTerms, "50% advance with order.");
  pass("labels, lists, steps, validity and terms are validated, previewed and saved (only what differs from the defaults)");

  // ── the real documents ──
  const acmeAfter = await documentOf(dealers.acme, acmeQ);
  assert.match(acmeAfter.text, /Home\s*Automation\s*Quote/);
  assert.match(acmeAfter.text, /PREPARED FOR\n/);
  for (const phrase of ["Pricing & Way Forward", "Smart switches and scenes", "1. Approve", "2. Confirm", "Valid for 15 days from date of issue.", "50% advance with order."]) {
    assert.ok(acmeAfter.text.includes(phrase), `Acme's document shows "${phrase}"`);
  }
  for (const phrase of ["Investment & Next Steps", "1. Review", "4. Proceed", "Valid for 30 days", "Project-wise pricing and investment breakdown", "PREPARED EXCLUSIVELY FOR"]) {
    assert.ok(!acmeAfter.text.includes(phrase), `Acme's document no longer shows "${phrase}"`);
  }
  assert.equal(acmeAfter.steps, 2);
  const whyteAfter = await documentOf(dealers.whyte, whyteQ);
  assert.equal(whyteAfter.text, whyteBefore.text, "the default company's document is unchanged, word for word");
  pass("Acme's quotation document shows its own wording; the default company's document is unchanged word for word");

  // empty lists hide their boxes
  const res = await fetch(`${baseUrl}/api/company`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: owner }, body: JSON.stringify({ documentSettings: { includes: [], nextSteps: [] } }) });
  assert.equal(res.status, 200);
  const acmeEmpty = await documentOf(dealers.acme, acmeQ);
  assert.equal(acmeEmpty.steps, 0, "no next steps: the section is hidden");
  assert.equal(acmeEmpty.includes, 0, "no lines and no selections: the includes box is hidden");
  assert.ok(acmeEmpty.text.includes("Valid for 30 days from date of issue."), "the replaced settings fall back to the defaults");
  const rejected = await fetch(`${baseUrl}/api/company`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: owner }, body: JSON.stringify({ documentSettings: { labels: { coverTitle: "x".repeat(41) } } }) });
  assert.equal(rejected.status, 400, "the server enforces the label limits");
  pass("an empty Next Steps or Includes list hides that box; the server rejects labels over their limit");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
