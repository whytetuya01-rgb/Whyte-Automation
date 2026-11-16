/**
 * Dropdowns follow the theme (isolated production server, throwaway MongoDB). A native <select> is drawn by the browser, with its
 * blue highlight, and cannot be styled, so the admin area uses the shared themed dropdowns:
 *   - no visible native <select> anywhere in the admin source (a static scan, so a new one cannot creep in);
 *   - My account: the time zone is found by typing, saved, and can go back to the default; the list stays on a phone screen;
 *   - Bulk Pricing: the menus stay on a phone screen; native checkboxes and radios take the theme colour, not browser blue;
 *   - the dealer category correction (Super Admin acting as the company) saves through its dropdown.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/themed-dropdowns.browser.mjs   (SCREENSHOT_DIR=<dir> for screenshots)
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  // ═══ static: no visible native <select> in the admin area ═══
  const tsxFiles = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsxFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
  const withSelect = [...tsxFiles("src/app/admin"), ...tsxFiles("src/components/admin")].filter((path) => readFileSync(path, "utf8").includes("<select"));
  // ActAsCompanyControl's is hidden (sr-only, for automation); what people see there is the themed search dropdown.
  assert.deepEqual(withSelect.map((path) => path.replace(/\\/g, "/")), ["src/components/admin/ActAsCompanyControl.tsx"], "a native <select> in the admin area ignores the theme: use CustomDropdown or SearchableSelect");
  assert.match(readFileSync("src/components/admin/ActAsCompanyControl.tsx", "utf8"), /sr-only absolute h-0 w-0[\s\S]*?data-testid="act-as-company"/, "the one that remains stays hidden");
  pass("no visible native <select> anywhere in the admin area's source");

  server = await startIsolatedServer("themed-dropdowns", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 3, email: "dealer@example.com", role: "dealer", name: "Dev Dealer", discountAllocationPercent: 5, companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const owner = await login("owner@example.com", "admin");
  const superCookie = await login("super@example.com", "admin");

  browser = await chromium.launch({ headless: true });
  const open = async (cookie, viewport, path) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    return { context, page, failures };
  };
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` }); };
  const onScreen = async (page, locator, width) => {
    const box = await locator.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width, `on screen at ${width}px (x ${box?.x}, width ${box?.width})`);
  };
  const zoneOf = async () => (await db.collection("adminusers").findOne({ _id: 2 })).timeZone;
  const waitForZone = async (page, expected) => {
    for (let i = 0; i < 100 && (await zoneOf()) !== expected; i += 1) await page.waitForTimeout(100);
    assert.equal(await zoneOf(), expected);
  };

  // ═══ My account: the time zone ═══
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const { context, page, failures } = await open(owner, viewport, "/admin/account");
    const trigger = page.getByRole("button", { name: "Your time zone" });
    await trigger.waitFor();
    assert.match(await trigger.innerText(), /Default: Asia\/Kolkata \(India\)/, "the default is shown until a zone is chosen");
    assert.equal(await page.locator("main select").count(), 0, "no browser-styled dropdown");
    await trigger.click();
    const search = page.getByPlaceholder("Search, e.g. Dubai or London");
    await search.fill("no such zone");
    await page.getByText("No time zone matches that").waitFor();
    await search.fill("dubai");
    await onScreen(page, page.getByRole("listbox"), w);
    await shot(page, `timezone-menu-${w}`);
    await page.getByRole("option", { name: /Asia\/Dubai/ }).click();
    await page.getByTestId("timezone-save").click();
    await waitForZone(page, "Asia/Dubai");
    assert.match(await page.getByTestId("timezone-preview").innerText(), /Asia\/Dubai/);
    await trigger.click();
    await page.getByRole("option", { name: /^Default: Asia\/Kolkata/ }).click();
    await page.getByTestId("timezone-save").click();
    await waitForZone(page, undefined);
    assert.deepEqual(failures, [], "no page errors");
    await context.close();
  }
  pass("My account: a time zone is found by typing, saved, and put back to the default; the list stays on screen at 1280px and 375px");

  // ═══ Bulk Pricing ═══
  {
    const { context, page } = await open(owner, { width: 375, height: 800 }, "/admin/pricing");
    await page.getByTestId("pricing-mode").waitFor();
    assert.equal(await page.locator("main select").count(), 0, "no browser-styled dropdown");
    await page.getByTestId("pricing-mode").click();
    await onScreen(page, page.getByRole("listbox"), 375);
    await shot(page, "pricing-menu-375");
    await page.getByRole("option", { name: "Amount (₹)", exact: true }).click();
    assert.match(await page.getByTestId("pricing-mode").innerText(), /Amount/);
    const accent = await page.getByTestId("pricing-scope-all").evaluate((element) => getComputedStyle(element).accentColor);
    assert.notEqual(accent, "auto", "radios and checkboxes take the theme colour, not the browser's blue");
    await context.close();
  }
  pass("Bulk Pricing: the themed menu stays on a phone screen, and native radios and checkboxes use the theme colour");

  // ═══ dealer category correction ═══
  {
    const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: superCookie }, body: JSON.stringify({ companyId: 20, reason: "theme dropdown check" }) });
    assert.equal(act.status, 200, await act.clone().text());
    const acting = [superCookie, ...act.headers.getSetCookie().map((cookie) => cookie.split(";")[0])].join("; ");
    const { context, page } = await open(acting, { width: 1280, height: 900 }, "/admin/dealers");
    await page.getByTitle("View Dealer Details").locator("visible=true").first().click();
    await page.getByText("Correct category (Super Admin)").click();
    const select = page.getByTestId("dealer-category-select");
    await select.waitFor();
    await select.click();
    await shot(page, "dealer-category-menu-1280");
    await page.getByRole("option", { name: "Gold", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 1, "choosing an option does not close the dealer window");
    await page.getByLabel(/Reason \(kept in the history\)/).fill("Recognised legacy deliveries");
    await page.getByRole("button", { name: "Apply correction" }).click();
    let event = null;
    for (let i = 0; i < 100 && !event; i += 1) {
      event = await db.collection("dealercategoryevents").findOne({ dealerId: 3, source: "manual" });
      if (!event) await page.waitForTimeout(100);
    }
    assert.equal(event?.toCategory, "gold", "the category chosen in the dropdown is saved");
    await context.close();
  }
  pass("the dealer category correction saves through its themed dropdown, and choosing an option keeps the window open");

  console.log(`\nALL ${count} THEMED DROPDOWN TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-2500));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
