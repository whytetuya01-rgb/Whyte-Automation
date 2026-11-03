/**
 * Lead tags through the real app (real Chromium, isolated production server, throwaway MongoDB): the API tidies and
 * limits tags, saves them on create and edit, filters the leads list and the pipeline by tag (ignoring case), counts the
 * tags in use per company, and keeps them company-scoped; the lead form turns typed text into chips (Enter, comma, paste,
 * suggestions, Backspace, limits); the pipeline shows the chips on each card, a tag filter bar and click-to-filter; the
 * detail drawer shows them; everything fits 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/lead-tags.browser.mjs
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
  server = await startIsolatedServer("lead-tags", [
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

  // ── API ──
  const rows = (response) => response.data?.data ?? response.data?.items ?? response.data;
  const create = (name, extra = {}, who = "owner") => api(cookie[who], "POST", "/api/crm/leads", { customerName: name, phone: "9000000001", ...extra });
  const a = await create("Asha Patel", { tags: [" VIP ", "vip", "#Villa", "", "Architect referral"] });
  assert.equal(a.status, 201, a.text?.slice(0, 300));
  const stored = await db.collection("leads").findOne({ _id: a.data.id });
  assert.deepEqual(stored.tags, ["VIP", "Villa", "Architect referral"], "tidied, de-duplicated ignoring case, stored in order");
  const b = await create("Brightway Builders", { tags: ["vip", "Hot"], estimatedBudget: 400000 });
  const c = await create("Chirag Shah");
  assert.deepEqual((await db.collection("leads").findOne({ _id: c.data.id })).tags, [], "a lead without tags has an empty list");
  await create("Other Company Lead", { tags: ["VIP", "SecretTag"] }, "ownerB");

  for (const [bad, why] of [
    [Array.from({ length: 11 }, (_, i) => `tag${i}`), "more than 10 tags"],
    [["x".repeat(25)], "a tag over 24 characters"],
    [["<script>"], "angle brackets"],
    ["VIP", "not a list"],
    [[7], "not text"],
  ]) {
    const refused = await create("Refused", { tags: bad });
    assert.equal(refused.status, 400, `${why} is refused with a 400 (${refused.status})`);
  }
  assert.equal(await db.collection("leads").countDocuments({ customerName: "Refused" }), 0, "refused leads are not stored");
  pass("create: tags are tidied, de-duplicated ignoring case and stored; too many, too long, angle brackets and wrong types are refused with a 400");

  const edited = await api(cookie.owner, "PATCH", `/api/crm/leads/${c.data.id}`, { tags: ["Repeat client", "Hot"] });
  assert.equal(edited.status, 200, edited.text?.slice(0, 300));
  assert.deepEqual((await db.collection("leads").findOne({ _id: c.data.id })).tags, ["Repeat client", "Hot"]);
  const activity = await db.collection("crmactivities").find({ leadId: c.data.id }).toArray();
  assert.ok(activity.some((row) => /Tags set to Repeat client, Hot/.test(row.description ?? "")), "the change is on the lead's timeline");
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${c.data.id}`, { customerName: "Chirag Shah" })).status, 200);
  assert.deepEqual((await db.collection("leads").findOne({ _id: c.data.id })).tags, ["Repeat client", "Hot"], "an edit that does not mention tags leaves them alone");
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${c.data.id}`, { tags: ["Repeat client"].concat(Array.from({ length: 10 }, (_, i) => `t${i}`)) })).status, 400);
  assert.equal((await api(cookie.owner, "PATCH", `/api/crm/leads/${c.data.id}`, { tags: [] })).status, 200);
  assert.deepEqual((await db.collection("leads").findOne({ _id: c.data.id })).tags, [], "an empty list clears the tags");
  await api(cookie.owner, "PATCH", `/api/crm/leads/${c.data.id}`, { tags: ["Repeat client", "Hot"] });
  pass("edit: tags are replaced, an edit without tags leaves them alone, an empty list clears them, the timeline records the change");

  const vip = await api(cookie.owner, "GET", "/api/crm/leads?tag=VIP");
  assert.deepEqual(rows(vip).map((lead) => lead.customerName).sort(), ["Asha Patel", "Brightway Builders"], "the leads list filters by tag ignoring case, inside this company");
  assert.equal(rows(await api(cookie.owner, "GET", "/api/crm/leads?tag=viP")).length, 2);
  assert.equal(rows(await api(cookie.owner, "GET", "/api/crm/leads?tag=Vi")).length, 0, "a tag matches whole, not by prefix");
  assert.equal(rows(await api(cookie.owner, "GET", "/api/crm/leads?tag=.*")).length, 0, "a regular-expression tag is just text");
  const board = await api(cookie.owner, "GET", "/api/crm/pipeline");
  const cards = board.data.flatMap((stage) => stage.items);
  assert.deepEqual(cards.find((card) => card.customerName === "Asha Patel").tags, ["VIP", "Villa", "Architect referral"], "pipeline cards carry their tags");
  const hot = await api(cookie.owner, "GET", "/api/crm/pipeline?tag=hot");
  assert.deepEqual(hot.data.flatMap((stage) => stage.items).map((card) => card.customerName).sort(), ["Brightway Builders", "Chirag Shah"]);
  const tags = await api(cookie.owner, "GET", "/api/crm/lead-tags");
  assert.deepEqual(tags.data.tags.map((entry) => [entry.tag.toLowerCase(), entry.count]), [["hot", 2], ["vip", 2], ["architect referral", 1], ["repeat client", 1], ["villa", 1]], "tags in use with counts, ignoring case, this company only (\"VIP\" and \"vip\" are one tag)");
  assert.ok(!JSON.stringify(tags.data).includes("SecretTag"), "another company's tags never appear");
  const tagsB = await api(cookie.ownerB, "GET", "/api/crm/lead-tags");
  assert.deepEqual(tagsB.data.tags.map((entry) => entry.tag).sort(), ["SecretTag", "VIP"]);
  assert.equal((await api(cookie.dealer, "GET", "/api/crm/lead-tags")).status, 403, "a dealer has no CRM, so no tag list");
  assert.equal((await api("", "GET", "/api/crm/lead-tags")).status, 401);
  pass("filters (leads list and pipeline) ignore case and match whole tags; the tag list counts per company; dealers and signed-out callers are refused");

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

  const desk = await open(cookie.owner, { width: 1280, height: 900 });
  await desk.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  const card = (name) => desk.page.getByTestId("pipeline-card").filter({ hasText: name });
  await card("Asha Patel").waitFor();
  const asha = card("Asha Patel");
  assert.deepEqual(await asha.getByTestId("tag-chip").allInnerTexts(), ["VIP", "Villa", "Architect referral"]);
  assert.equal(await card("Chirag Shah").getByTestId("tag-chips").count(), 1);
  const bar = desk.page.getByTestId("tag-filter");
  await bar.waitFor();
  assert.deepEqual(await bar.getByTestId("tag-chip").allInnerTexts(), ["Hot", "VIP", "Architect referral", "Repeat client", "Villa"], "the filter bar lists the tags in use, most used first");
  await shot(desk.page, "pipeline-tags-1280");

  await bar.getByRole("button", { name: "VIP" }).click();
  await desk.page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 2);
  assert.equal(await card("Chirag Shah").count(), 0, "the board narrows to the tagged leads");
  assert.match(await desk.page.getByText(/tagged “VIP”/).innerText(), /2 opportunities/);
  await bar.getByRole("button", { name: "Clear" }).click();
  await desk.page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 3);
  await asha.getByRole("button", { name: "Villa" }).click();
  await desk.page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 1);
  assert.equal(await desk.page.getByTestId("lost-reason-form").count(), 0);
  assert.equal(await desk.page.getByRole("dialog").count(), 0, "clicking a chip on a card filters; it does not open the lead");
  await desk.page.getByTestId("tag-filter").getByRole("button", { name: "Clear" }).click();
  await desk.page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 3);
  pass("pipeline at 1280px: chips on every tagged card, a filter bar with counts, click-to-filter from the bar and from a card chip, Clear restores the board");

  // lead form (chips animate out when removed, so read them after the motion settles)
  const chipsOf = async (scope) => { await desk.page.waitForTimeout(350); return scope.getByTestId("tag-chip").allInnerTexts(); };
  await desk.page.getByRole("button", { name: "New lead" }).click();
  await desk.page.getByLabel("Customer / Client Name").fill("Divya Interiors");
  const input = desk.page.getByTestId("tag-input");
  await input.waitFor();
  const field = input.locator("input");
  await field.fill("Premium");
  await field.press("Enter");
  await field.pressSequentially("Villa,");
  assert.deepEqual(await chipsOf(input), ["Premium", "Villa"], "typing a comma turns the text before it into a chip");
  await field.pressSequentially("Referral");
  await field.press("Enter");
  assert.deepEqual(await chipsOf(input), ["Premium", "Villa", "Referral"]);
  await field.fill("premium");
  await field.press("Enter");
  assert.match(await input.innerText(), /already added/i, "a duplicate is refused with a reason");
  assert.equal((await chipsOf(input)).length, 3);
  await field.fill("");
  await field.press("Backspace");
  assert.deepEqual(await chipsOf(input), ["Premium", "Villa"], "Backspace on an empty box removes the last tag");
  const suggestions = input.getByTestId("tag-suggestions");
  assert.match(await suggestions.innerText(), /Hot/, "tags used on other leads are suggested");
  await suggestions.getByRole("button", { name: /Hot/ }).click();
  assert.deepEqual(await chipsOf(input), ["Premium", "Villa", "Hot"]);
  await input.getByRole("button", { name: "Remove tag Villa", exact: true }).click();
  assert.deepEqual(await chipsOf(input), ["Premium", "Hot"]);
  await field.fill("a, b, c, d, e, f, g, h, i, j");
  await field.press("Enter");
  assert.match(await input.innerText(), /10\/10|at most 10 tags/i);
  assert.equal((await chipsOf(input)).length, 10, "the form stops at ten tags");
  await shot(desk.page, "lead-form-tags-1280");
  await input.getByRole("button", { name: "Remove tag h", exact: true }).click();
  await desk.page.getByRole("button", { name: "Create Lead" }).click();
  await desk.page.getByRole("dialog").waitFor({ state: "detached" });
  await card("Divya Interiors").waitFor();
  const saved = await db.collection("leads").findOne({ customerName: "Divya Interiors" });
  assert.deepEqual(saved.tags, ["Premium", "Hot", "a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(await card("Divya Interiors").getByTestId("tag-chip").allInnerTexts(), ["Premium", "Hot", "a"]);
  assert.equal(await card("Divya Interiors").getByTestId("tag-more").innerText(), "+6", "more than three tags show the first three and +N");
  pass("lead form: Enter, comma and suggestions make chips, duplicates are refused with a reason, Backspace and × remove, the tenth tag is the limit; the new lead shows its chips (+N) on the board");

  // edit through the drawer
  await card("Chirag Shah").locator("h4").click();
  const drawer = desk.page.getByRole("dialog");
  await drawer.waitFor();
  assert.deepEqual(await drawer.getByTestId("tag-chip").allInnerTexts(), ["Repeat client", "Hot"], "the detail drawer shows the tags");
  await drawer.getByRole("button", { name: "Edit" }).click();
  const editInput = desk.page.getByTestId("tag-input");
  await editInput.waitFor();
  assert.deepEqual(await chipsOf(editInput), ["Repeat client", "Hot"], "the edit form starts with the saved tags");
  await editInput.getByRole("button", { name: "Remove tag Repeat client" }).click();
  await editInput.getByRole("button", { name: "Remove tag Hot" }).click();
  await desk.page.getByRole("button", { name: "Save Changes" }).click();
  await desk.page.waitForFunction(async () => { const j = (await (await fetch("/api/crm/leads?search=Chirag")).json()).data; return (j.data ?? j.items ?? j)[0].tags.length === 0; });
  pass("the detail drawer shows the tags, the edit form starts with them, and removing every tag clears them");
  await desk.context.close();

  // leads table
  const table = await open(cookie.owner, { width: 1280, height: 900 });
  await table.page.goto(`${baseUrl}/admin/crm/leads`, { waitUntil: "domcontentloaded" });
  await table.page.getByText("Asha Patel").first().waitFor();
  assert.match(await table.page.locator("tr", { hasText: "Asha Patel" }).innerText(), /VIP[\s\S]*Villa[\s\S]*Architect referral/);
  await table.context.close();
  pass("the leads table shows each lead's tags");

  const phone = await open(cookie.owner, { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  await phone.page.getByTestId("tag-filter").waitFor();
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll at 375px (the filter bar scrolls inside itself)");
  const barBox = await phone.page.getByTestId("tag-filter").boundingBox();
  assert.ok(barBox && barBox.x >= 0 && barBox.x + barBox.width <= 375, "the tag filter bar fits the phone screen");
  await shot(phone.page, "pipeline-tags-375");
  await phone.page.getByRole("button", { name: "New lead" }).click();
  await phone.page.getByTestId("tag-input").waitFor();
  const field2 = phone.page.getByTestId("tag-input").locator("input");
  await field2.fill("Architect referral, Premium client, Corporate fit-out");
  await field2.press("Enter");
  assert.ok(await noHorizontalScroll(phone.page), "no horizontal scroll with long chips in the form");
  const formBox = await phone.page.getByTestId("tag-input").boundingBox();
  assert.ok(formBox && formBox.x >= 0 && formBox.x + formBox.width <= 375, "the tag field fits the phone screen");
  await shot(phone.page, "lead-form-tags-375");
  await phone.context.close();
  pass("at 375px the filter bar, the tag field and long chips fit with no sideways scroll");

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
