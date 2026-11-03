/**
 * An Admin clones a quotation from the admin list (real Chromium, isolated production server, throwaway MongoDB):
 * the Clone action opens a dialog; the clone is a new draft with a new number that points back at its source and leaves
 * the source untouched; the owner can stay the original dealer, become the Admin, or become another dealer; "Header
 * only" copies no rooms; the dialog fits 1280px and 375px. Written during development, to run in the final test pass.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/admin-clone-quotation.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

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

try {
  server = await startIsolatedServer("admin-clone", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Adi Admin", companyId: 10 },
    { _id: 5, email: "dealer5@example.com", role: "dealer", name: "Dealer Five", companyId: 10, discountAllocationPercent: 10 },
    { _id: 6, email: "dealer6@example.com", role: "dealer", name: "Dealer Six", companyId: 10, discountAllocationPercent: 10 },
    { _id: 7, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("quotations").insertOne({
    _id: "q_source", quotationNumber: "QT-2026-0001", companyId: 10, clientName: "Asha Patel", clientPhone: "9000000001", status: "approved",
    dealerId: 5, notes: "Villa automation", terms: "50% advance", createdBy: "2", createdAt: now, updatedAt: now,
  });
  const cookie = { admin: await login("admin@example.com", "admin"), adminB: await login("adminb@example.com", "admin") };
  const source = () => db.collection("quotations").findOne({ _id: "q_source" });
  const before = await source();

  // ── API behaviour behind the dialog ──
  const same = await api(cookie.admin, "POST", "/api/quotations/q_source/duplicate", {});
  assert.ok(same.status < 300, same.text?.slice(0, 300));
  const sameDoc = await db.collection("quotations").findOne({ _id: same.data.id ?? same.data._id });
  assert.deepEqual([sameDoc.status, sameDoc.clonedFromQuotationId, sameDoc.dealerId, sameDoc.clientName], ["draft", "q_source", 5, "Asha Patel (Revision)"], "a draft that points at its source, owned by the original dealer");
  assert.notEqual(sameDoc.quotationNumber, before.quotationNumber, "a new number");
  const mine = await api(cookie.admin, "POST", "/api/quotations/q_source/duplicate", { dealerId: null, clientName: "Asha Patel - Phase 2", includeRooms: false });
  const mineDoc = await db.collection("quotations").findOne({ _id: mine.data.id ?? mine.data._id });
  assert.deepEqual([mineDoc.dealerId ?? null, mineDoc.clientName], [null, "Asha Patel - Phase 2"], "kept for the Admin, renamed");
  const other = await api(cookie.admin, "POST", "/api/quotations/q_source/duplicate", { dealerId: 6 });
  assert.equal((await db.collection("quotations").findOne({ _id: other.data.id ?? other.data._id })).dealerId, 6, "given to another dealer");
  assert.equal((await api(cookie.adminB, "POST", "/api/quotations/q_source/duplicate", {})).status >= 400, true, "another company's Admin cannot clone it");
  assert.deepEqual(await source(), before, "the source quotation is untouched by all of this");
  pass("API: a clone is a new draft with a new number pointing at its source; the owner can be kept, the Admin, or another dealer; another company is refused; the source is never changed");

  // ── UI ──
  browser = await chromium.launch({ headless: true });
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.admin.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };

  const desk = await open({ width: 1280, height: 900 });
  await desk.page.goto(`${baseUrl}/admin/quotations`, { waitUntil: "domcontentloaded" });
  const row = desk.page.locator("tr", { hasText: "QT-2026-0001" });
  await row.waitFor();
  await row.getByTestId("clone-quotation").click();
  const dialog = desk.page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Clone QT-2026-0001/);
  assert.match(await dialog.innerText(), /original stays exactly as it is/i);
  assert.ok(await noHorizontalScroll(desk.page));
  await shot(desk.page, "clone-dialog-1280");
  await dialog.getByLabel("Client name (optional)").fill("Asha Patel - Annexe");
  await dialog.getByLabel("Owner of the new quotation").selectOption({ label: "Keep it for myself (no dealer)" });
  await dialog.getByLabel("Header only").check();
  const before2 = await db.collection("quotations").countDocuments({});
  await dialog.getByTestId("clone-confirm").click();
  await desk.page.waitForURL(/\/quotation\/q_/);
  assert.equal(await db.collection("quotations").countDocuments({}), before2 + 1, "one new quotation");
  const created = await db.collection("quotations").findOne({ clientName: "Asha Patel - Annexe" });
  assert.deepEqual([created.status, created.clonedFromQuotationId, created.dealerId ?? null], ["draft", "q_source", null]);
  assert.equal(await db.collection("quotationrooms").countDocuments({ quotationId: created._id }), 0, "header only copies no rooms");
  assert.deepEqual(await source(), before, "the source is still untouched");
  await desk.context.close();
  pass("UI at 1280px: Clone opens the dialog, the chosen name, owner and scope are used, the new draft opens, the source is untouched");

  // the same dialog from the quotation's own header
  const builder = await open({ width: 1280, height: 900 });
  await builder.page.goto(`${baseUrl}/quotation/q_source`, { waitUntil: "domcontentloaded" });
  await builder.page.getByTestId("builder-clone").waitFor();
  await builder.page.getByTestId("builder-clone").click();
  const builderDialog = builder.page.getByRole("dialog");
  await builderDialog.waitFor();
  assert.match(await builderDialog.innerText(), /Clone QT-2026-0001/);
  assert.ok((await builderDialog.getByLabel("Owner of the new quotation").locator("option").count()) >= 3, "the Admin can choose the owner here too");
  const countBefore = await db.collection("quotations").countDocuments({});
  await builderDialog.getByTestId("clone-confirm").click();
  await builder.page.waitForURL((url) => /\/quotation\/q_/.test(url.pathname) && !url.pathname.endsWith("q_source"));
  assert.equal(await db.collection("quotations").countDocuments({}), countBefore + 1, "one more quotation");
  assert.deepEqual(await source(), before, "the source is untouched");
  await builder.context.close();
  pass("the quotation page header has a Clone button that opens the same dialog and creates a new draft");

  const phone = await open({ width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/admin/quotations`, { waitUntil: "domcontentloaded" });
  await phone.page.getByTestId("clone-quotation").first().waitFor();
  await phone.page.getByTestId("clone-quotation").first().click();
  const sheet = phone.page.getByRole("dialog");
  await sheet.waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px with the dialog open");
  const box = await sheet.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375, "the dialog fits the phone screen");
  await shot(phone.page, "clone-dialog-375");
  await phone.context.close();
  pass("at 375px the Clone button is on each card and the dialog fits the screen");

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
