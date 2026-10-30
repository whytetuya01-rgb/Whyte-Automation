/**
 * Browser check of WhatsApp sharing and secure view links (real Chromium against an isolated production server):
 * the Send dialog's WhatsApp tab prefills the client's number and message and opens WhatsApp with the secure link;
 * the client opening the link (no sign-in) turns the row "Viewed"; the link can be copied and switched off; the admin
 * Deliveries page lists the send with its views and the tracking setup; the public page fits a phone screen.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/quotation-links.browser.mjs
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

// Headless Chromium announces itself as "HeadlessChrome", which the server rightly does not count as a client.
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

try {
  // Email is deliberately not configured here: the setup check must say so (and WhatsApp still works).
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  server = await startIsolatedServer("links-ui", [
    { _id: 1, email: "dealer@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 10 },
    { _id: 2, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "acme", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 101, companyId: 10, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertOne({ _id: 101, companyId: 10, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 101, companyId: 10, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 101, companyId: 10, houseTypeId: 101, roomTypeId: 101, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertOne({ _id: 101, companyId: 10, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 101, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 101, companyId: 10, productId: 101, variantCode: "V-1", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer@example.com", "user");
  const owner = await login("owner@example.com", "admin");
  const created = await api(dealer, "POST", "/api/quotations", { clientName: "Ravi Client", houseTypeId: 101 });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const room = (await api(dealer, "GET", `/api/quotations/${qid}`)).data.rooms[0];
  assert.equal((await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId: 101, productVariantId: 101, quantity: 2 })).status, 201);
  await db.collection("quotations").updateOne({ _id: qid }, { $set: { clientPhone: "9876543210" } });
  const quotationNumber = (await db.collection("quotations").findOne({ _id: qid })).quotationNumber;

  browser = await chromium.launch({ headless: true });
  const withCookies = async (cookieHeader, options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: CHROME, ...options });
    if (cookieHeader) await context.addCookies(cookieHeader.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    // WhatsApp itself is not contacted from the test.
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
    return context;
  };
  const dealerContext = await withCookies(dealer);
  await dealerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await dealerContext.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
  await page.locator(".proposal-page").first().waitFor();

  // ── share on WhatsApp ──
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const dialog = page.locator('[data-testid="quotation-delivery"]');
  await dialog.waitFor();
  await dialog.getByRole("tab", { name: /WhatsApp/ }).click();
  assert.equal(await dialog.getByLabel("Client's WhatsApp number").inputValue(), "9876543210", "the client's phone is prefilled");
  assert.equal(await dialog.getByLabel("Message").inputValue(), `Dear Ravi Client, please find quotation ${quotationNumber} from Acme Homes.`);
  await dialog.getByLabel("Client's WhatsApp number").fill("12");
  await dialog.getByRole("button", { name: "Share on WhatsApp" }).click();
  await dialog.getByText(/Enter a valid mobile number/).waitFor();
  assert.equal(await db.collection("quotationdeliveries").countDocuments({}), 0, "nothing is shared with a bad number");
  await dialog.getByLabel("Client's WhatsApp number").fill("98765 43210");
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Share on WhatsApp" }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/^https:\/\/wa\.me\//, { timeout: 90000 });
  const wa = new URL(popup.url());
  assert.equal(wa.pathname, "/919876543210");
  const sharedText = wa.searchParams.get("text");
  const linkMatch = sharedText.match(/View your quotation: (\S+)$/);
  assert.ok(sharedText.startsWith(`Dear Ravi Client, please find quotation ${quotationNumber}`) && linkMatch, sharedText);
  const link = linkMatch[1];
  assert.ok(link.startsWith(`${baseUrl}/q/`));
  await popup.close();
  const row = dialog.locator('[data-testid="delivery-row"][data-channel="whatsapp"]').first();
  await row.waitFor();
  assert.match(await row.locator('[data-testid="delivery-status"]').innerText(), /Shared/);
  assert.match(await row.innerText(), /\+919876543210/);
  assert.match(await row.locator('[data-testid="delivery-views"]').innerText(), /Not opened yet/);
  assert.equal((await db.collection("quotations").findOne({ _id: qid })).status, "sent");
  pass("the WhatsApp tab prefills the client's number and message, refuses a bad number, and opens WhatsApp with the message and secure link; the row shows Shared");

  // ── the client opens the link ──
  const clientContext = await withCookies(null);
  const clientPage = await clientContext.newPage();
  await clientPage.goto(link, { waitUntil: "domcontentloaded" });
  await clientPage.getByRole("heading", { name: `Quotation ${quotationNumber}` }).waitFor();
  assert.match(await clientPage.locator("main").innerText(), /Prepared for Ravi Client/);
  assert.ok(await clientPage.getByRole("link", { name: /Download PDF/ }).isVisible());
  assert.ok(await clientPage.locator(`iframe[title="Quotation ${quotationNumber}"]`).isVisible(), "a large screen shows the PDF in the page");
  const download = await (await clientContext.request.get(`${baseUrl}/api/public/quotation-links/${link.split("/q/")[1]}/pdf?download=1`)).body();
  assert.equal(download.subarray(0, 5).toString("latin1"), "%PDF-", "the download is the PDF");
  const deadline = Date.now() + 20000;
  while ((await db.collection("quotationdeliveries").findOne({ channel: "whatsapp" })).viewCount !== 1) {
    assert.ok(Date.now() < deadline, "the view was recorded");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="delivery-row"][data-channel="whatsapp"]')?.getAttribute("data-status") === "read");
  assert.match(await row.locator('[data-testid="delivery-status"]').innerText(), /Viewed/);
  assert.match(await row.locator('[data-testid="delivery-views"]').innerText(), /Opened 1 time/);
  pass("the client opens the link without signing in and sees the quotation; the sender's row turns Viewed with the view count");

  // ── copy and switch off ──
  await row.getByRole("button", { name: "Copy link" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link, "Copy link gives the same link again");
  await row.getByRole("button", { name: "Switch off link" }).click();
  await row.getByRole("button", { name: "Yes, switch off" }).click();
  await row.getByText("Link switched off").waitFor();
  assert.equal(await row.getByRole("button", { name: "Copy link" }).count(), 0, "a switched-off link cannot be copied");
  await clientPage.reload({ waitUntil: "domcontentloaded" });
  await clientPage.getByRole("heading", { name: "This link has been switched off" }).waitFor();
  assert.equal(await clientPage.locator("iframe").count(), 0);
  pass("Copy link copies the same link; Switch off link (with a confirm step) stops it working for the client at once");

  // ── the admin Deliveries page ──
  const ownerContext = await withCookies(owner);
  const adminPage = await ownerContext.newPage();
  adminPage.setDefaultTimeout(45000);
  await adminPage.goto(`${baseUrl}/admin/deliveries`, { waitUntil: "domcontentloaded" });
  const table = adminPage.locator('[data-testid="deliveries-table"]');
  await table.waitFor();
  const adminRow = table.locator('[data-testid="deliveries-row"]').first();
  assert.match(await adminRow.innerText(), new RegExp(quotationNumber));
  assert.match(await adminRow.innerText(), /\+919876543210/);
  assert.match(await adminRow.innerText(), /Viewed/);
  assert.match(await adminRow.innerText(), /Link switched off/);
  const tiles = await adminPage.locator('[data-testid="delivery-summary"] button').allInnerTexts();
  assert.ok(tiles.some((t) => /Viewed by client\s+1/i.test(t)), tiles.join(" | "));
  const checks = adminPage.locator('[data-testid="setup-check"]');
  assert.equal(await checks.count(), 3);
  assert.equal(await checks.nth(0).getAttribute("data-ok"), "false", "email is not configured in this test");
  assert.match(await adminPage.locator('[data-testid="delivery-setup"]').innerText(), /WhatsApp sharing still works/);
  await adminPage.getByRole("link", { name: "Deliveries" }).first().waitFor();
  await adminPage.getByLabel("Filter by channel").click();
  await adminPage.getByRole("option", { name: "Email" }).click();
  await adminPage.getByText("No deliveries found").waitFor();
  pass("the admin Deliveries page lists the send with its quotation, status and views, shows totals and the tracking setup, and filters by channel");

  // ── the public page on a phone ──
  const share2 = await (async () => {
    const body = new FormData();
    body.append("channel", "whatsapp");
    body.append("to", "9876543210");
    body.append("pdf", new Blob([download], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries`, { method: "POST", headers: { Cookie: dealer }, body });
    return (await res.json()).data;
  })();
  const phone = await withCookies(null, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  await phonePage.goto(share2.link.url, { waitUntil: "domcontentloaded" });
  await phonePage.getByRole("heading", { name: `Quotation ${quotationNumber}` }).waitFor();
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no sideways scrolling on a phone (${overflow}px)`);
  assert.ok(await phonePage.getByRole("link", { name: /Open full screen/ }).isVisible());
  assert.equal(await phonePage.locator("iframe").isVisible(), false, "phones get buttons instead of an embedded PDF");
  pass("on a phone the view page fits the screen and offers Open full screen / Download instead of an embedded PDF");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-2000));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
