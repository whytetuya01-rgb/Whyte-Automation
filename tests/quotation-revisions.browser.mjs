/**
 * Quotation revisions in the editor (real Chromium, isolated production server, throwaway MongoDB): an issued quotation shows its
 * revision and is locked; the history lists each version with its stored PDF; a revision is created with a reason and reopens
 * the quotation; an approved quotation needs an approver (request, then approve) - at 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/quotation-revisions.browser.mjs
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
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);
const waitUntil = async (check, what, ms = 20000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};
/** The visible element with this test id (the editor keeps a hidden copy of itself after its own step navigation). */
const vis = (scope, id) => scope.locator(`[data-testid="${id}"]:visible`);
const pdf = (label) => Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

try {
  server = await startIsolatedServer("qrev-ui", [
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
  await db.collection("products").insertOne({ _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 1, companyId: 20, productId: 2001, variantCode: "SW-1", name: "SW-1", config: {}, price: dec("1180.00"), priceWithoutTax: dec("1000.00"), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = { owner: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user") };

  browser = await chromium.launch({ headless: true });
  const open = async (cookies, viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookies.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  };
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const issuedQuotation = async (client) => {
    const created = await api(c.dealer, "POST", "/api/quotations", { clientName: client, houseTypeId: 201 });
    const id = created.data.id ?? created.data._id;
    const roomId = (await api(c.dealer, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    assert.equal((await api(c.dealer, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 1, quantity: 2 })).status, 201);
    assert.equal((await api(c.dealer, "POST", `/api/quotations/${id}/mark-sent`)).status, 200);
    const form = new FormData();
    form.append("pdf", new Blob([pdf(`first ${client}`)], { type: "application/pdf" }), "q.pdf");
    assert.equal((await fetch(`${baseUrl}/api/quotations/${id}/revisions/current/pdf`, { method: "POST", headers: { Cookie: c.dealer }, body: form })).status, 200);
    return id;
  };
  const row = (id) => db.collection("quotations").findOne({ _id: id });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const id = await issuedQuotation(`Client ${w}`);
    const page = await open(c.dealer, viewport);
    await page.goto(`${baseUrl}/quotation/${id}?step=3`, { waitUntil: "domcontentloaded" });
    const bar = vis(page, "revision-bar");
    await bar.waitFor();
    assert.match(await vis(page, "revision-badge").innerText(), /Revision 1/);
    assert.match(await vis(page, "revision-locked").innerText(), /Issued and locked/);
    assert.ok(await noScroll(page), `no horizontal scroll with the bar at ${w}px`);

    // the document itself: no revision mark on the first issue
    await page.goto(`${baseUrl}/quotation/${id}?step=5`, { waitUntil: "domcontentloaded" });
    await vis(page, "document-quotation-number").waitFor();
    assert.doesNotMatch(await vis(page, "document-quotation-number").innerText(), /Rev/, "revision 1 looks exactly as before");
    await page.goto(`${baseUrl}/quotation/${id}?step=3`, { waitUntil: "domcontentloaded" });
    await vis(page, "revision-bar").waitFor();

    // history
    await vis(page, "revision-history-open").click();
    const history = vis(page, "revision-history");
    await vis(history, "revision-row").first().waitFor();
    assert.equal(await vis(history, "revision-row").count(), 1);
    assert.match(await vis(history, "revision-row").first().innerText(), /Revision 1[\s\S]*Current[\s\S]*Dealer A[\s\S]*1 item/i);
    const href = await vis(history, "revision-pdf").getAttribute("href");
    assert.equal(href, `/api/quotations/${id}/revisions/1/pdf`);
    const response = await page.request.get(`${baseUrl}${href}`);
    assert.equal(response.status(), 200);
    assert.equal((await response.body()).toString().startsWith("%PDF-"), true, "the stored PDF opens");
    await page.keyboard.press("Escape");
    await history.waitFor({ state: "detached" });

    // create a revision
    await vis(page, "revision-create-open").click();
    const create = vis(page, "revision-create");
    await create.waitFor();
    assert.equal(await vis(page, "revision-create-submit").isDisabled(), true, "a reason is required");
    await vis(page, "revision-reason").fill("Client wants a second switch");
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/revision-create-${w}.png` });
    // creating the revision reloads the editor: wait for that reload to finish
    await Promise.all([page.waitForEvent("load"), vis(page, "revision-create-submit").click()]);
    await vis(page, "revision-draft").waitFor();
    assert.match(await vis(page, "revision-badge").innerText(), /Revision 2/);
    await waitUntil(async () => /Being revised: Client wants a second switch/.test(await vis(page, "revision-draft").innerText()), "the reason to show in the bar");
    assert.equal(await vis(page, "revision-create-open").count(), 0, "a draft has nothing to revise");
    const reopened = await row(id);
    assert.deepEqual([reopened.status, reopened.revision], ["draft", 2]);
    assert.ok(await noScroll(page), `no horizontal scroll while revising at ${w}px`);
    // the quotation is editable again, and revision 1 is still in the history
    const roomId = (await api(c.dealer, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    assert.equal((await api(c.dealer, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 1, quantity: 1 })).status, 201);
    // the document now carries the revision mark
    await page.goto(`${baseUrl}/quotation/${id}?step=5`, { waitUntil: "domcontentloaded" });
    await vis(page, "document-quotation-number").waitFor();
    assert.match(await vis(page, "document-quotation-number").innerText(), /· Rev 2$/, "revision 2 says so on the document");
    await page.goto(`${baseUrl}/quotation/${id}?step=3`, { waitUntil: "domcontentloaded" });
    await vis(page, "revision-bar").waitFor();
    await vis(page, "revision-history-open").click();
    await vis(page, "revision-row").first().waitFor();
    assert.equal(await vis(page, "revision-row").count(), 1, "only issued versions are listed");
    assert.match(await vis(page, "revision-row").first().innerText(), /Revision 1[\s\S]*Replaced by revision 2/i);
    await page.context().close();
  }
  pass("an issued quotation shows its revision and that it is locked; the history lists each issued version with its stored PDF; creating a revision needs a reason, reopens the quotation as the next revision and keeps the issued one; at 1280px and 375px with no overflow");

  // approval: a dealer asks, an approver decides
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const id = await issuedQuotation(`Approved ${w}`);
    assert.equal((await api(c.owner, "POST", `/api/quotations/${id}/transition`, { action: "approve" })).status, 200);

    const dealerPage = await open(c.dealer, viewport);
    await dealerPage.goto(`${baseUrl}/quotation/${id}?step=3`, { waitUntil: "domcontentloaded" });
    await vis(dealerPage, "revision-bar").waitFor();
    assert.match(await vis(dealerPage, "revision-create-open").innerText(), /Request revision/, "an approved quotation is requested, not revised");
    await vis(dealerPage, "revision-create-open").click();
    await vis(dealerPage, "revision-reason").fill("Customer changed the colour");
    await vis(dealerPage, "revision-create-submit").click();
    const waiting = vis(dealerPage, "revision-request");
    await waiting.waitFor();
    assert.match(await waiting.innerText(), /Dealer A[\s\S]*asked to revise this approved quotation[\s\S]*Customer changed the colour[\s\S]*Waiting for an approver/);
    assert.equal(await vis(dealerPage, "revision-approve").count(), 0, "a dealer cannot decide");
    assert.equal(await vis(dealerPage, "revision-create-open").count(), 0, "one request at a time");
    assert.deepEqual([(await row(id)).status, (await row(id)).revision], ["approved", 1], "nothing has changed yet");
    assert.ok(await noScroll(dealerPage), `no horizontal scroll with a waiting request at ${w}px`);
    await dealerPage.context().close();

    const ownerPage = await open(c.owner, viewport);
    await ownerPage.goto(`${baseUrl}/quotation/${id}?step=3`, { waitUntil: "domcontentloaded" });
    await vis(ownerPage, "revision-request").waitFor();
    assert.equal(await vis(ownerPage, "revision-approve").count(), 1, "the approver sees the decision buttons");
    if (process.env.SCREENSHOT_DIR) await ownerPage.screenshot({ path: `${process.env.SCREENSHOT_DIR}/revision-request-${w}.png` });
    await Promise.all([ownerPage.waitForEvent("load"), vis(ownerPage, "revision-approve").click()]);
    await waitUntil(async () => (await row(id)).revision === 2, "the revision to be created");
    const done = await row(id);
    assert.deepEqual([done.status, done.revision, done.revisionReason, done.revisionRequest.status, done.approvedAt], ["draft", 2, "Customer changed the colour", "approved", null]);
    await ownerPage.context().close();
  }
  pass("an approved quotation is revised by request: the dealer asks (and sees it waiting, no decision buttons), the approver sees the request and approves it, and the quotation reopens as revision 2; at 1280px and 375px");

  console.log(`\nALL ${count} QUOTATION REVISION BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
