/**
 * Automatic lead assignment + in-app notifications through the real app (real Chromium, isolated production server,
 * throwaway MongoDB): the rules and notification APIs refuse other companies, other roles and signed-out callers; a lead
 * created over the API is assigned by the saved rule and only its new owner is notified; notification paging rejects bad
 * values; the rules page saves a rule from the keyboard; the bell lists, marks read and opens the lead; both fit 1280px
 * and 375px with no horizontal page scroll.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/lead-assignment.browser.mjs
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
  server = await startIsolatedServer("lead-assign", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 20 },
    { _id: 2, email: "sales2@example.com", role: "sales_executive", name: "Sana Sales", companyId: 20 },
    { _id: 3, email: "sales3@example.com", role: "sales_executive", name: "Tarun Sales", companyId: 20 },
    { _id: 4, email: "off@example.com", role: "sales_executive", name: "Gone Sales", companyId: 20, isActive: false },
    { _id: 5, email: "dealer@example.com", role: "dealer", name: "A Dealer", companyId: 20 },
    { _id: 6, email: "owner-b@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
    { _id: 7, email: "sales7@example.com", role: "sales_executive", name: "Other Co Sales", companyId: 30 },
    { _id: 8, email: "adi@example.com", role: "admin", name: "Adi Admin", companyId: 20 },
    { _id: 9, email: "bela@example.com", role: "admin", name: "Bela Admin", companyId: 20 },
    { _id: 10, email: "limited@example.com", role: "configurable_admin", name: "Limited Admin", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[20, "Acme Homes"], [30, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("leadsources").insertMany([
    { _id: "src_web", companyId: 20, name: "Website", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: "src_ref", companyId: 20, name: "Referral", isActive: true, sortOrder: 2, createdAt: now, updatedAt: now },
    { _id: "src_other", companyId: 30, name: "Other Co Source", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);

  const cookie = {
    owner: await login("owner@example.com", "admin"),
    adi: await login("adi@example.com", "admin"),
    bela: await login("bela@example.com", "admin"),
    limited: await login("limited@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    ownerB: await login("owner-b@example.com", "admin"),
  };

  // ── rules API: who may read / change ──
  const rules = await api(cookie.owner, "GET", "/api/crm/assignment-rules");
  assert.equal(rules.status, 200, rules.text?.slice(0, 200));
  assert.deepEqual(rules.data.salesRepresentatives.map((rep) => rep.id).sort(), [2, 3], "only active sales people of this company can be in the pool");
  assert.deepEqual(rules.data.leadSources.map((source) => source.id).sort(), ["src_ref", "src_web"], "only this company's lead sources");
  assert.equal((await api("", "GET", "/api/crm/assignment-rules")).status, 401, "signed out");
  assert.equal((await api(cookie.dealer, "GET", "/api/crm/assignment-rules")).status, 403, "a dealer cannot read the rules");
  const body = { mode: "round_robin", enabled: true, eligibleSalesIds: [2, 3], fallbackSalesId: null, sourceMappings: [] };
  assert.equal((await api(cookie.dealer, "PUT", "/api/crm/assignment-rules", body)).status, 403, "a dealer cannot change the rules");
  assert.equal((await api(cookie.limited, "PUT", "/api/crm/assignment-rules", body)).status, 403, "an admin without CRM rights cannot change the rules");
  for (const bad of [
    { ...body, eligibleSalesIds: [7] },
    { ...body, eligibleSalesIds: [4] },
    { ...body, fallbackSalesId: 7 },
    { ...body, sourceMappings: [{ sourceId: "src_other", salesId: 2 }] },
    { ...body, sourceMappings: [{ sourceId: "src_web", salesId: 7 }] },
  ]) {
    const refused = await api(cookie.owner, "PUT", "/api/crm/assignment-rules", bad);
    assert.ok(refused.status >= 400 && refused.status < 500, `another company's or inactive people/sources are refused (${JSON.stringify(bad)} -> ${refused.status})`);
  }
  assert.equal((await db.collection("leadassignmentrules").countDocuments({ companyId: 20 })), 0, "refused saves store nothing");
  const saved = await api(cookie.owner, "PUT", "/api/crm/assignment-rules", { ...body, sourceMappings: [{ sourceId: "src_ref", salesId: 3 }] });
  assert.equal(saved.status, 200, saved.text?.slice(0, 300));
  assert.equal((await api(cookie.ownerB, "GET", "/api/crm/assignment-rules")).data.rule.enabled === true, false, "company B does not see company A's rule");
  pass("rules API: signed-out 401, dealer / admin without CRM rights cannot change, other-company or inactive people and sources refused and nothing stored, owner saves");

  // ── lead creation uses the rule; only the new owner is notified ──
  const ownerOf = async (response) => (await db.collection("leads").findOne({ _id: response.data.id }))?.assignedSalesId ?? null;
  const lead = (name, extra = {}) => api(cookie.owner, "POST", "/api/crm/leads", { customerName: name, phone: "9000000001", ...extra });
  const a = await lead("Lead One");
  const b = await lead("Lead Two");
  const c = await lead("Lead Three");
  assert.equal(a.status, 201, a.text?.slice(0, 300));
  const owners = [await ownerOf(a), await ownerOf(b), await ownerOf(c)];
  assert.ok(owners.every((id) => id === 2 || id === 3), `round robin gives only pool members (${owners})`);
  assert.notEqual(owners[0], owners[1], "round robin alternates");
  const mapped = await lead("From Referral", { sourceId: "src_ref" });
  assert.equal(await ownerOf(mapped), 3, "a source mapping wins over the rotation");
  const explicit = await lead("Explicit Owner", { assignedSalesId: 2 });
  assert.equal(await ownerOf(explicit), 2, "an owner chosen by the user always wins");
  const notified = async (userId) => db.collection("notifications").find({ companyId: 20, userId }).toArray();
  const owned = [owners[0], owners[1], owners[2], 2];
  for (const userId of [2, 3]) {
    const mine = await notified(userId);
    assert.ok(mine.every((n) => n.type === "lead_assigned"));
    const expected = userId === 2 ? owned.filter((id) => id === 2).length : owned.filter((id) => id === 3).length + 1; // + the Referral lead
    assert.equal(mine.length, expected, `user ${userId} is notified exactly once per lead they own`);
  }
  assert.equal((await notified(1)).length, 0, "the person who created the leads is not notified for others' leads");
  assert.equal((await notified(7)).length, 0, "another company's people get nothing");
  pass("leads created over the API follow the rule (rotation, source mapping, explicit owner) and only each new owner is notified");

  // ── notifications: ownership, paging, read state (admins own these leads: sales people cannot sign in) ──
  let seeded = 0;
  const seedNotification = async (userId, title, companyId = 20) => {
    seeded += 1;
    await db.collection("notifications").insertOne({
      _id: `n_seed_${seeded}`, companyId, userId, type: "lead_assigned", title, body: `${title} was assigned to you.`, link: "/admin/crm/pipeline",
      readAt: null, dedupeKey: `seed:${seeded}`, createdAt: new Date(Date.now() - seeded * 1000), updatedAt: new Date(),
    });
  };
  await seedNotification(8, "For Adi 1");
  await seedNotification(8, "For Adi 2");
  await seedNotification(9, "For Bela");
  const adi = await api(cookie.adi, "GET", "/api/notifications");
  assert.equal(adi.status, 200);
  assert.equal(adi.data.items.length, 2, "Adi sees only the two leads assigned to Adi");
  assert.equal(adi.data.unreadCount, 2);
  assert.equal((await api(cookie.ownerB, "GET", "/api/notifications")).data.items.length, 0, "another company sees nothing");
  assert.equal((await api("", "GET", "/api/notifications")).status, 401);
  for (const query of ["limit=abc", "limit=0", "limit=999", "skip=-1"]) {
    const refused = await api(cookie.adi, "GET", `/api/notifications?${query}`);
    assert.equal(refused.status, 400, `?${query} is a clear 400, not a crash (${refused.status})`);
  }
  assert.equal((await api(cookie.adi, "GET", "/api/notifications?limit=1")).data.items.length, 1);
  const theirs = adi.data.items[0];
  assert.equal((await api(cookie.bela, "PATCH", `/api/notifications/${theirs.id}/read`, {})).status, 404, "cannot mark someone else's notification");
  assert.equal((await api(cookie.ownerB, "PATCH", `/api/notifications/${theirs.id}/read`, {})).status, 404, "nor another company's");
  assert.equal((await api(cookie.adi, "PATCH", `/api/notifications/${theirs.id}/read`, {})).status, 200);
  assert.equal((await api(cookie.adi, "GET", "/api/notifications")).data.unreadCount, 1);
  assert.equal((await api(cookie.adi, "POST", "/api/notifications/mark-all-read", {})).status, 200);
  assert.equal((await api(cookie.adi, "GET", "/api/notifications")).data.unreadCount, 0);
  assert.equal((await api(cookie.bela, "GET", "/api/notifications")).data.unreadCount, 1, "marking mine read leaves other people's unread");
  pass("notifications API: bad paging is a 400, nobody can mark another person's or company's, read and read-all change only the caller's");

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

  // rules page at 1280px, driven from the keyboard
  const desk = await open(cookie.owner, { width: 1280, height: 900 });
  const problems = [];
  desk.page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  desk.page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`); });
  await desk.page.goto(`${baseUrl}/admin/crm/assignment`, { waitUntil: "domcontentloaded" });
  await desk.page.getByRole("heading", { level: 1, name: "Automatic Lead Assignment" }).waitFor({ timeout: 20000 }).catch(async (error) => {
    const tail = (await desk.page.locator("body").innerText()).slice(-700).split(String.fromCharCode(10)).join(" | ");
    throw new Error(`rules page did not render at ${desk.page.url()}: ${tail} [${problems.join(" | ")}] :: ${error.message}`);
  });
  const least = desk.page.getByTestId("mode-least_open_leads");
  await least.focus();
  await desk.page.keyboard.press("Enter");
  assert.equal(await least.getAttribute("aria-checked"), "true", "a strategy card can be chosen from the keyboard");
  assert.equal(await desk.page.getByTestId("mode-round_robin").getAttribute("aria-checked"), "false");
  const rep3 = desk.page.getByTestId("rep-3");
  assert.equal(await rep3.getAttribute("aria-checked"), "true", "the saved pool is shown");
  await rep3.focus();
  await desk.page.keyboard.press("Space");
  assert.equal(await rep3.getAttribute("aria-checked"), "false", "a person can be toggled from the keyboard");
  assert.equal(await desk.page.getByTestId("rep-4").count(), 0, "an inactive person is not offered");
  assert.ok(await noHorizontalScroll(desk.page), "rules page: no horizontal scroll at 1280px");
  // the fallback owner and a source rule use the themed dropdown
  assert.equal(await desk.page.locator("main select").count(), 0, "no browser-styled dropdown on the rules page");
  await desk.page.getByRole("button", { name: "Fallback lead owner" }).click();
  await desk.page.getByRole("option", { name: /^Tarun Sales/ }).click();
  await desk.page.getByRole("button", { name: "Add Source Rule" }).click();
  await desk.page.getByRole("button", { name: "Route directly to" }).last().click();
  await desk.page.getByRole("option", { name: "Tarun Sales", exact: true }).click();
  await shot(desk.page, "assignment-1280");
  await desk.page.getByRole("button", { name: "Save Rules" }).first().click();
  await desk.page.waitForFunction(async () => (await (await fetch("/api/crm/assignment-rules")).json()).data.rule.mode === "least_open_leads");
  const stored = (await api(cookie.owner, "GET", "/api/crm/assignment-rules")).data.rule;
  assert.deepEqual([stored.mode, stored.eligibleSalesIds], ["least_open_leads", [2]], "the keyboard changes were saved");
  assert.equal(stored.fallbackSalesId, 3, "the fallback chosen in the dropdown is saved");
  assert.equal(stored.sourceMappings.at(-1).salesId, 3, "the source rule's person is saved as a number");
  await desk.context.close();
  pass("rules page at 1280px: strategy and pool are chosen from the keyboard, inactive people are not offered, Save stores the rule");

  // an admin without CRM manage rights reaches the page read-only
  const roPage = await open(cookie.limited, { width: 1280, height: 900 });
  const roResponse = await roPage.page.goto(`${baseUrl}/admin/crm/assignment`, { waitUntil: "domcontentloaded" });
  assert.ok(roResponse && roResponse.status() < 500);
  assert.equal(await roPage.page.getByRole("button", { name: "Save Rules" }).count(), 0, "no Save button without crm:manage");
  await roPage.context.close();
  pass("an admin without CRM manage rights never gets a Save button on the rules page");

  // bell at 1280px
  const bellDesk = await open(cookie.adi, { width: 1280, height: 900 });
  await db.collection("notifications").deleteMany({ companyId: 20, userId: 8 });
  await seedNotification(8, "Bell Lead");
  await api(cookie.owner, "PUT", "/api/crm/assignment-rules", { mode: "manual", enabled: false, eligibleSalesIds: [], fallbackSalesId: null, sourceMappings: [] });
  await bellDesk.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  const bell = bellDesk.page.getByRole("button", { name: "View notifications" });
  await bell.waitFor();
  await bellDesk.page.waitForFunction(() => /^\d/.test(document.querySelector('[aria-label="View notifications"]')?.textContent ?? ""));
  assert.equal((await bell.innerText()).trim(), "1", "the badge shows one unread");
  await bell.click();
  await bellDesk.page.getByText("Bell Lead").first().waitFor();
  await shot(bellDesk.page, "bell-1280");
  await bellDesk.page.getByText("Bell Lead").first().click();
  await bellDesk.page.waitForURL(/\/admin\/crm/);
  await bellDesk.page.waitForFunction(() => !/^\d/.test(document.querySelector('[aria-label="View notifications"]')?.textContent ?? ""));
  assert.equal((await api(cookie.adi, "GET", "/api/notifications")).data.unreadCount, 0, "opening the notification marks it read on the server");
  await bellDesk.context.close();
  pass("the bell shows the unread badge, lists the new lead, and opening it marks it read and goes to the lead");

  // phone: bell panel and rules page
  await seedNotification(8, "Phone Lead");
  const phone = await open(cookie.adi, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  const phoneBell = phone.page.getByRole("button", { name: "View notifications" });
  await phoneBell.waitFor();
  await phoneBell.click();
  await phone.page.getByText("Phone Lead").first().waitFor();
  const panel = await phone.page.getByText("Phone Lead").first().evaluate((el) => {
    let node = el;
    while (node && node.parentElement) { const r = node.getBoundingClientRect(); if (r.width > 250) return { left: r.left, right: r.right }; node = node.parentElement; }
    return null;
  });
  assert.ok(panel && panel.left >= 0 && panel.right <= 375, `the notification panel fits the phone screen (${JSON.stringify(panel)})`);
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px with the panel open");
  await shot(phone.page, "bell-375");
  await phone.context.close();
  const phoneOwner = await open(cookie.owner, { width: 375, height: 800 });
  await phoneOwner.page.goto(`${baseUrl}/admin/crm/assignment`, { waitUntil: "domcontentloaded" });
  await phoneOwner.page.getByRole("heading", { level: 1, name: "Automatic Lead Assignment" }).waitFor();
  assert.ok(await noHorizontalScroll(phoneOwner.page), "rules page: no horizontal scroll at 375px");
  const saveBox = await phoneOwner.page.getByRole("button", { name: "Save Assignment Rules" }).boundingBox();
  assert.ok(saveBox && saveBox.x >= 0 && saveBox.x + saveBox.width <= 375, "the sticky Save bar fits the phone screen");
  await shot(phoneOwner.page, "assignment-375");
  await phoneOwner.context.close();
  pass("at 375px the notification panel and the rules page fit with no sideways scroll, and the sticky Save bar is on screen");

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
