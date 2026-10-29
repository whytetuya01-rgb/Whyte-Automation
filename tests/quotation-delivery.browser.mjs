/**
 * Browser check of quotation delivery (real Chromium against an isolated production server; the email provider is
 * a local fake): "Send by Email" builds the real PDF and emails it, the history shows Sent → Delivered → Read as
 * signed provider notifications arrive, and a failed send shows a clear error and can be retried.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/quotation-delivery.browser.mjs
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
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
let fake;
let browser;
let exitCode = 0;

const emails = [];
let mode = "ok";
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (mode === "http500") { res.statusCode = 500; res.end("{}"); return; }
      emails.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});
const secretBytes = randomBytes(24);

try {
  fake = await startFake();
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "Quotations <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
    RESEND_WEBHOOK_SECRET: `whsec_${secretBytes.toString("base64")}`,
  });
  server = await startIsolatedServer("delivery-ui", [
    { _id: 1, email: "dealer@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 10 },
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
  const created = await api(dealer, "POST", "/api/quotations", { clientName: "Ravi Client", houseTypeId: 101 });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const room = (await api(dealer, "GET", `/api/quotations/${qid}`)).data.rooms[0];
  assert.equal((await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId: 101, productVariantId: 101, quantity: 2 })).status, 201);
  const notify = async (type, emailId) => {
    const id = `msg_${randomBytes(6).toString("hex")}`;
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId } });
    const signature = `v1,${createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64")}`;
    const res = await fetch(`${baseUrl}/api/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": signature }, body });
    assert.equal(res.status, 200);
  };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
  await page.locator(".proposal-page").first().waitFor();

  // ── open and send ──
  await page.getByRole("button", { name: /Send by Email/ }).click();
  const dialog = page.locator('[data-testid="quotation-delivery"]');
  await dialog.waitFor();
  assert.match(await page.getByLabel("Subject").inputValue(), /^Quotation QT-\d{4}-\d{3} from Acme Homes$/, "a sensible default subject");
  await dialog.getByText("This quotation has not been emailed yet.").waitFor();
  await page.getByRole("button", { name: "Send Quotation" }).click();
  await dialog.getByText("Enter the client's email address.").waitFor();
  assert.equal(emails.length, 0, "nothing is sent without an address");
  await page.getByLabel("To (client email)").fill("ravi@example.com");
  await page.getByLabel("Message (optional)").fill("Dear Ravi,\n\nPlease find the quotation attached.");
  await page.getByRole("button", { name: "Send Quotation" }).click();
  await page.locator("text=Emailed to ravi@example.com").first().waitFor({ timeout: 90000 });
  const row = dialog.locator('[data-testid="delivery-row"]').first();
  assert.equal(await row.getAttribute("data-status"), "sent");
  assert.equal(emails.length, 1);
  const pdf = Buffer.from(emails[0].attachments[0].content, "base64");
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-", "a real PDF is attached");
  assert.ok(pdf.length > 20000, `the attached PDF is the rendered document (${pdf.length} bytes)`);
  assert.equal(emails[0].to, "ravi@example.com");
  assert.equal((await db.collection("quotations").findOne({ _id: qid })).status, "sent", "the quotation is now sent");
  pass("Send by Email builds the real PDF, emails it to the client and shows the delivery as Sent; the quotation becomes sent");

  // ── provider notifications appear in the history ──
  await notify("email.delivered", "email_1");
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="delivery-row"]')?.getAttribute("data-status") === "delivered");
  await notify("email.opened", "email_1");
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="delivery-row"]')?.getAttribute("data-status") === "read");
  assert.match(await row.locator('[data-testid="delivery-status"]').innerText(), /Read/);
  await row.getByRole("button", { name: /Show history/ }).click();
  const events = await row.locator('[data-testid="delivery-events"] li').allInnerTexts();
  assert.deepEqual(events.map((e) => e.split(" ")[0].toLowerCase()), ["read", "delivered", "sent", "queued"], "the full timeline, newest first");
  pass("delivered and read notifications from the email service appear in the delivery history with a timeline");

  // ── failure and retry ──
  mode = "http500";
  await page.getByLabel("To (client email)").fill("second@example.com");
  await page.getByRole("button", { name: "Send Quotation" }).click();
  await dialog.locator('[role="alert"]', { hasText: "temporary problem" }).waitFor({ timeout: 90000 });
  const failedRow = dialog.locator('[data-testid="delivery-row"][data-status="failed"]').first();
  await failedRow.waitFor();
  assert.match(await failedRow.innerText(), /second@example\.com/);
  assert.match(await failedRow.innerText(), /temporary problem/);
  mode = "ok";
  await failedRow.getByRole("button", { name: "Retry" }).click();
  await page.locator("text=Emailed to second@example.com").first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="delivery-row"]')].some((el) => el.textContent?.includes("second@example.com") && el.getAttribute("data-status") === "sent"));
  assert.equal(emails.length, 2);
  assert.equal(emails[1].to, "second@example.com");
  assert.ok(Buffer.from(emails[1].attachments[0].content, "base64").length > 20000, "the retry sends the stored PDF");
  pass("a failed send shows a clear error and a Retry button; Retry sends the stored PDF and the row turns Sent");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  fake?.close();
  process.exit(exitCode);
}
