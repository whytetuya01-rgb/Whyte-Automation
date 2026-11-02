/**
 * Browser check of the "Client / Customer Name" field on a quotation's Project tab (real Chromium, isolated production
 * server, throwaway MongoDB): it is one searchable dropdown. Focusing it lists customers A to Z (one request, no paging),
 * typing searches by name / phone / email, choosing a customer links it and fills the details, a name that is not in
 * the list can just be typed (and is saved as a new customer with a phone number), the screen never shows an internal
 * id, and a Dealer sees (and can pick) only their own customers, with no CRM request at all.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/crm-customer-combobox.browser.mjs
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
  server = await startIsolatedServer("combobox-ui", [
    // An "admin": the quotation pages only admit dealer, admin and super_admin (see the app layout).
    { _id: 1, email: "owner@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "acme", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("housetypes").insertOne({ _id: 101, companyId: 10, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  // 26 customers (more than one page of 20), added out of order so "A to Z" is visible.
  const names = ["Zara Interiors", "Meera Shah", "Ravi Patel", "Asha Mehta", "Rahul Verma"];
  for (let i = 0; i < 21; i += 1) names.push(`Filler ${String(i).padStart(2, "0")}`);
  const owner = await login("owner@example.com", "admin");
  for (const [i, name] of names.entries()) {
    const res = await api(owner, "POST", "/api/crm/customers", { name, phone: `98000${String(10000 + i)}`, email: i === 2 ? "ravi.patel@example.com" : undefined, siteAddress: i === 2 ? "Satellite, Ahmedabad" : undefined });
    assert.equal(res.status, 201, `${name}: ${res.text?.slice(0, 120)}`);
  }
  const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "accent" });
  const sortedSeed = [...names].sort(byName);
  // Saving the draft quotation below (with a phone number) also adds "Draft client" to the customer list.
  const sortedFirst = [...names, "Draft client"].sort(byName);

  // server: A to Z sort and paging
  const sortedApi = await api(owner, "GET", "/api/crm/customers?sort=name&pageSize=20");
  assert.deepEqual((sortedApi.data.data ?? []).map((c) => c.name), sortedSeed.slice(0, 20), "the list API can sort A to Z");
  assert.equal((await api(owner, "GET", "/api/crm/customers?sort=oldest")).status, 400, "unknown sort values are refused");

  const created = await api(owner, "POST", "/api/quotations", { clientName: "Draft client", clientPhone: "9811111111", houseTypeId: 101 });
  assert.equal(created.status, 201, created.text?.slice(0, 160));
  const qid = created.data.id ?? created.data._id;
  const dealer = await login("dealer@example.com", "user");
  const dealerQuote = await api(dealer, "POST", "/api/quotations", { clientName: "Dealer draft", houseTypeId: 101 });
  assert.equal(dealerQuote.status, 201);
  const dealerQid = dealerQuote.data.id ?? dealerQuote.data._id;

  browser = await chromium.launch({ headless: true });
  const open = async (cookie, id, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`${baseUrl}/quotation/${id}?step=1`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="client-name-combobox"]:visible').waitFor();
    return { page, context, failures };
  };
  const field = (page) => page.locator('[data-testid="client-name-combobox"]:visible');
  const options = (page) => page.getByRole("option");

  // ── list, search, select ──
  const { page, context, failures } = await open(owner, qid);
  await field(page).fill("");
  await field(page).focus();
  await options(page).first().waitFor();
  let crmListRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/crm/customers?")) crmListRequests += 1; });
  const listed = await options(page).locator(".text-sm.font-semibold").allInnerTexts();
  assert.deepEqual(listed, sortedFirst, "focusing the field lists every customer A to Z at once (no paging)");
  assert.equal(await page.getByRole("button", { name: "Show more customers" }).count(), 0, "there is no Show more button");
  assert.equal(await page.getByTestId("customer-list-truncated").count(), 0, "and no 'showing the first N' note while everything fits");
  assert.equal(crmListRequests, 0, "the list needed no further request after the first");
  assert.ok(!(await page.locator("body").innerText()).match(/ID\s*#|#\d+\b/), "no internal id is shown in the list or on the page");
  pass("focusing the field lists all the customers A to Z in one request (no paging), and no internal id appears");

  await field(page).fill("ravi");
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length < 5);
  const rows = await options(page).allInnerTexts();
  assert.ok(rows.some((text) => text.includes("Ravi Patel") && text.includes("ravi.patel@example.com") && text.includes("Satellite, Ahmedabad")), "search by name shows email and place");
  assert.ok(rows.some((text) => /Use .ravi. as a new customer/.test(text)), "and offers to use the typed name as a new customer");
  await field(page).fill("9800010002");
  await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((el) => el.textContent?.includes("Ravi Patel")));
  assert.equal(await options(page).filter({ hasText: "Ravi Patel" }).count(), 1, "search by phone number finds the customer");
  pass("typing searches by name, phone or email and shows the person's contact details");

  await field(page).fill("Ravi Pa");
  await options(page).filter({ hasText: "Ravi Patel" }).first().waitFor();
  await field(page).press("ArrowDown");
  await field(page).press("ArrowDown");
  await field(page).press("Enter");
  const card = page.getByTestId("linked-customer");
  await card.waitFor();
  assert.match(await card.innerText(), /Ravi Patel/);
  assert.match(await card.innerText(), /existing customer/i);
  assert.ok(!/ID\s*#|#\d+/.test(await card.innerText()), "the linked card shows no id");
  assert.equal(await field(page).inputValue(), "Ravi Patel");
  assert.match(await page.locator("body").innerText(), /\+?91\s*98000\s*10002|9800010002/, "the phone number was filled in");
  assert.match(await page.locator("input[value*='Satellite']").first().inputValue(), /Satellite/, "the location was filled in");
  pass("choosing a customer (keyboard works too) links it and fills the name, phone and location; the card shows no id");

  // ── writing a different name unlinks and keeps what was typed ──
  await field(page).fill("Ravi Patel Junior");
  await card.waitFor({ state: "detached" });
  assert.equal(await field(page).inputValue(), "Ravi Patel Junior", "the typed name is kept");
  assert.equal(await page.locator("input[inputmode='numeric']").first().inputValue(), "", "the old customer's phone is cleared, so a new person does not inherit it");
  assert.equal(await page.locator("input[type='email'], input[placeholder*='@']").first().inputValue(), "", "and so is the old customer's email");
  await options(page).filter({ hasText: /as a new customer/ }).first().click();
  assert.equal(await page.getByRole("option").count(), 0, "choosing 'use as new' closes the list");
  assert.equal(await field(page).inputValue(), "Ravi Patel Junior");
  pass("typing a name that is not in the list unlinks the old customer and keeps the new name");

  // ── saving a new customer ──
  await field(page).fill("Brand New Client");
  await page.keyboard.press("Escape");
  await page.locator("input[inputmode='numeric']").first().fill("9876501234");
  // The old customer's address was cleared with the rest of their details, and the location is required.
  await page.getByPlaceholder("e.g. Ahmedabad, Gujarat").fill("Surat");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Save & Select Spaces/ }).click();
  await page.waitForURL(/step=2/, { timeout: 60000 });
  const saved = await db.collection("quotations").findOne({ _id: qid });
  assert.equal(saved.clientName, "Brand New Client");
  const newCustomer = await db.collection("customers").findOne({ companyId: 10, name: "Brand New Client" });
  assert.ok(newCustomer, "the new customer was added to the customer list");
  assert.ok(String(newCustomer.phone).replace(/\D/g, "").endsWith("9876501234"), "with the phone number that was entered");
  assert.equal(saved.customerId, newCustomer._id, "and the quotation is linked to it");
  pass("a brand-new name saved with a phone number becomes a new customer linked to the quotation");

  // ── reopen: the linked card appears (loaded by id), no id shown ──
  await page.goto(`${baseUrl}/quotation/${qid}?step=1`, { waitUntil: "domcontentloaded" });
  const reopened = page.locator('[data-testid="linked-customer"]:visible');
  await reopened.waitFor();
  // The card shows at once; the customer's details are loaded by id a moment later.
  await reopened.getByText("Brand New Client").first().waitFor();
  assert.match(await reopened.innerText(), /Brand New Client/);
  assert.ok(!/ID\s*#|#\d+/.test(await reopened.innerText()));
  await page.getByRole("button", { name: "Unlink" }).locator("visible=true").click();
  await page.getByTestId("linked-customer").waitFor({ state: "detached" });
  assert.equal(await field(page).inputValue(), "Brand New Client", "unlinking keeps the name");
  assert.deepEqual(failures, [], "no page errors");
  await context.close();
  pass("reopening shows the linked customer without an id; Unlink keeps the typed name");

  // ── a Dealer picks from their OWN customers only ──
  const dealerCustomerRes = await api(owner, "POST", "/api/crm/customers", { name: "Dealer Own Customer", phone: "9833333333", siteAddress: "Vesu, Surat", dealerId: 4 });
  assert.equal(dealerCustomerRes.status, 201, dealerCustomerRes.text?.slice(0, 160));
  const dealerCustomerId = dealerCustomerRes.data.id;

  // Typing a brand-new name still works: the dropdown offers "Use ... as a new customer" and the name stays as typed.
  const dealerView = await open(dealer, dealerQid);
  const crmResponses = [];
  const lookupResponses = [];
  dealerView.page.on("response", (res) => {
    if (res.url().includes("/api/crm/")) crmResponses.push(res.status());
    if (res.url().includes("/api/customers/lookup")) lookupResponses.push(res.status());
  });
  await field(dealerView.page).fill("");
  await field(dealerView.page).focus();
  await options(dealerView.page).first().waitFor();
  assert.deepEqual(await options(dealerView.page).locator(".text-sm.font-semibold").allInnerTexts(), ["Dealer Own Customer"], "a Dealer's dropdown lists only their own customers, none of the company's others");
  await field(dealerView.page).fill("Some Dealer Client");
  await dealerView.page.getByText("as a new customer").waitFor();
  assert.equal(await options(dealerView.page).count(), 1, "a name that matches nobody offers only 'new customer'");
  assert.equal(await dealerView.page.getByTestId("linked-customer").count(), 0);
  assert.equal(await field(dealerView.page).inputValue(), "Some Dealer Client");
  assert.deepEqual(dealerView.failures, [], "no page errors");
  await dealerView.page.locator("input[inputmode='numeric']").first().fill("9822222222");
  await dealerView.page.getByPlaceholder("e.g. Ahmedabad, Gujarat").fill("Surat"); // the location is required
  await dealerView.page.keyboard.press("Escape");
  await dealerView.page.getByRole("button", { name: /Save & Select Spaces/ }).click();
  await dealerView.page.waitForURL(/step=2/, { timeout: 60000 });
  assert.equal((await db.collection("quotations").findOne({ _id: dealerQid })).clientName, "Some Dealer Client", "a Dealer can still type a new name and save");
  assert.ok(lookupResponses.length > 0 && lookupResponses.every((status) => status === 200), `the picker's lookups succeeded (${lookupResponses})`);
  assert.equal(crmResponses.length, 0, `and the CRM was never asked, so no 403 (${crmResponses})`);
  await dealerView.context.close();

  // Picking one of their own customers links it and fills the details.
  const pickQuote = await api(dealer, "POST", "/api/quotations", { clientName: "Dealer pick draft", houseTypeId: 101 });
  assert.equal(pickQuote.status, 201);
  const pickQid = pickQuote.data.id ?? pickQuote.data._id;
  const pickView = await open(dealer, pickQid);
  await field(pickView.page).fill("");
  await field(pickView.page).focus();
  await options(pickView.page).first().waitFor();
  await field(pickView.page).fill("own");
  await options(pickView.page).filter({ hasText: "Dealer Own Customer" }).first().click();
  await pickView.page.getByTestId("linked-customer").waitFor();
  assert.equal(await field(pickView.page).inputValue(), "Dealer Own Customer");
  assert.ok(!(await pickView.page.locator("body").innerText()).match(/ID\s*#|#\d+\b/), "no internal id on the page");
  await pickView.page.getByRole("button", { name: /Save & Select Spaces/ }).click();
  await pickView.page.waitForURL(/step=2/, { timeout: 60000 });
  const picked = await db.collection("quotations").findOne({ _id: pickQid });
  assert.deepEqual([picked.customerId, picked.clientName, picked.clientPhone], [dealerCustomerId, "Dealer Own Customer", "9833333333"], "the Dealer's own customer is linked to the quotation and fills its details");
  // Reopening shows the linked customer (loaded by id, which a Dealer may do for their own customer).
  await pickView.page.goto(`${baseUrl}/quotation/${pickQid}?step=1`, { waitUntil: "domcontentloaded" });
  await pickView.page.locator('[data-testid="linked-customer"]:visible').waitFor();
  assert.deepEqual(pickView.failures, [], "no page errors");
  await pickView.context.close();
  pass("a Dealer's dropdown lists only their own customers; picking one links it and fills the details, a new name can still be typed, the linked customer shows on reopening, and the CRM is never asked (no 403)");

  // ── CRM grids: 10 rows by default, like Quotations and Products ──
  for (let i = 0; i < 24; i += 1) {
    const res = await api(owner, "POST", "/api/crm/leads", { customerName: `Grid Lead ${String(i).padStart(2, "0")}`, phone: `97000${String(20000 + i)}` });
    assert.equal(res.status, 201, res.text?.slice(0, 120));
  }
  for (const [path, entity] of [["/admin/crm/customers", "customers"], ["/admin/crm/leads", "leads"]]) {
    // Earlier steps added customers too, so the expected total comes from the server.
    const total = (await api(owner, "GET", `/api/crm/${entity}?pageSize=1`)).data.pagination.total;
    assert.ok(total > 20, `${entity}: more than two pages of 10 to test with (${total})`);
    const gridContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await gridContext.addCookies(owner.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const grid = await gridContext.newPage();
    grid.setDefaultTimeout(45000);
    const requested = [];
    grid.on("request", (request) => { if (request.url().includes(`/api/crm/${entity}?`)) requested.push(new URL(request.url()).searchParams); });
    await grid.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    const rowsLocator = grid.locator("tbody tr");
    await rowsLocator.first().waitFor();
    const select = grid.getByRole("button", { name: "Rows per page" });
    assert.equal((await select.innerText()).trim(), "10", `${entity}: the Rows select shows 10`);
    assert.equal(await rowsLocator.count(), 10, `${entity}: 10 rows on the first page`);
    assert.equal(requested[0]?.get("pageSize"), "10", `${entity}: the first request asks for 10`);
    // The footer is rebuilt when the data reloads, so opening the select is retried until it is really open.
    const chooseRows = async (value) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await grid.getByRole("button", { name: "Rows per page" }).click();
        const option = grid.getByRole("option", { name: value, exact: true });
        if (await option.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
          await option.click();
          await grid.waitForFunction((expected) => document.querySelector('button[aria-label="Rows per page"]')?.textContent?.trim() === expected, value);
          return;
        }
      }
      throw new Error(`could not choose ${value} rows`);
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await grid.getByRole("button", { name: "Rows per page" }).click();
      if (await grid.getByRole("option").first().waitFor({ timeout: 4000 }).then(() => true, () => false)) break;
    }
    assert.deepEqual(await grid.getByRole("option").allInnerTexts().then((texts) => texts.map((t) => t.trim())), ["10", "20", "25", "50", "100"], `${entity}: the usual choices`);
    await grid.getByRole("option", { name: "20", exact: true }).click();
    await grid.waitForFunction((expected) => document.querySelectorAll("tbody tr").length === expected, 20);
    await grid.waitForFunction(() => document.querySelector('button[aria-label="Rows per page"]')?.textContent?.trim() === "20");
    assert.equal(requested.at(-1)?.get("pageSize"), "20");
    assert.equal(requested.at(-1)?.get("page"), "1");
    // Going to the last page and then choosing a bigger size goes back to page 1 (never an empty page).
    await chooseRows("10");
    await grid.waitForFunction(() => document.querySelectorAll("tbody tr").length === 10);
    await grid.getByRole("button", { name: "Page 3" }).click();
    await grid.waitForFunction((expected) => document.querySelectorAll("tbody tr").length === expected, total - 20);
    await chooseRows("50");
    await grid.waitForFunction((expected) => document.querySelectorAll("tbody tr").length === expected, total);
    assert.equal(requested.at(-1)?.get("page"), "1", `${entity}: changing the size returns to page 1`);
    await gridContext.close();
  }
  pass("the Customers and Leads grids start at 10 rows with the Rows select showing 10 (10 / 20 / 25 / 50 / 100); changing the size returns to page 1");

  // ── phone ──
  const phone = await open(owner, qid, { width: 390, height: 800 });
  await field(phone.page).fill("");
  await field(phone.page).focus();
  await options(phone.page).first().waitFor();
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no sideways scrolling at 390px (${overflow}px)`);
  const box = await phone.page.locator('[role="listbox"]').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "the list fits the phone screen");
  await phone.context.close();
  pass("on a phone the dropdown fits the screen");

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
