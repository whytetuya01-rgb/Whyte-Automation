/**
 * The company dashboard and the My account reminder switch in a real browser (isolated production server, throwaway MongoDB):
 *   - the Company Owner sees every section; with nothing won yet the sales cycle shows "—", not an invented number;
 *   - a custom role with only leads:read sees the CRM parts and nothing about quotations, revenue or dealers, and those
 *     figures are not even in the page sent to the browser; a link to a hidden tab opens the overview;
 *   - My account turns the morning follow-up email off and on, and it stays as set after a reload;
 *   - no horizontal scroll at 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/dashboard-access.browser.mjs
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
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

try {
  server = await startIsolatedServer("dash-access", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "crm@example.com", role: "configurable_admin", name: "Cara CRM", permissions: ["leads:read"], companyId: 20 },
    { _id: 3, email: "dealer@example.com", role: "dealer", name: "Dino Dealer", discountAllocationPercent: 5, companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("quotations").insertOne({ _id: "q_secret", companyId: 20, quotationNumber: "QT-SECRET-1", clientName: "Secret Client Kapoor", status: "approved", dealerId: 3, assignedSalesId: null, createdBy: 1, discountType: null, discountValue: null, customerDiscountPercent: 0, allocatedDiscountPercent: 0, isDeleted: false, createdAt: new Date(now.getTime() - 86_400_000), updatedAt: now });
  await db.collection("leads").insertMany([
    { _id: "ld_open", companyId: 20, referenceNumber: "LD-2026-0001", customerName: "Open Lead", status: "negotiation", priority: "medium", sourceName: "Website", estimatedBudget: 450000, tags: [], isDeleted: false, createdBy: 1, createdAt: now, updatedAt: now },
    { _id: "ld_new", companyId: 20, referenceNumber: "LD-2026-0002", customerName: "New Lead", status: "new", priority: "medium", sourceName: "Referral", estimatedBudget: null, tags: [], isDeleted: false, createdBy: 1, createdAt: now, updatedAt: now },
  ]);
  const cookies = { owner: await login("owner@example.com", "admin"), crm: await login("crm@example.com", "admin") };
  browser = await chromium.launch({ headless: true });

  const open = async (who, viewport, path) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookies[who].split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(`${baseUrl}${path}`, { waitUntil: "load" });
    return { context, page };
  };
  const tabs = (page) => page.locator('[role="tab"]').allInnerTexts().then((names) => names.map((name) => name.split("\n")[0].trim()));
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;

    // ═══ the Company Owner ═══
    const { context, page } = await open("owner", viewport, "/admin/dashboard?tab=crm");
    await page.locator('[data-testid="dashboard-tabs"]').waitFor();
    assert.deepEqual(await tabs(page), ["Overview", "CRM & Pipeline", "Quotations & Sales", "Dealers & Partners", "Catalog & Inventory"], `every section at ${w}px`);
    const hero = await page.locator('[data-testid="hero-stats"]').innerText();
    for (const label of ["WON REVENUE", "ACTIVE PIPELINE", "QUOTATION VALUE", "LEAD-TO-WON"]) assert.ok(hero.toUpperCase().includes(label), `${label} in the hero at ${w}px`);
    const cycle = page.locator("text=Average sales cycle").locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    await page.getByText("Shown once a deal is won").waitFor();
    assert.match(await cycle.innerText(), /—/, `no invented sales cycle at ${w}px`);
    assert.ok(await noOverflow(page), `no horizontal scroll for the owner at ${w}px`);
    await context.close();

    // ═══ a custom role with leads:read only ═══
    const crm = await open("crm", viewport, "/admin/dashboard?tab=sales");
    await crm.page.locator('[data-testid="dashboard-tabs"]').waitFor();
    assert.deepEqual(await tabs(crm.page), ["Overview", "CRM & Pipeline", "Catalog & Inventory"], `only the sections the role covers at ${w}px`);
    assert.equal(await crm.page.locator('[role="tab"][aria-selected="true"]').innerText().then((t) => t.split("\n")[0].trim()), "Overview", "a link to a hidden tab opens the overview");
    const crmHero = (await crm.page.locator('[data-testid="hero-stats"]').innerText()).toUpperCase();
    assert.ok(crmHero.includes("ACTIVE PIPELINE") && !crmHero.includes("WON REVENUE") && !crmHero.includes("QUOTATION VALUE"), `no money figures in the hero at ${w}px`);
    const html = await crm.page.content();
    for (const secret of ["Secret Client Kapoor", "QT-SECRET-1", "Dino Dealer"]) assert.ok(!html.includes(secret), `"${secret}" is not in the page sent to the browser`);
    await crm.page.getByRole("tab", { name: /CRM & Pipeline/ }).click();
    await crm.page.getByText("Inbound leads").waitFor();
    assert.ok(await noOverflow(crm.page), `no horizontal scroll for the CRM role at ${w}px`);
    await crm.context.close();
  }
  pass("the owner sees every section (and \"—\" for a sales cycle with nothing won); a leads-only role sees the CRM parts only, the hidden figures are not in the page, and a hidden tab's link opens the overview; at 1280px and 375px");

  // ═══ My account: the morning email ═══
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const { context, page } = await open("owner", viewport, "/admin/account");
    const toggle = page.locator('[data-testid="reminder-email-toggle"]');
    await toggle.waitFor();
    const wasOn = (await toggle.getAttribute("aria-checked")) === "true";
    await toggle.click();
    await page.waitForFunction((expected) => document.querySelector('[data-testid="reminder-email-toggle"]')?.getAttribute("aria-checked") === expected, String(!wasOn));
    const stored = (await db.collection("adminusers").findOne({ _id: 1 })).followUpReminderEmails;
    assert.equal(stored, wasOn ? false : undefined, `stored at ${w}px`);
    await page.reload({ waitUntil: "load" });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-checked"), String(!wasOn), `still as set after a reload at ${w}px`);
    assert.ok(await noOverflow(page), `no horizontal scroll on My account at ${w}px`);
    await context.close();
  }
  pass("My account turns the morning follow-up email off and back on; it is stored and stays after a reload; at 1280px and 375px");

  console.log(`\nALL ${count} DASHBOARD ACCESS BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-2500));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
