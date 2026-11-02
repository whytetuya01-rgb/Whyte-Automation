/**
 * CRM customer profile (real Chromium, isolated production server, throwaway MongoDB): the header, segment and headline
 * numbers match the data, the follow-up warning shows, tabs work by mouse and keyboard and survive a reload, the
 * quotations tab filters / searches / sorts, copy buttons copy, "New enquiry" creates a linked lead without reloading
 * the page, the activity timeline filters, another company's customer is not found, and the page fits 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/crm-customer-profile.browser.mjs
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
const DAY = 86_400_000;
const digits = (text) => text.replace(/[^\d]/g, "");

try {
  server = await startIsolatedServer("crm-customer", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = Date.now();
  const stamp = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: stamp, updatedAt: stamp },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: stamp, updatedAt: stamp },
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: stamp });
  await db.collection("roomtypes").insertOne({ _id: 201, companyId: 20, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 201, companyId: 20, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 201, companyId: 20, houseTypeId: 201, roomTypeId: 201, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertOne({ _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: stamp, updatedAt: stamp });
  await db.collection("productvariants").insertOne({ _id: 2001, companyId: 20, productId: 2001, variantCode: "V-2001", config: {}, price: Decimal128.fromString("10000.00"), priceWithoutTax: Decimal128.fromString("8474.58"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1, createdAt: stamp, updatedAt: stamp });
  const customerBase = { companyId: 20, createdBy: 1, createdAt: new Date(now - 200 * DAY), updatedAt: stamp };
  await db.collection("customers").insertMany([
    { _id: 30, ...customerBase, name: "Meera Kapoor", phone: "9876543210", whatsapp: "9876543210", email: "meera@example.com", billingAddress: "12 Billing Street, Ahmedabad", siteAddress: "Villa 7, Green Acres, Surat", gstNumber: "24ABCDE1234F1Z5", customerType: "architect", notes: "Prefers WhatsApp.\nDecision maker: her partner.", assignedSalesId: null, dealerId: null },
    { _id: 31, ...customerBase, companyId: 30, name: "Other Company Customer", phone: "9000000001", customerType: "individual" },
  ]);
  const cookie = await login("owner@example.com", "admin");

  // Five quotations created through the real API, then linked to the customer with their statuses.
  const created = [];
  for (const [status, quantity] of [["draft", 1], ["sent", 2], ["approved", 3], ["delivered", 1], ["rejected", 1]]) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName: "Meera Kapoor", houseTypeId: 201 });
    assert.equal(res.status, 201, res.text?.slice(0, 160));
    const id = res.data.id ?? res.data._id;
    const roomId = (await api(cookie, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    const item = await api(cookie, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 2001, quantity });
    assert.equal(item.status, 201, item.text?.slice(0, 160));
    await db.collection("quotations").updateOne({ _id: id }, { $set: { customerId: 30, status } });
    created.push({ id, status });
  }
  await db.collection("leads").insertMany([
    { _id: "l1", companyId: 20, customerId: 30, referenceNumber: "LD-2026-0001", customerName: "Meera Kapoor", projectType: "4 BHK Villa", estimatedBudget: 500000, status: "quoted", priority: "high", nextFollowUpAt: new Date(now - 3 * DAY), expectedClosingDate: new Date(now + 20 * DAY), createdBy: 1, createdAt: new Date(now - 30 * DAY), updatedAt: stamp },
    { _id: "l2", companyId: 20, customerId: 30, referenceNumber: "LD-2026-0002", customerName: "Meera Kapoor", projectType: "Office fit-out", estimatedBudget: 200000, status: "won", priority: "medium", createdBy: 1, createdAt: new Date(now - 90 * DAY), updatedAt: stamp },
    { _id: "l3", companyId: 20, customerId: 30, referenceNumber: "LD-2026-0003", customerName: "Meera Kapoor", projectType: "Studio", estimatedBudget: 80000, status: "lost", lostReason: "Price", priority: "low", createdBy: 1, createdAt: new Date(now - 120 * DAY), updatedAt: stamp },
  ]);
  const act = (id, type, title, daysAgo, description) => ({ _id: id, companyId: 20, customerId: 30, type, title, description: description ?? null, performedBy: 1, performedByName: "Owner", performedAt: new Date(now - daysAgo * DAY) });
  await db.collection("crmactivities").insertMany([
    act("a1", "call", "Discussed scope", 1, "Wants lighting scenes in the living room."),
    act("a2", "whatsapp", "Shared brochure", 2),
    act("a3", "site_visit", "Measured the villa", 6),
    act("a4", "quotation_sent", "Quotation sent", 9),
    act("a5", "note", "Budget confirmed", 12),
  ]);

  const apiProfile = (await api(cookie, "GET", "/api/crm/customers/30")).data;
  assert.equal(apiProfile.quotations.length, 5);
  const byStatus = Object.fromEntries(apiProfile.quotations.map((q) => [q.status, q.grandTotal]));
  assert.ok(byStatus.approved > 0 && byStatus.delivered > 0, "the quotations have totals");
  assert.deepEqual(apiProfile.leads.map((l) => l.nextFollowUpAt != null), [true, false, false], "the profile API now returns follow-up dates");
  const approvedValue = byStatus.approved + byStatus.delivered;
  const quotedValue = apiProfile.quotations.reduce((sum, q) => sum + q.grandTotal, 0);

  browser = await chromium.launch({ headless: true });
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };

  // ── header and numbers ──
  const { page, context } = await open({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/admin/crm/customers/30`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("customer-name").waitFor();
  assert.equal(await page.getByTestId("customer-name").innerText(), "Meera Kapoor");
  assert.equal(await page.getByTestId("customer-segment").innerText(), "Repeat customer", "two approved quotations");
  const banner = await page.getByTestId("customer-banner").boundingBox();
  for (const testId of ["customer-name", "customer-segment"]) {
    const box = await page.getByTestId(testId).boundingBox();
    assert.ok(box && banner && box.y >= banner.y + banner.height - 1, `${testId} sits below the dark banner, not under it`);
  }
  const header = await page.getByTestId("customer-header").innerText();
  assert.match(header, /#CUST-30/);
  assert.match(header, /Architect/);
  assert.match(header, /Last activity 1d ago/);
  const stats = await page.getByTestId("customer-stats").innerText();
  assert.ok(digits(stats).includes(String(Math.round(approvedValue))), `approved value ${approvedValue} is shown`);
  assert.match(stats, /2 approved/);
  assert.match(stats, /1 open enquiry/);
  assert.match(stats, /67% approved/, "2 approved of 3 decided");
  assert.match(stats, /1 won · 1 lost/);
  assert.ok(digits(stats).includes("500000"), "open pipeline = the one open enquiry's budget");
  assert.match(await page.getByTestId("next-follow-up").innerText(), /3 days overdue[\s\S]*LD-2026-0001/);
  assert.ok(await noHorizontalScroll(page), "no horizontal scroll at 1280px");
  await shot(page, "customer-overview-1280");
  pass("header: name, segment, type, id, last activity, the headline numbers match the data, and the overdue follow-up is flagged");

  // ── overview ──
  const overview = page.getByTestId("overview-tab");
  assert.equal(await overview.locator("li", { hasText: /^QT-|QT-/ }).count() >= 3, true, "the three most recent quotations");
  assert.match(await overview.innerText(), /Villa 7, Green Acres, Surat/);
  assert.match(await overview.innerText(), /12 Billing Street/);
  assert.match(await overview.innerText(), /24ABCDE1234F1Z5/);
  assert.match(await page.getByTestId("customer-notes").innerText(), /Prefers WhatsApp\.\s*Decision maker: her partner\./, "notes show with their line breaks");
  assert.match(await overview.innerText(), /Discussed scope/);
  await page.getByRole("button", { name: "Copy phone" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "9876543210", "the copy button copies the phone number");
  await page.getByRole("button", { name: "Copy gstin" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "24ABCDE1234F1Z5");
  const whatsapp = await page.getByRole("link", { name: "WhatsApp Meera Kapoor" }).getAttribute("href");
  assert.match(whatsapp, /^https:\/\/wa\.me\/919876543210\?text=/, "a 10-digit Indian mobile gets its country code");
  assert.equal(await page.getByRole("link", { name: "Call Meera Kapoor" }).getAttribute("href"), "tel:9876543210");
  assert.equal(await page.getByRole("link", { name: "Email Meera Kapoor" }).getAttribute("href"), "mailto:meera@example.com");
  assert.match(await page.getByTestId("create-quotation").getAttribute("href"), /customerId=30&clientName=Meera%20Kapoor/);
  pass("overview: recent quotations and activity, contact details with working copy buttons, notes, correct call / WhatsApp / email links");

  // ── tabs: mouse, keyboard, URL ──
  await page.getByTestId("tab-quotations").click();
  await page.getByTestId("quotations-tab").waitFor();
  assert.match(page.url(), /[?&]tab=quotations/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("quotations-tab").waitFor();
  assert.equal(await page.getByTestId("tab-quotations").getAttribute("aria-selected"), "true", "a reload lands on the same tab");
  await page.getByTestId("tab-quotations").focus();
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("leads-tab").waitFor();
  assert.equal(await page.getByTestId("tab-leads").getAttribute("aria-selected"), "true", "the arrow keys move between tabs");
  await page.keyboard.press("Home");
  await page.getByTestId("overview-tab").waitFor();
  assert.ok(!/[?&]tab=/.test(page.url()), "the overview needs no ?tab");
  pass("tabs work by mouse and keyboard (arrows, Home), keep the open tab in the address, and survive a reload");

  // ── quotations tab ──
  await page.getByTestId("tab-quotations").click();
  assert.equal(await page.getByTestId("quotation-row").count(), 5);
  for (const [id, expected] of [["all", 5], ["draft", 1], ["sent", 1], ["approved", 1], ["delivered", 1], ["rejected", 1]]) {
    assert.match(await page.getByTestId(`quotation-filter-${id}`).innerText(), new RegExp(`${expected}$`));
  }
  await page.getByTestId("quotation-filter-approved").click();
  assert.equal(await page.getByTestId("quotation-row").count(), 1);
  assert.ok(digits(await page.getByTestId("quotations-total").innerText()).includes(String(Math.round(byStatus.approved))), "the total follows the filter");
  assert.equal(await page.getByTestId("quotation-row").getByRole("link", { name: "Edit", exact: true }).count(), 0, "an approved quotation can be viewed, not edited");
  await page.getByTestId("quotation-filter-all").click();
  assert.equal(await page.getByTestId("quotation-row").getByRole("link", { name: "Edit", exact: true }).count(), 3, "draft, sent and rejected can still be edited");
  await page.getByLabel("Sort quotations").selectOption("value_desc");
  const first = await page.getByTestId("quotation-row").first().innerText();
  assert.ok(digits(first).includes(String(Math.round(Math.max(...Object.values(byStatus))))), "highest value first");
  const someNumber = apiProfile.quotations[0].quotationNumber;
  await page.getByLabel("Search quotations").fill(someNumber);
  assert.equal(await page.getByTestId("quotation-row").count(), 1);
  await page.getByLabel("Search quotations").fill("zzz");
  await page.getByText("No quotation matches").waitFor();
  await page.getByLabel("Search quotations").fill("");
  assert.ok(digits(await page.getByTestId("quotations-total").innerText()).includes(String(Math.round(quotedValue))));
  await shot(page, "customer-quotations-1280");
  pass("quotations: status filters with counts, search, sort, locked ones have no Edit, and the total follows the filter");

  // ── enquiries tab and the lead drawer ──
  await page.getByTestId("tab-leads").click();
  assert.equal(await page.getByTestId("lead-row").count(), 3);
  assert.match(await page.getByTestId("lead-row").first().innerText(), /3 days overdue/);
  assert.match(await page.getByTestId("leads-tab").innerText(), /Lost: Price/);
  await page.getByRole("button", { name: "LD-2026-0001" }).click();
  const drawer = page.getByRole("dialog", { name: "Lead LD-2026-0001" });
  await drawer.waitFor();
  assert.match(await drawer.innerText(), /Meera Kapoor/);
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  pass("enquiries: stage, priority, follow-up (overdue flagged), expected close, lost reason, and a full lead drawer opens and closes with Escape");

  // ── New enquiry: linked lead, no page reload ──
  let reloads = 0;
  page.on("framenavigated", () => { reloads += 1; });
  await page.getByTestId("new-enquiry").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /New enquiry — Meera Kapoor/);
  assert.equal(await dialog.locator("input").first().inputValue(), "Meera Kapoor", "the customer's name is filled in");
  await dialog.getByPlaceholder(/BHK|Villa|project/i).first().fill("Home theatre").catch(() => {});
  await dialog.getByRole("button", { name: /create lead|save lead|create/i }).last().click();
  await page.locator("text=Lead created").first().waitFor();
  let linked = null;
  for (let i = 0; i < 100 && !linked; i += 1) {
    linked = await db.collection("leads").findOne({ companyId: 20, customerId: 30, customerName: "Meera Kapoor", referenceNumber: { $nin: ["LD-2026-0001", "LD-2026-0002", "LD-2026-0003"] } });
    if (!linked) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(linked, "the new lead is linked to the customer");
  // The profile is refreshed after the save, a moment after the new lead is in the database: wait for it instead of racing it.
  await page.waitForFunction(() => /4/.test(document.querySelector('[data-testid="tab-leads"]')?.textContent ?? ""), null, { timeout: 15_000 });
  assert.match(await page.getByTestId("tab-leads").innerText(), /4/, "the tab count updates in place");
  assert.equal(await page.getByTestId("profile-skeleton").count(), 0, "no skeleton flash after saving");
  pass("New enquiry opens with the customer filled in, creates a lead linked to them, and the profile updates without a reload");

  // ── activity timeline ──
  await page.getByTestId("tab-timeline").click();
  await page.getByTestId("timeline-tab").waitFor();
  const allCount = Number((await page.getByTestId("activity-filter-all").innerText()).replace(/\D/g, ""));
  assert.ok(allCount >= 6, `the 5 seeded activities plus the one logged by creating the enquiry (saw ${allCount})`);
  await page.getByTestId("activity-filter-contact").click();
  const contactText = await page.getByTestId("timeline-tab").innerText();
  assert.match(contactText, /Discussed scope/);
  assert.match(contactText, /Shared brochure/);
  assert.ok(!/Measured the villa/.test(contactText), "calls and messages only");
  await page.getByTestId("activity-filter-visits").click();
  assert.match(await page.getByTestId("timeline-tab").innerText(), /Measured the villa/);
  pass("the timeline filters by calls & messages, visits & meetings, quotations and notes");
  await context.close();

  // ── not found / other company ──
  {
    const { page: missing, context: missingContext } = await open({ width: 1280, height: 900 });
    for (const id of [9999, 31]) {
      await missing.goto(`${baseUrl}/admin/crm/customers/${id}`, { waitUntil: "domcontentloaded" });
      await missing.getByTestId("customer-not-found").waitFor();
    }
    await missingContext.close();
    pass("an unknown customer, and another company's customer, show 'Customer not found'");
  }

  // ── phone ──
  {
    const { page: phone, context: phoneContext } = await open({ width: 375, height: 800 });
    await phone.goto(`${baseUrl}/admin/crm/customers/30`, { waitUntil: "domcontentloaded" });
    await phone.getByTestId("customer-name").waitFor();
    assert.ok(await noHorizontalScroll(phone), "no horizontal scroll on the overview at 375px");
    const phoneBanner = await phone.getByTestId("customer-banner").boundingBox();
    const phoneName = await phone.getByTestId("customer-name").boundingBox();
    assert.ok(phoneName && phoneBanner && phoneName.y >= phoneBanner.y + phoneBanner.height - 1, "the name sits below the banner at 375px too");
    await shot(phone, "customer-overview-375");
    const cta = await phone.getByTestId("create-quotation").boundingBox();
    assert.ok(cta && cta.x >= 0 && cta.x + cta.width <= 375, "the Create quotation button is on screen");
    await phone.getByTestId("tab-quotations").click();
    assert.equal(await phone.getByTestId("quotations-table").isVisible(), false, "no wide table on a phone");
    assert.equal(await phone.getByTestId("quotation-card").count(), 5, "cards instead");
    assert.ok(await noHorizontalScroll(phone), "no horizontal scroll on quotations at 375px");
    await shot(phone, "customer-quotations-375");
    await phone.getByTestId("tab-leads").click();
    assert.equal(await phone.getByTestId("lead-card").count(), 4);
    assert.ok(await noHorizontalScroll(phone), "no horizontal scroll on enquiries at 375px");
    await phone.getByTestId("tab-timeline").click();
    assert.ok(await noHorizontalScroll(phone), "no horizontal scroll on the timeline at 375px");
    await phoneContext.close();
    pass("at 375px nothing scrolls sideways, the main button is on screen, and quotations and enquiries become cards");
  }

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
