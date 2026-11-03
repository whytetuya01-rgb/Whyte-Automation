/**
 * Contacts (#5) and opportunity probability (#6) through the real app (real Chromium, isolated production server,
 * throwaway MongoDB). Written during development and meant to run in the final full test pass.
 *
 * API: Dealer is a contact type; firm, designation and tags are saved and searchable/filterable per company; a lead can
 * name an architect/builder/contractor/dealer contact (same company, visible, not its own customer); a lead's win
 * probability is saved, validated and resets when the lead changes stage; the pipeline returns each card's probability,
 * expected value and referring contact and each open stage's expected total; the contact profile lists the leads that
 * name it. UI: the pipeline shows probability bars, "Expected" per column, "Closes <date>" and "Architect: <name>"; the
 * lead form sets probability and the contact; the contacts list shows firm and tags and filters by tag; the profile shows
 * the firm and the projects the contact brought in; everything fits 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/contacts-probability.browser.mjs
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
  server = await startIsolatedServer("contacts-prob", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "dealer@example.com", role: "dealer", name: "A Dealer", companyId: 10, discountAllocationPercent: 10 },
    { _id: 3, email: "owner-b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = {
    owner: await login("owner@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    ownerB: await login("owner-b@example.com", "admin"),
  };
  const rows = (response) => response.data?.data ?? response.data?.items ?? response.data;
  const customer = (body, who = "owner") => api(cookie[who], "POST", "/api/crm/customers", body);
  const lead = (body, who = "owner") => api(cookie[who], "POST", "/api/crm/leads", { phone: "9000000001", ...body });

  // ── #5 contacts ──
  const architect = await customer({ name: "Neha Shah", customerType: "architect", companyName: " Studio Nine Architects ", designation: "Principal Architect", phone: "9811111111", tags: [" Premium ", "premium", "Referral"] });
  assert.equal(architect.status, 201, architect.text?.slice(0, 300));
  const stored = await db.collection("customers").findOne({ _id: architect.data.id });
  assert.deepEqual([stored.customerType, stored.companyName, stored.designation, stored.tags], ["architect", "Studio Nine Architects", "Principal Architect", ["Premium", "Referral"]]);
  const dealerContact = await customer({ name: "Kiran Traders", customerType: "dealer", companyName: "Kiran Traders", phone: "9822222222" });
  assert.equal(dealerContact.status, 201, "Dealer is a contact type");
  const homeowner = await customer({ name: "Asha Patel", customerType: "individual", phone: "9833333333" });
  await customer({ name: "Other Co Architect", customerType: "architect", companyName: "Hidden Firm", tags: ["SecretTag"], phone: "9844444444" }, "ownerB");

  assert.equal((await customer({ name: "X", customerType: "supplier", phone: "9855555555" })).status, 400, "an unknown type is refused");
  assert.equal((await customer({ name: "Y", customerType: "architect", phone: "9866666666", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status, 400);

  assert.deepEqual(rows(await api(cookie.owner, "GET", "/api/crm/customers?search=Studio%20Nine")).map((c) => c.name), ["Neha Shah"], "search finds a contact by firm");
  assert.deepEqual(rows(await api(cookie.owner, "GET", "/api/crm/customers?tag=premium")).map((c) => c.name), ["Neha Shah"], "the tag filter ignores case");
  assert.deepEqual(rows(await api(cookie.owner, "GET", "/api/crm/customers?customerType=dealer")).map((c) => c.name), ["Kiran Traders"]);
  assert.equal(rows(await api(cookie.owner, "GET", "/api/crm/customers?search=Hidden")).length, 0, "another company's contacts never appear");
  const customerTags = await api(cookie.owner, "GET", "/api/crm/customer-tags");
  assert.deepEqual(customerTags.data.tags.map((t) => [t.tag, t.count]), [["Premium", 1], ["Referral", 1]], "tags in use, this company only");
  assert.equal((await api(cookie.dealer, "GET", "/api/crm/customer-tags")).status, 403);
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/customers/${architect.data.id}`, { designation: null, tags: [] })).status, 200);
  const cleared = await db.collection("customers").findOne({ _id: architect.data.id });
  assert.deepEqual([cleared.designation, cleared.tags], [null, []], "null / an empty list clear them");
  await api(cookie.owner, "PATCH", `/api/crm/customers/${architect.data.id}`, { designation: "Principal Architect", tags: ["Premium", "Referral"] });
  pass("#5 contacts: Dealer type, firm, designation and tags are saved, validated, searchable and filterable inside the company; clearing works; dealers have no tag list");

  // ── #6 probability and #5 links ──
  const day = 86_400_000;
  const quoted = await lead({ customerName: "Brightway Villa", customerId: homeowner.data.id, estimatedBudget: 400000, status: "quoted", expectedClosingDate: new Date(Date.now() + 20 * day).toISOString(), referrerId: architect.data.id, probability: 90 });
  assert.equal(quoted.status, 201, quoted.text?.slice(0, 300));
  const fresh = await lead({ customerName: "Chirag Flat", estimatedBudget: 200000 });
  const viaDealer = await lead({ customerName: "Dev Interiors", estimatedBudget: 100000, status: "contacted", referrerId: dealerContact.data.id });
  const storedLead = await db.collection("leads").findOne({ _id: quoted.data.id });
  assert.deepEqual([storedLead.probability, storedLead.referrerId], [90, architect.data.id]);
  assert.equal((await lead({ customerName: "Bad Prob", probability: 101 })).status, 400);
  assert.equal((await lead({ customerName: "Bad Prob", probability: 5.5 })).status, 400);
  assert.equal((await lead({ customerName: "Self Ref", customerId: homeowner.data.id, referrerId: homeowner.data.id })).status, 400, "a lead's customer cannot also be its referrer");
  assert.equal((await lead({ customerName: "Ghost Ref", referrerId: 999999 })).status, 404);
  const otherCompanyContact = await db.collection("customers").findOne({ companyId: 20 });
  assert.equal((await lead({ customerName: "Cross Ref", referrerId: otherCompanyContact._id })).status, 404, "another company's contact cannot be named");
  assert.equal(await db.collection("leads").countDocuments({ customerName: { $in: ["Bad Prob", "Self Ref", "Ghost Ref", "Cross Ref"] } }), 0, "refused leads are not stored");

  const board = (await api(cookie.owner, "GET", "/api/crm/pipeline")).data;
  const card = (name) => board.flatMap((stage) => stage.items).find((item) => item.customerName === name);
  assert.deepEqual([card("Brightway Villa").probability, card("Brightway Villa").probabilityOverridden, card("Brightway Villa").weightedValue], [90, true, 360000], "an override is used and flagged");
  assert.deepEqual([card("Chirag Flat").probability, card("Chirag Flat").probabilityOverridden, card("Chirag Flat").weightedValue], [10, false, 20000], "no override: the stage default");
  assert.equal(card("Dev Interiors").probability, 25, "contacted defaults to 25%");
  assert.deepEqual([card("Brightway Villa").referrerName, card("Brightway Villa").referrerType], ["Neha Shah", "architect"]);
  assert.deepEqual([card("Dev Interiors").referrerName, card("Dev Interiors").referrerType], ["Kiran Traders", "dealer"]);
  const stage = (id) => board.find((s) => s.id === id);
  assert.equal(stage("quoted").weightedValue, 360000);
  assert.equal(stage("new").weightedValue, 20000);
  assert.equal(stage("contacted").weightedValue, 25000);
  pass("#6 probability: saved and validated; the pipeline returns each card's chance (override or stage default), expected value, referring contact and each stage's expected total");

  const moved = await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}/status`, { status: "negotiation" });
  assert.equal(moved.status, 200, moved.text?.slice(0, 200));
  assert.equal((await db.collection("leads").findOne({ _id: quoted.data.id })).probability, null, "moving to another stage resets the override");
  assert.equal(card("Brightway Villa") && (await api(cookie.owner, "GET", "/api/crm/pipeline")).data.flatMap((s) => s.items).find((i) => i.customerName === "Brightway Villa").probability, 80, "negotiation defaults to 80%");
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}`, { probability: 95 })).status, 200);
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}`, { customerName: "Brightway Villa" })).status, 200);
  assert.equal((await db.collection("leads").findOne({ _id: quoted.data.id })).probability, 95, "an edit that does not mention it leaves it alone");
  await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}/status`, { status: "won" });
  const won = (await api(cookie.owner, "GET", "/api/crm/pipeline")).data.flatMap((s) => s.items).find((i) => i.customerName === "Brightway Villa");
  assert.equal(won.probability, 100, "won is 100%");
  await api(cookie.owner, "PATCH", `/api/crm/leads/${fresh.data.id}/status`, { status: "lost", lostReason: "Price" });
  assert.equal((await api(cookie.owner, "GET", "/api/crm/pipeline")).data.flatMap((s) => s.items).find((i) => i.customerName === "Chirag Flat").probability, 0, "lost is 0%");
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${viaDealer.data.id}`, { referrerId: null })).status, 200);
  assert.equal((await db.collection("leads").findOne({ _id: viaDealer.data.id })).referrerId, null, "the contact can be removed");
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${viaDealer.data.id}`, { referrerId: homeowner.data.id })).status, 200, "any visible contact of the company can be named");
  const timeline = await db.collection("crmactivities").find({ leadId: quoted.data.id }).toArray();
  assert.ok(timeline.some((row) => /Win probability set to 95%/.test(row.description ?? "")), "the timeline records the change");
  await api(cookie.owner, "PATCH", `/api/crm/leads/${viaDealer.data.id}`, { referrerId: dealerContact.data.id });
  pass("#6 resets and edits: a stage change resets the override, an unrelated edit keeps it, won = 100%, lost = 0%, the contact link can be changed and removed, the timeline records it");

  const profile = (await api(cookie.owner, "GET", `/api/crm/customers/${architect.data.id}`)).data;
  assert.deepEqual(profile.referredLeads.map((l) => l.customerName), ["Brightway Villa"], "the architect's profile lists the leads that name them");
  assert.deepEqual((await api(cookie.owner, "GET", `/api/crm/customers/${dealerContact.data.id}`)).data.referredLeads.map((l) => l.customerName), ["Dev Interiors"]);
  assert.equal((await api(cookie.dealer, "GET", `/api/crm/customers/${architect.data.id}`)).status, 403);
  pass("#5 links: a contact's profile lists the projects that name them");

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

  // Fresh, readable board data for the UI checks.
  await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}/status`, { status: "quoted" });
  await api(cookie.owner, "PATCH", `/api/crm/leads/${quoted.data.id}`, { probability: 90, expectedClosingDate: "2026-12-12" });

  const desk = await open(cookie.owner, { width: 1280, height: 900 });
  await desk.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  const pc = (name) => desk.page.getByTestId("pipeline-card").filter({ hasText: name });
  await pc("Brightway Villa").waitFor();
  const villa = pc("Brightway Villa");
  assert.match(await villa.getByTestId("card-probability").innerText(), /90% likely/);
  assert.match(await villa.getByTestId("card-probability").innerText(), /set/i, "an override is marked");
  assert.equal(await villa.getByRole("progressbar", { name: "Chance this deal closes" }).getAttribute("aria-valuenow"), "90");
  assert.match(await villa.getByTestId("card-referrer").innerText(), /Architect: Neha Shah/);
  assert.match(await villa.getByTestId("card-closing").innerText(), /Closes 12 Dec/);
  assert.match(await pc("Dev Interiors").getByTestId("card-probability").innerText(), /25% likely/);
  assert.equal(await desk.page.getByTestId("pipeline-column").filter({ has: desk.page.getByRole("heading", { name: "Proposal Sent", exact: true }) }).getByTestId("stage-expected").count(), 1, "the Quoted stage (shown as Proposal Sent) shows its expected total");
  assert.match(await desk.page.getByTestId("pipeline-summary").innerText(), /expected/i, "the open pipeline tile shows the expected total");
  assert.ok(await noHorizontalScroll(desk.page));
  await shot(desk.page, "pipeline-probability-1280");

  // lead form: set probability and contact on an existing lead through the drawer
  await villa.locator("h4").click();
  const drawer = desk.page.getByRole("dialog");
  await drawer.waitFor();
  assert.match(await drawer.getByTestId("drawer-probability").innerText(), /90%/);
  assert.match(await drawer.getByTestId("drawer-referrer").innerText(), /Neha Shah[\s\S]*Architect/);
  await drawer.getByRole("button", { name: "Edit" }).click();
  const probabilityField = desk.page.getByLabel("Win Probability (%)");
  await probabilityField.waitFor();
  assert.equal(await probabilityField.inputValue(), "90");
  await probabilityField.fill("");
  await desk.page.getByRole("button", { name: "Save Changes" }).click();
  await desk.page.waitForFunction(async (id) => (await (await fetch(`/api/crm/leads/${id}`)).json()).data.probability === null, quoted.data.id);
  await desk.context.close();
  pass("pipeline UI at 1280px: probability bar and marker, expected value, referring contact, closing date, expected totals; the drawer shows them and the form can clear an override");

  const list = await open(cookie.owner, { width: 1280, height: 900 });
  await list.page.goto(`${baseUrl}/admin/crm/customers`, { waitUntil: "domcontentloaded" });
  await list.page.getByText("Neha Shah").first().waitFor();
  assert.match(await list.page.locator("tr", { hasText: "Neha Shah" }).getByTestId("customer-firm").innerText(), /Principal Architect · Studio Nine Architects/);
  assert.deepEqual(await list.page.locator("tr", { hasText: "Neha Shah" }).getByTestId("tag-chip").allInnerTexts(), ["Premium", "Referral"]);
  await list.page.getByTestId("tag-filter").getByRole("button", { name: "Premium" }).click();
  await list.page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  await list.page.getByTestId("tag-filter").getByRole("button", { name: "Clear" }).click();
  await list.page.getByText("Neha Shah").first().click();
  await list.page.waitForURL(/\/admin\/crm\/customers\/\d+/);
  assert.match(await list.page.getByTestId("customer-firm").innerText(), /Principal Architect · Studio Nine Architects/);
  await list.page.getByRole("tab", { name: /Enquir|Lead/i }).first().click().catch(() => {});
  await list.page.getByTestId("referred-leads").waitFor();
  assert.match(await list.page.getByTestId("referred-leads").innerText(), /Brightway Villa/);
  assert.ok(await noHorizontalScroll(list.page));
  await shot(list.page, "contact-profile-1280");
  await list.context.close();
  pass("contacts UI at 1280px: firm and tags in the list, the tag filter, the profile header's firm, and the projects the contact brought in");

  const phone = await open(cookie.owner, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  await phone.page.getByTestId("pipeline-card").first().waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "the pipeline fits 375px with probability bars");
  await shot(phone.page, "pipeline-probability-375");
  await phone.page.goto(`${baseUrl}/admin/crm/customers`, { waitUntil: "domcontentloaded" });
  await phone.page.getByText("Neha Shah").first().waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "the contacts list fits 375px");
  await phone.context.close();
  pass("at 375px the pipeline and the contacts list fit with no sideways scroll");

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
