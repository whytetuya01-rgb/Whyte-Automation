/**
 * Browser check of the Follow-ups screen (real Chromium against an isolated production server): the tabs and their
 * counts, 10 per page, "Add to Google Calendar" links, marking done and rescheduling from the dialog, setting the date
 * from the lead form, and the personal Google Calendar link (create, copy, it really serves a calendar, replace, turn
 * off), on a laptop and a phone.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/follow-ups.browser.mjs
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
const DAY = 24 * 3600 * 1000;
const istDay = (days, hour = 10) => {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${key}T${String(hour).padStart(2, "0")}:00:00+05:30`);
};

try {
  process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
  server = await startIsolatedServer("followups-ui", [{ _id: 1, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 }], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "acme", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = await login("admin@example.com", "admin");

  let ref = 0;
  const lead = (id, name, due, extra = {}) => ({ _id: id, companyId: 10, referenceNumber: `LD-2026-${String(++ref).padStart(4, "0")}`, customerName: name, phone: "9876500001", projectType: "3 BHK Villa", location: "Satellite, Ahmedabad", status: "contacted", priority: "medium", createdBy: 1, createdAt: new Date(now - 60 * DAY), updatedAt: now, nextFollowUpAt: due, ...extra });
  await db.collection("leads").insertMany([
    lead("l_over_1", "Asha Overdue", istDay(-4), { priority: "urgent" }),
    lead("l_over_2", "Brightway Overdue", istDay(-2)),
    lead("l_over_3", "Chirag Overdue", istDay(-1, 18)),
    lead("l_today", "Dev Today", istDay(0, 10)),
    ...Array.from({ length: 14 }, (_, i) => lead(`l_up_${i}`, `Upcoming ${String(i).padStart(2, "0")}`, istDay(3 + i))),
  ]);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${baseUrl}/admin/crm/follow-ups`, { waitUntil: "domcontentloaded" });
  const rows = page.locator('[data-testid="followup-row"]');
  await rows.first().waitFor();

  // ── tabs, counts, 10 per page ──
  const counts = async () => Object.fromEntries(await Promise.all(["all", "overdue", "today", "upcoming"].map(async (id) => [id, Number(await page.getByTestId(`followup-count-${id}`).innerText())])));
  assert.deepEqual(await counts(), { all: 18, overdue: 3, today: 1, upcoming: 14 });
  assert.equal(await rows.count(), 10, "10 per page by default");
  assert.equal((await page.getByRole("button", { name: "Rows per page" }).innerText()).trim(), "10", "and the Rows select shows 10");
  assert.equal(await rows.first().getAttribute("data-bucket"), "overdue", "the oldest overdue comes first");
  await page.getByRole("tab", { name: /^Overdue/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 3);
  assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-bucket"))), ["overdue", "overdue", "overdue"]);
  assert.match(await rows.first().innerText(), /Overdue 4 days/);
  await page.getByRole("tab", { name: /^Today/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 1);
  assert.match(await rows.first().innerText(), /Due today/);
  await page.getByRole("tab", { name: /^Upcoming/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 10);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 4);
  await page.getByRole("tab", { name: /^All/ }).click();
  await page.getByLabel("Search follow-ups").fill("brightway");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 1);
  assert.match(await rows.first().innerText(), /Brightway Overdue/);
  await page.getByLabel("Search follow-ups").fill("");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 10);
  pass("the tabs show their counts (3 overdue, 1 today, 14 upcoming), 10 rows per page, paging, and search");

  // ── Add to Google Calendar ──
  const link = new URL(await rows.first().getByTestId("add-to-google-calendar").getAttribute("href"));
  assert.equal(link.origin + link.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(link.searchParams.get("text"), "Follow up: Asha Overdue");
  assert.equal(link.searchParams.get("dates"), `${istDay(-4).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}/${new Date(istDay(-4).getTime() + 30 * 60 * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  assert.match(link.searchParams.get("details"), /LD-2026-0001/);
  assert.match(link.searchParams.get("details"), new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/admin/crm/follow-ups`), "the event links back to the app");
  assert.equal(await rows.first().getByTestId("add-to-google-calendar").getAttribute("target"), "_blank");
  assert.match(await rows.first().getByTestId("add-to-google-calendar").getAttribute("rel"), /noopener/);
  pass("Add to Google Calendar opens Google Calendar with the title, a 30-minute slot, the lead's details and a link back, in a new tab");

  // ── done ──
  await rows.first().getByRole("button", { name: "Done" }).click();
  const modal = page.getByTestId("followup-modal");
  await modal.waitFor();
  await modal.getByLabel("What happened? (optional)").fill("Called; the client will confirm after the site visit.");
  await modal.getByRole("button", { name: "In 3 days" }).click();
  await modal.getByRole("button", { name: "Mark done" }).click();
  await modal.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "2");
  const doneLead = await db.collection("leads").findOne({ _id: "l_over_1" });
  assert.ok(Math.abs(new Date(doneLead.nextFollowUpAt).getTime() - (Date.now() + 3 * DAY)) < DAY, "moved to about three days from now");
  assert.ok(doneLead.lastContactedAt);
  const entry = await db.collection("crmactivities").findOne({ leadId: "l_over_1", type: "follow_up" });
  assert.equal(entry.title, "Follow-up done");
  assert.match(entry.description, /Called; the client will confirm after the site visit\./);
  // No next follow-up
  await rows.first().getByRole("button", { name: "Done" }).click();
  await modal.waitFor();
  await modal.getByRole("button", { name: "No next follow-up" }).click();
  assert.equal(await modal.getByLabel("Next follow-up date and time").isDisabled(), true, "the date is off when there is no next follow-up");
  await modal.getByRole("button", { name: "Mark done" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "1");
  assert.equal((await db.collection("leads").findOne({ _id: "l_over_2" })).nextFollowUpAt, null);
  // Reschedule
  await rows.first().getByRole("button", { name: "Reschedule" }).click();
  await modal.waitFor();
  assert.equal(await modal.getByLabel("What happened? (optional)").count(), 0, "rescheduling has no 'what happened' box");
  assert.equal(await modal.getByRole("button", { name: "No next follow-up" }).count(), 0, "and always needs a date");
  await modal.getByRole("button", { name: "Next week" }).click();
  await modal.getByRole("button", { name: "Save new date" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "0");
  assert.equal((await db.collection("crmactivities").findOne({ leadId: "l_over_3", type: "follow_up" })).title, "Follow-up rescheduled");
  // A date in the past is refused with a clear message and nothing changes
  await rows.first().getByRole("button", { name: "Reschedule" }).click();
  await modal.waitFor();
  await modal.getByLabel("Next follow-up date and time").fill("2020-01-01T10:00");
  await modal.getByRole("button", { name: "Save new date" }).click();
  await modal.getByRole("alert").waitFor();
  assert.match(await modal.getByRole("alert").innerText(), /today or a later date/i);
  await modal.getByRole("button", { name: "Cancel" }).click();
  await modal.waitFor({ state: "detached" });
  pass("Done (with a note and the next date, or no next follow-up) and Reschedule update the list, the counts and the lead's timeline; a past date is refused with a clear message");

  // ── set the date from the lead form ──
  await page.goto(`${baseUrl}/admin/crm/leads`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New Lead/ }).click();
  await page.getByLabel("Customer / Client Name").fill("Form Follow-up Client");
  const dateInput = page.getByLabel("Next Follow-up");
  await dateInput.waitFor();
  assert.equal(await dateInput.getAttribute("type"), "datetime-local");
  const tomorrow = new Date(Date.now() + DAY);
  const pad = (n) => String(n).padStart(2, "0");
  await dateInput.fill(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T11:30`);
  await page.getByRole("button", { name: "Create Lead" }).click();
  await page.getByText("Form Follow-up Client").first().waitFor();
  const formLead = await db.collection("leads").findOne({ customerName: "Form Follow-up Client" });
  assert.ok(formLead.nextFollowUpAt, "the follow-up date was saved from the form");
  await page.goto(`${baseUrl}/admin/crm/follow-ups`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Search follow-ups").fill("Form Follow-up");
  await rows.first().waitFor();
  assert.match(await rows.first().innerText(), /Form Follow-up Client/);
  assert.match(await rows.first().innerText(), /Tomorrow/);
  pass("a follow-up date set in the lead form shows up on the Follow-ups screen as Tomorrow");

  // ── the personal Google Calendar link ──
  await page.getByLabel("Search follow-ups").fill("");
  const card = page.getByTestId("calendar-sync");
  await card.waitFor();
  await card.getByRole("button", { name: "Create my calendar link" }).click();
  const urlInput = card.getByTestId("calendar-feed-url");
  await urlInput.waitFor();
  const url = await urlInput.inputValue();
  assert.match(url, /\/api\/calendar\/follow-ups\/[A-Za-z0-9_-]{43}\.ics$/);
  assert.match(await card.innerText(), /not reachable from the internet over https/, "on a local address the person is told Google cannot read it yet");
  assert.match(await card.innerText(), /From URL/);
  await card.getByRole("button", { name: "Copy link" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url, "Copy link copies exactly the link");
  const served = await context.request.get(url, { headers: { Cookie: "" } });
  assert.equal(served.status(), 200);
  assert.match(served.headers()["content-type"], /text\/calendar/);
  assert.match(await served.text(), /BEGIN:VCALENDAR[\s\S]*SUMMARY:Follow up: Form Follow-up Client/, "the link really serves the calendar with the new follow-up");
  // Replace: asks first, the old link dies
  await card.getByRole("button", { name: "Generate a new link" }).click();
  await page.getByRole("button", { name: "Generate new link" }).last().click();
  await page.waitForFunction((old) => document.querySelector('[data-testid="calendar-feed-url"]')?.value !== old, url);
  const url2 = await urlInput.inputValue();
  assert.notEqual(url2, url);
  assert.equal((await context.request.get(url, { headers: { Cookie: "" } })).status(), 404, "the old link no longer works");
  assert.equal((await context.request.get(url2, { headers: { Cookie: "" } })).status(), 200);
  // Turn off
  await card.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("button", { name: "Turn off" }).last().click();
  await card.getByRole("button", { name: "Create my calendar link" }).waitFor();
  assert.equal((await context.request.get(url2, { headers: { Cookie: "" } })).status(), 404, "a link that was turned off stops working");
  assert.deepEqual(failures, [], "no page errors");
  pass("the Google Calendar link: created, copied, it really serves the calendar, replacing it (with a confirmation) kills the old one, and turning it off stops it");

  // ── a phone ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  const mobile = await phone.newPage();
  mobile.setDefaultTimeout(45000);
  await mobile.goto(`${baseUrl}/admin/crm/follow-ups`, { waitUntil: "domcontentloaded" });
  await mobile.locator('[data-testid="followup-row"]').first().waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no sideways scrolling at 390px (${overflow}px)`);
  for (const name of ["Done", "Reschedule"]) {
    const box = await mobile.locator('[data-testid="followup-row"]').first().getByRole("button", { name }).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `${name} is on screen`);
  }
  await phone.close();
  pass("on a phone the screen fits and the actions are reachable");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-1500));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
