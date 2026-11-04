/**
 * A custom premises name on a quotation (when none of the saved premises types fits), through the real API and a real
 * browser (isolated production server, throwaway MongoDB):
 *   - the API stores a typed name; a saved premises type and a typed name are alternatives (choosing one clears the other);
 *     the name is trimmed and limited; a copy of the quotation keeps it;
 *   - Step 1 offers "+ Custom premises", asks for the name, saves it, shows it again when reopened, and choosing a saved
 *     type afterwards replaces it; Step 2 and the quotations list show the name; 1280px and 375px.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/custom-premises.browser.mjs
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
  server = await startIsolatedServer("custom-premises", [
    { _id: 1, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 2, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "acme", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("housetypes").insertOne({ _id: 101, companyId: 10, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const admin = await login("admin@example.com", "admin");
  const stored = (id) => db.collection("quotations").findOne({ _id: id });

  // ═══ API ═══
  const typed = await api(admin, "POST", "/api/quotations", { clientName: "Farm client", clientAddress: "Ahmedabad", premisesName: "  Farmhouse  " });
  assert.equal(typed.status, 201, typed.text?.slice(0, 200));
  const typedId = typed.data.id ?? typed.data._id;
  assert.deepEqual([(await stored(typedId)).premisesName, (await stored(typedId)).houseTypeId], ["Farmhouse", null], "a typed name is stored, trimmed");
  const both = await api(admin, "POST", "/api/quotations", { clientName: "Both client", houseTypeId: 101, premisesName: "Ignored" });
  assert.equal(both.status, 201);
  assert.deepEqual([(await stored(both.data.id ?? both.data._id)).houseTypeId, (await stored(both.data.id ?? both.data._id)).premisesName], [101, null], "with both, the saved type wins");
  assert.equal((await api(admin, "PATCH", `/api/quotations/${typedId}`, { houseTypeId: 101 })).status, 200);
  assert.deepEqual([(await stored(typedId)).houseTypeId, (await stored(typedId)).premisesName], [101, null], "choosing a saved type clears the typed name");
  assert.equal((await api(admin, "PATCH", `/api/quotations/${typedId}`, { premisesName: "Dental clinic", houseTypeId: null })).status, 200);
  assert.deepEqual([(await stored(typedId)).houseTypeId, (await stored(typedId)).premisesName], [null, "Dental clinic"], "typing a name clears the saved type");
  assert.equal((await api(admin, "PATCH", `/api/quotations/${typedId}`, { premisesName: "x".repeat(200) })).status, 200);
  assert.equal((await stored(typedId)).premisesName.length, 80, "a long name is cut to 80 characters");
  assert.equal((await api(admin, "PATCH", `/api/quotations/${typedId}`, { premisesName: "Dental clinic" })).status, 200);
  const fetched = await api(admin, "GET", `/api/quotations/${typedId}`);
  assert.equal(fetched.data.premisesName, "Dental clinic", "the quotation API returns it");
  const copy = await api(admin, "POST", `/api/quotations/${typedId}/duplicate`, {});
  assert.ok([200, 201].includes(copy.status), copy.text?.slice(0, 200));
  assert.equal((await stored(copy.data.id ?? copy.data._id)).premisesName, "Dental clinic", "a copy keeps the premises name");
  pass("the API stores a typed premises name (trimmed, at most 80 characters); a saved type and a typed name replace each other; a copy keeps it");

  // ═══ Step 1 in the browser ═══
  const fresh = await api(admin, "POST", "/api/quotations", { clientName: "Browser client", clientAddress: "Ahmedabad, Gujarat" });
  assert.equal(fresh.status, 201);
  const qid = fresh.data.id ?? fresh.data._id;
  browser = await chromium.launch({ headless: true });
  const open = async (viewport, step = 1) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(admin.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`${baseUrl}/quotation/${qid}?step=${step}`, { waitUntil: "domcontentloaded" });
    return { page, context, failures };
  };
  const premisesSelect = (page) => page.getByRole("button", { name: "Project type or premises" }).locator("visible=true");
  const choose = async (page, label) => {
    await premisesSelect(page).click();
    await page.getByRole("option", { name: label }).locator("visible=true").click();
  };
  const nameField = (page) => page.locator('[data-testid="custom-premises-name"]:visible');
  const saveButton = (page) => page.getByRole("button", { name: /Save & Select Spaces/ }).locator("visible=true");

  const desk = await open({ width: 1280, height: 900 });
  await premisesSelect(desk.page).waitFor();
  await choose(desk.page, "+ Custom premises (type a name)");
  await nameField(desk.page).waitFor();
  await saveButton(desk.page).click();
  await desk.page.getByText("Type the premises name, or pick one from the list").locator("visible=true").waitFor();
  assert.equal((await stored(qid)).premisesName ?? null, null, "nothing is saved without a name");
  await nameField(desk.page).fill("Farmhouse");
  assert.equal(await desk.page.getByText("Type the premises name, or pick one from the list").locator("visible=true").count(), 0, "the message clears as the person types");
  await saveButton(desk.page).click();
  await desk.page.waitForURL(/step=2/);
  await desk.page.getByText("Selecting spaces for").locator("visible=true").first().waitFor();
  assert.match(await desk.page.getByText("Selecting spaces for").locator("visible=true").first().innerText(), /Selecting spaces for Farmhouse/, "Step 2 names the custom premises");
  assert.deepEqual([(await stored(qid)).premisesName, (await stored(qid)).houseTypeId], ["Farmhouse", null]);
  assert.deepEqual(desk.failures, [], "no page errors");
  await desk.context.close();
  pass("Step 1 offers '+ Custom premises', requires the name before saving, saves it, and Step 2 names it");

  const again = await open({ width: 1280, height: 900 });
  await nameField(again.page).waitFor();
  assert.equal(await nameField(again.page).inputValue(), "Farmhouse", "reopening Step 1 shows the custom choice and the name");
  assert.match(await premisesSelect(again.page).innerText(), /Custom premises/);
  await choose(again.page, "2 BHK");
  assert.equal(await nameField(again.page).count(), 0, "picking a saved type hides the name box");
  await saveButton(again.page).click();
  await again.page.waitForURL(/step=2/);
  assert.deepEqual([(await stored(qid)).houseTypeId, (await stored(qid)).premisesName], [101, null], "and saving replaces the typed name with the saved type");
  await again.context.close();
  pass("reopening shows the custom name; picking a saved premises type afterwards replaces it");

  // a dealer's quotations list shows a custom name like a saved type
  await api(admin, "PATCH", `/api/quotations/${qid}`, { premisesName: "Showroom", houseTypeId: null });
  const dealer = await login("dealer@example.com", "user");
  const dealerQuote = await api(dealer, "POST", "/api/quotations", { clientName: "Dealer client", premisesName: "Boutique hotel" });
  assert.equal(dealerQuote.status, 201, dealerQuote.text?.slice(0, 200));
  const listContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await listContext.addCookies(dealer.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
  const listPage = await listContext.newPage();
  listPage.setDefaultTimeout(45000);
  await listPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await listPage.getByText("Boutique hotel").locator("visible=true").first().waitFor();
  await listContext.close();
  pass("the dealer's quotations list shows the custom premises name");

  // phone width
  const phone = await open({ width: 375, height: 800 });
  await premisesSelect(phone.page).waitFor();
  await nameField(phone.page).waitFor();
  assert.equal(await nameField(phone.page).inputValue(), "Showroom");
  assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll at 375px");
  await phone.context.close();
  pass("at 375px the premises choice and the name box fit without sideways scrolling");

  console.log(`\nALL ${count} CUSTOM PREMISES TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-2500));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
