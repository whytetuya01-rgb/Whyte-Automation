/**
 * A Sales Executive can sign in at /login and sees only their own work (real Chromium, isolated production server,
 * throwaway MongoDB): GET /api/my/leads returns only the leads assigned to them in their own company; every CRM, admin
 * and assignment-rule API stays closed to them; admin pages bounce them to the workspace; the admin portal still refuses
 * them; the workspace shows My Leads and a bell whose lead notification opens My Leads; it fits 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/sales-executive-access.browser.mjs
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
  server = await startIsolatedServer("sales-exec", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 10 },
    { _id: 2, email: "sana@example.com", role: "sales_executive", name: "Sana Sales", companyId: 10 },
    { _id: 3, email: "tarun@example.com", role: "sales_executive", name: "Tarun Sales", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "A Dealer", companyId: 10, discountAllocationPercent: 10 },
    { _id: 5, email: "off@example.com", role: "sales_executive", name: "Gone Sales", companyId: 10, isActive: false },
    { _id: 6, email: "sales-b@example.com", role: "sales_executive", name: "Other Co Sales", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const lead = (id, name, extra = {}) => ({
    _id: id, companyId: 10, referenceNumber: `LD-${id}`, customerName: name, phone: "9000000000", projectType: "3 BHK Villa", estimatedBudget: 250000,
    status: "new", priority: "medium", notes: "INTERNAL NOTE", createdBy: 1, createdAt: now, updatedAt: now, ...extra,
  });
  await db.collection("leads").insertMany([
    lead("la", "Asha Patel", { assignedSalesId: 2, nextFollowUpAt: new Date(Date.now() - 3 * 86_400_000) }),
    lead("lb", "Brightway Builders", { assignedSalesId: 2, status: "quoted" }),
    lead("lc", "Someone Elses Lead", { assignedSalesId: 3 }),
    lead("ld", "Unassigned Lead"),
    lead("le", "Other Company Lead", { companyId: 20, assignedSalesId: 2 }),
  ]);
  await db.collection("notifications").insertOne({
    _id: "n1", companyId: 10, userId: 2, type: "lead_assigned", title: "New Lead Assigned", body: "Lead LD-la (Asha Patel) has been assigned to you.",
    link: "/admin/crm/pipeline?lead=la", readAt: null, dedupeKey: "lead_assigned:la:2", createdAt: now, updatedAt: now,
  });

  const cookie = {
    sana: await login("sana@example.com", "user"),
    owner: await login("owner@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    sanaViaAdminPortal: await login("sana@example.com", "admin"),
    off: await login("off@example.com", "user"),
  };

  // ── sign-in rules ──
  assert.ok(cookie.sana.includes("session-token"), "a Sales Executive signs in at the workspace portal");
  assert.equal(cookie.sanaViaAdminPortal.includes("session-token"), false, "the admin portal still refuses a Sales Executive");
  assert.equal(cookie.off.includes("session-token"), false, "a deactivated Sales Executive cannot sign in");
  pass("a Sales Executive signs in at /login; the admin portal still refuses them; a deactivated one cannot sign in");

  // ── My Leads API ──
  const mine = await api(cookie.sana, "GET", "/api/my/leads");
  assert.equal(mine.status, 200, mine.text?.slice(0, 200));
  assert.deepEqual(mine.data.items.map((item) => item.id).sort(), ["la", "lb"], "only the leads assigned to me, in my company");
  assert.ok(!JSON.stringify(mine.data).match(/INTERNAL NOTE|createdBy|companyId/), "no internal notes or ids of other records");
  assert.equal((await api(cookie.sana, "GET", "/api/my/leads?limit=abc")).status, 400);
  assert.equal((await api(cookie.sana, "GET", "/api/my/leads?assignedSalesId=3")).data.items.length, 2, "a client-supplied owner is ignored");
  assert.equal((await api(cookie.dealer, "GET", "/api/my/leads")).status, 403, "a dealer has no My Leads");
  assert.equal((await api(cookie.owner, "GET", "/api/my/leads")).status, 403, "nor does the owner (they have the CRM)");
  assert.equal((await api("", "GET", "/api/my/leads")).status, 401);
  pass("GET /api/my/leads returns exactly my own company's leads assigned to me, nothing internal; other roles and signed-out callers are refused");

  // ── what stays closed ──
  const closed = [
    ["GET", "/api/crm/leads"],
    ["GET", "/api/crm/customers"],
    ["GET", "/api/crm/pipeline"],
    ["GET", "/api/crm/assignment-rules"],
    ["PUT", "/api/crm/assignment-rules", { mode: "manual", enabled: false, eligibleSalesIds: [] }],
    ["PATCH", "/api/admin/dealers/4", { isActive: false }],
    ["GET", "/api/admin/dealers"],
    ["GET", "/api/admin/users"],
  ];
  for (const [method, path, body] of closed) {
    const response = await api(cookie.sana, method, path, body);
    assert.ok(response.status === 403 || response.status === 401, `${method} ${path} must stay closed to a Sales Executive (got ${response.status})`);
  }
  assert.equal((await db.collection("adminusers").findOne({ _id: 4 })).isActive !== false, true, "the dealer was not touched");
  assert.equal(await db.collection("leadassignmentrules").countDocuments({}), 0, "no rule was stored");
  pass("the CRM, assignment-rule, dealer and user APIs stay closed to a Sales Executive");

  // ── UI ──
  browser = await chromium.launch({ headless: true });
  const open = async (who, viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(who.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };

  const desk = await open(cookie.sana, { width: 1280, height: 900 });
  await desk.page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await desk.page.waitForURL((url) => !url.pathname.startsWith("/admin"));
  assert.equal(new URL(desk.page.url()).pathname, "/", "an admin page sends a Sales Executive back to the workspace");
  await desk.page.getByRole("link", { name: "My Leads" }).first().click();
  await desk.page.waitForURL(/\/my-leads/);
  const cards = desk.page.getByTestId("my-lead");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 2);
  const text = await desk.page.getByTestId("my-leads").innerText();
  assert.match(text, /Asha Patel/);
  assert.match(text, /Brightway Builders/);
  assert.doesNotMatch(text, /Someone Elses Lead|Unassigned Lead|Other Company Lead|INTERNAL NOTE/);
  assert.match(text, /overdue/i, "an overdue follow-up is called out");
  assert.ok(await noHorizontalScroll(desk.page));
  await shot(desk.page, "my-leads-1280");
  const bell = desk.page.getByRole("button", { name: "View notifications" });
  await bell.waitFor();
  await desk.page.waitForFunction(() => /^\d/.test(document.querySelector('[aria-label="View notifications"]')?.textContent ?? ""));
  await bell.click();
  await desk.page.getByText("Lead LD-la (Asha Patel) has been assigned to you.").waitFor();
  await desk.page.getByText("New Lead Assigned").first().click();
  await desk.page.waitForURL(/\/my-leads/);
  assert.equal(new URL(desk.page.url()).pathname, "/my-leads", "a lead notification opens My Leads, not a CRM page they cannot use");
  let unread = 1;
  for (let attempt = 0; attempt < 20 && unread !== 0; attempt += 1) {
    unread = (await api(cookie.sana, "GET", "/api/notifications")).data.unreadCount;
    if (unread !== 0) await new Promise((wait) => setTimeout(wait, 250));
  }
  assert.equal(unread, 0, "opening it marked it read");
  await desk.context.close();
  pass("at 1280px: admin pages bounce to the workspace, My Leads shows only my two leads (overdue follow-up flagged, nothing internal), the bell's lead notification opens My Leads and is marked read");

  const phone = await open(cookie.sana, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/my-leads`, { waitUntil: "domcontentloaded" });
  await phone.page.getByRole("link", { name: "My Leads" }).first().waitFor();
  assert.ok(await phone.page.getByRole("link", { name: "My Leads" }).first().isVisible(), "the phone navigation has My Leads");
  await phone.page.getByTestId("my-lead").first().waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px");
  const box = await phone.page.getByTestId("my-lead").first().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375, "a lead card fits the phone screen");
  await shot(phone.page, "my-leads-375");
  await phone.context.close();
  pass("at 375px My Leads fits with no sideways scroll");

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
