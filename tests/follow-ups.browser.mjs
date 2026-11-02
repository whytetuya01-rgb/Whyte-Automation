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
// "Later today" must stay today, and "earlier today" the same Indian day, while this test runs: if the Indian day is about
// to turn over (or has only just turned), wait for it.
const msSinceIstMidnight = () => Date.now() - istDay(0, 0).getTime();
const msUntilIstMidnight = () => DAY - msSinceIstMidnight();
if (msUntilIstMidnight() < 3 * 60_000 || msSinceIstMidnight() < 3 * 60_000) {
  const wait = (msUntilIstMidnight() < 3 * 60_000 ? msUntilIstMidnight() : 0) + 3 * 60_000 + 1000;
  console.log(`  (waiting ${Math.ceil(wait / 1000)}s: the Indian day is turning over)`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}
const laterToday = () => new Date(istDay(0, 0).getTime() + DAY - 1000);
const earlierToday = () => new Date(Date.now() - 2 * 60_000);

try {
  process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
  server = await startIsolatedServer("followups-ui", [
    { _id: 1, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 2, email: "manager@example.com", role: "configurable_admin", name: "Manager M", permissions: ["leads:manage"], companyId: 10 },
  ], { production: true });
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
    lead("l_earlier", "Esha Earlier Today", earlierToday()),
    lead("l_today", "Dev Today", laterToday()),
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
  assert.deepEqual(await counts(), { all: 19, overdue: 4, today: 1, upcoming: 14 });
  assert.equal(await rows.count(), 10, "10 per page by default");
  assert.equal((await page.getByRole("button", { name: "Rows per page" }).innerText()).trim(), "10", "and the Rows select shows 10");
  assert.equal(await rows.first().getAttribute("data-bucket"), "overdue", "the oldest overdue comes first");
  await page.getByRole("tab", { name: /^Overdue/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="followup-row"]').length === 4);
  assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-bucket"))), ["overdue", "overdue", "overdue", "overdue"], "a follow-up whose time earlier today has passed is overdue");
  assert.match(await rows.first().innerText(), /Overdue 4 days/);
  assert.match(await rows.last().getByTestId("followup-bucket").innerText(), /Overdue today/i, "and says so");
  assert.match(await rows.first().getByTestId("followup-owner").innerText(), /Owner: not set/i, "an old follow-up has no owner yet");
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
  pass("the tabs show their counts (4 overdue including one from earlier today, 1 today, 14 upcoming), 10 rows per page, paging, and search");

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
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "3");
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
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "2");
  assert.equal((await db.collection("leads").findOne({ _id: "l_over_2" })).nextFollowUpAt, null);
  // Reschedule
  await rows.first().getByRole("button", { name: "Reschedule" }).click();
  await modal.waitFor();
  assert.equal(await modal.getByLabel("What happened? (optional)").count(), 0, "rescheduling has no 'what happened' box");
  assert.equal(await modal.getByRole("button", { name: "No next follow-up" }).count(), 0, "and always needs a date");
  await modal.getByRole("button", { name: "Next week" }).click();
  await modal.getByRole("button", { name: "Save new date" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="followup-count-overdue"]')?.textContent?.trim() === "1");
  assert.equal((await db.collection("crmactivities").findOne({ leadId: "l_over_3", type: "follow_up" })).title, "Follow-up rescheduled");
  // A time that has passed is refused with a clear message and nothing changes (the first row is now the one from earlier today)
  assert.match(await rows.first().innerText(), /Esha Earlier Today/);
  await rows.first().getByRole("button", { name: "Reschedule" }).click();
  await modal.waitFor();
  await modal.getByLabel("Next follow-up date and time").fill("2020-01-01T10:00");
  await modal.getByRole("button", { name: "Save new date" }).click();
  await modal.getByRole("alert").waitFor();
  assert.match(await modal.getByRole("alert").innerText(), /not passed yet/i);
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "l_earlier" }), 0, "a refused change adopts nothing");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await modal.waitFor({ state: "detached" });
  pass("Done (with a note and the next date, or no next follow-up) and Reschedule update the list, the counts and the lead's timeline; a time that has passed is refused with a clear message");

  // ── owners ──
  // Search, then wait until the list shows exactly that one lead (not just "one row", which may still be the previous search).
  const searchFor = async (text, name) => {
    await page.getByLabel("Search follow-ups").fill(text);
    await page.waitForFunction((expected) => {
      const found = document.querySelectorAll('[data-testid="followup-row"]');
      return found.length === 1 && (found[0].textContent ?? "").includes(expected);
    }, name);
  };
  await searchFor("Asha Overdue", "Asha Overdue");
  assert.match(await rows.first().getByTestId("followup-owner").innerText(), /Owner: Admin A/, "completing an old follow-up gave it an owner (the person who completed it)");
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "l_over_1", status: "open" }), 1);
  // hand an old follow-up to a colleague while rescheduling it
  await searchFor("Esha Earlier", "Esha Earlier Today");
  assert.match(await rows.first().getByTestId("followup-owner").innerText(), /Owner: not set/);
  await rows.first().getByRole("button", { name: "Reschedule" }).click();
  await modal.waitFor();
  const ownerPicker = modal.getByRole("button", { name: "Owner", exact: true });
  await ownerPicker.waitFor();
  assert.match(await ownerPicker.innerText(), /Me \(default\)/, "an old follow-up starts on the person acting");
  await ownerPicker.click();
  assert.deepEqual((await page.getByRole("option").allInnerTexts()).map((text) => text.trim()).sort(), ["Admin A", "Manager M", "Me (default)"], "the people who can own a follow-up (no Dealers, Sales Executives or read-only roles)");
  await page.getByRole("option", { name: "Manager M" }).click();
  await modal.getByRole("button", { name: "Tomorrow" }).click();
  await modal.getByRole("button", { name: "Save new date" }).click();
  await modal.waitFor({ state: "detached" });
  await page.waitForFunction(() => /Owner: Manager M/.test(document.querySelector('[data-testid="followup-row"]')?.textContent ?? ""));
  const handedTask = await db.collection("followuptasks").findOne({ leadId: "l_earlier", status: "open" });
  assert.equal(handedTask.ownerId, 2, "the follow-up now belongs to Manager M");
  assert.equal((await db.collection("crmactivities").find({ leadId: "l_earlier", type: "follow_up" }).toArray()).filter((e) => e.title === "Follow-up owner changed").length, 0, "choosing the owner while adopting an old follow-up is not a hand-over");
  pass("each follow-up shows its owner; an old one says 'not set'; Done / Reschedule can hand a follow-up to a colleague (only people who can own one are offered)");

  // ── the stale-view guard ──
  await searchFor("Upcoming 00", "Upcoming 00");
  await rows.first().getByRole("button", { name: "Done" }).click();
  await modal.waitFor();
  await db.collection("leads").updateOne({ _id: "l_up_0" }, { $set: { nextFollowUpAt: istDay(30, 9) } }); // someone else moved it meanwhile
  await modal.getByRole("button", { name: "Mark done" }).click();
  await modal.waitFor({ state: "detached" });
  await page.getByText("This follow-up changed").first().waitFor();
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "l_up_0" }), 0, "nothing was written");
  assert.equal((await db.collection("crmactivities").countDocuments({ leadId: "l_up_0", type: "follow_up" })), 0);
  pass("if someone else changed the follow-up while the dialog was open, the save is refused, the person is told, and the list refreshes");
  await page.getByLabel("Search follow-ups").fill("");

  // ── set the date from the lead form ──
  await page.goto(`${baseUrl}/admin/crm/leads`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New Lead/ }).click();
  await page.getByLabel("Customer / Client Name").fill("Form Follow-up Client");
  const dateInput = page.getByLabel("Next Follow-up");
  await dateInput.waitFor();
  assert.equal(await dateInput.getAttribute("type"), "datetime-local");
  assert.equal(await page.getByRole("button", { name: "Follow-up owner" }).count(), 0, "no owner to choose until there is a follow-up date");
  const tomorrow = new Date(Date.now() + DAY);
  const pad = (n) => String(n).padStart(2, "0");
  await dateInput.fill(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T11:30`);
  const formOwner = page.getByRole("button", { name: "Follow-up owner" });
  await formOwner.waitFor();
  assert.match(await formOwner.innerText(), /Me \(default\)/, "a new follow-up is yours unless you choose someone else");
  await formOwner.click();
  await page.getByRole("option", { name: "Manager M" }).click();
  await page.getByRole("button", { name: "Create Lead" }).click();
  await page.getByText("Form Follow-up Client").first().waitFor();
  const formLead = await db.collection("leads").findOne({ customerName: "Form Follow-up Client" });
  assert.ok(formLead.nextFollowUpAt, "the follow-up date was saved from the form");
  const formTask = await db.collection("followuptasks").findOne({ leadId: formLead._id, status: "open" });
  assert.deepEqual([formTask.ownerId, formTask.createdVia, new Date(formTask.dueAt).getTime() === new Date(formLead.nextFollowUpAt).getTime()], [2, "crm", true], "the lead's follow-up is a task owned by the person chosen, and its date matches the lead's");
  await page.goto(`${baseUrl}/admin/crm/follow-ups`, { waitUntil: "domcontentloaded" });
  await searchFor("Form Follow-up", "Form Follow-up Client");
  assert.match(await rows.first().innerText(), /Tomorrow/);
  assert.match(await rows.first().getByTestId("followup-owner").innerText(), /Owner: Manager M/);
  pass("a follow-up date set in the lead form (with its owner) shows up on the Follow-ups screen as Tomorrow, owned by the person chosen");

  // ── editing something else must not touch the follow-up ──
  // This follow-up is due at 10:00:37; the form shows it to the minute and must not send a date that is a few seconds off.
  const withSeconds = new Date(istDay(40, 10).getTime() + 37_000);
  await db.collection("leads").insertOne({ _id: "l_secs", companyId: 10, referenceNumber: "LD-2026-0099", customerName: "Seconds Client", phone: "9876500002", status: "contacted", priority: "medium", createdBy: 1, createdAt: new Date(Date.now() + 60_000), updatedAt: now, nextFollowUpAt: withSeconds });
  await page.goto(`${baseUrl}/admin/crm/leads`, { waitUntil: "domcontentloaded" });
  await page.getByText("Seconds Client").first().waitFor();
  await page.getByTitle("Edit Lead").first().click();
  const editNotes = page.getByLabel("Client Requirements & Internal Notes");
  await editNotes.waitFor();
  await editNotes.fill("Only the notes changed.");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Save Changes" }).waitFor({ state: "detached" });
  const secsLead = await db.collection("leads").findOne({ _id: "l_secs" });
  assert.equal(secsLead.notes, "Only the notes changed.", "the edit itself was saved");
  assert.equal(new Date(secsLead.nextFollowUpAt).toISOString(), withSeconds.toISOString(), "the follow-up was not moved by the seconds the form cannot show");
  assert.equal(await db.collection("followuptasks").countDocuments({ leadId: "l_secs" }), 0, "an old follow-up stays as it was until someone changes it");
  assert.equal(await db.collection("crmactivities").countDocuments({ leadId: "l_secs", type: "follow_up" }), 0, "and no 'rescheduled' entry appears in its timeline");
  pass("editing any other field of a lead leaves its follow-up exactly as it was (no shifted date, no new task, no timeline entry)");
  await page.goto(`${baseUrl}/admin/crm/follow-ups`, { waitUntil: "domcontentloaded" });

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
