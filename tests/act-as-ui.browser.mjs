/**
 * Browser check of the Super Admin "Act as company" UI (real Chromium via
 * Playwright against an isolated production server + throwaway Mongo).
 *
 * Playwright is not a project dependency. Point PLAYWRIGHT_MODULE at an
 * installed `playwright` package directory (with its Chromium downloaded):
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/act-as-ui.browser.mjs
 *
 * Optional: SCREENSHOT_DIR=<dir> saves screenshots of each state.
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

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "downgrade@example.com", role: "super_admin", name: "To Be Downgraded" },
  ];
  server = await startIsolatedServer("act-ui", USERS, { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: id === 10 ? "pending" : "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now,
    }))
  );
  const cookieHeader = {
    super: await login("super@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    downgrade: await login("downgrade@example.com", "admin"),
  };

  browser = await chromium.launch({ headless: true });
  const newPage = async (cookieString, viewport = { width: 1280, height: 800 }) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(
      cookieString.split("; ").filter(Boolean).map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
      })
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { context, page };
  };
  const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` }); };
  const logs = () => db.collection("platformaccesslogs");

  // ── Super Admin ──
  const { context: superCtx, page } = await newPage(cookieHeader.super);
  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-open"]');
  assert.equal(await page.locator('[data-testid="act-as-banner"]').count(), 0, "no banner before a session");
  await shot(page, "1-before");
  pass("Super Admin sees the 'Act as company' control and no banner before starting");

  // required reason + company selection
  await page.click('[data-testid="act-as-open"]');
  await page.waitForSelector('[data-testid="act-as-dialog"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="act-as-company"] option').length >= 3);
  const options = await page.locator('[data-testid="act-as-company"] option').allTextContents();
  assert.deepEqual(options, ["Select a company…", "Company 10 (pending)", "Company 20 (active)"]);
  const start = page.locator('[data-testid="act-as-start"]');
  assert.equal(await start.isDisabled(), true, "disabled with nothing chosen");
  await page.fill('[data-testid="act-as-reason"]', "browser test reason");
  assert.equal(await start.isDisabled(), true, "disabled with a reason but no company");
  await page.fill('[data-testid="act-as-reason"]', "   ");
  await page.selectOption('[data-testid="act-as-company"]', "20");
  assert.equal(await start.isDisabled(), true, "disabled with a company but a blank reason");
  await shot(page, "2-dialog");
  pass("the dialog lists companies and Start stays disabled until BOTH a company and a non-blank reason are given");

  // start
  await page.fill('[data-testid="act-as-reason"]', "browser test reason");
  assert.equal(await start.isDisabled(), false);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), start.click()]);
  await page.waitForSelector('[data-testid="act-as-banner"]');
  const chip = await page.locator('[data-testid="act-as-chip"]').innerText();
  assert.match(chip, /Acting as Company 20/);
  const banner = await page.locator('[data-testid="act-as-banner"]').innerText();
  assert.match(banner, /Company 20/);
  assert.match(banner, /Reason: browser test reason/);
  assert.match(banner, /Expires \d{1,2}:\d{2}/);
  const rows = await logs().find({}).toArray();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].superAdminUserId, rows[0].companyId, rows[0].reason, rows[0].endedAt], [1, 20, "browser test reason", null]);
  await shot(page, "3-acting");
  pass("starting shows the active-company chip + banner (company, reason, expiry) and writes one audit row");

  // survives navigation / reload
  await page.goto(`${baseUrl}/admin/users`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-banner"]');
  pass("the banner persists across navigation");

  // mobile layout
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForSelector('[data-testid="act-as-banner"]');
  const box = await page.locator('[data-testid="act-as-banner"]').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 376, "banner fits a 375px viewport");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal page scroll");
  await shot(page, "4-mobile");
  await page.setViewportSize({ width: 1280, height: 800 });
  pass("the banner fits a phone-width viewport without horizontal scroll");

  // server-side expiry: the displayed expiry follows startedAt; once expired the UI drops the grant on reload
  const id = rows[0]._id;
  await db.collection("platformaccesslogs").updateOne({ _id: id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 - 90) * 1000) } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-banner"]');
  const soon = new Date(Date.now() + 90 * 1000);
  const expText = (await page.locator('[data-testid="act-as-banner"]').innerText()).match(/Expires (\d{1,2}):(\d{2})/);
  assert.ok(expText, "expiry shown");
  assert.ok(Math.abs((Number(expText[1]) * 60 + Number(expText[2])) - (soon.getHours() * 60 + soon.getMinutes())) <= 2, `shown expiry ${expText[0]} matches startedAt + 4h`);
  await db.collection("platformaccesslogs").updateOne({ _id: id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 + 5) * 1000) } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-open"]');
  assert.equal(await page.locator('[data-testid="act-as-banner"]').count(), 0, "expired grant => no banner");
  pass("the banner shows startedAt + 4h; an expired grant disappears from the UI");

  // expiry noticed WHILE the page is open (60s poll, fast-forwarded with a fake clock)
  const { context: pollCtx, page: pollPage } = await newPage(cookieHeader.super);
  await pollPage.clock.install();
  await pollPage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await pollPage.waitForSelector('[data-testid="act-as-open"]');
  await pollPage.click('[data-testid="act-as-open"]');
  await pollPage.waitForFunction(() => document.querySelectorAll('[data-testid="act-as-company"] option').length >= 3);
  await pollPage.selectOption('[data-testid="act-as-company"]', "10");
  await pollPage.fill('[data-testid="act-as-reason"]', "poll test");
  await Promise.all([pollPage.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), pollPage.click('[data-testid="act-as-start"]')]);
  await pollPage.waitForSelector('[data-testid="act-as-banner"]');
  const live = await logs().findOne({ reason: "poll test" });
  await logs().updateOne({ _id: live._id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 + 5) * 1000) } });
  await pollPage.clock.install();
  await pollPage.clock.fastForward(65_000);
  await pollPage.waitForSelector('[data-testid="act-as-open"]', { timeout: 30000 });
  assert.equal(await pollPage.locator('[data-testid="act-as-banner"]').count(), 0);
  await pollCtx.close();
  pass("an open page notices the grant expiring on its next poll and drops company context");

  // exit
  const { page: exitPage } = await newPage(cookieHeader.super);
  await exitPage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await exitPage.waitForSelector('[data-testid="act-as-open"]');
  await exitPage.click('[data-testid="act-as-open"]');
  await exitPage.waitForFunction(() => document.querySelectorAll('[data-testid="act-as-company"] option').length >= 3);
  await exitPage.selectOption('[data-testid="act-as-company"]', "10");
  await exitPage.fill('[data-testid="act-as-reason"]', "exit test");
  await Promise.all([exitPage.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), exitPage.click('[data-testid="act-as-start"]')]);
  await exitPage.waitForSelector('[data-testid="act-as-exit"]');
  await Promise.all([exitPage.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), exitPage.click('[data-testid="act-as-exit"]')]);
  await exitPage.waitForSelector('[data-testid="act-as-open"]');
  assert.equal(await exitPage.locator('[data-testid="act-as-banner"]').count(), 0);
  const exited = await logs().findOne({ reason: "exit test" });
  assert.ok(exited.endedAt instanceof Date, "exit closed the audit row");
  await shot(exitPage, "5-after-exit");
  pass("Exit removes the chip/banner, shows 'Act as company' again and closes the audit row");

  // ── cancelling the dialog starts nothing ──
  const before = await logs().countDocuments({});
  await exitPage.click('[data-testid="act-as-open"]');
  await exitPage.keyboard.press("Escape").catch(() => {});
  await exitPage.click('button[aria-label="Close"]');
  assert.equal(await exitPage.locator('[data-testid="act-as-dialog"]').count(), 0);
  assert.equal(await logs().countDocuments({}), before);
  pass("closing the dialog starts no session");
  await superCtx.close();

  // ── unauthorized: a company Admin gets no control and the APIs refuse ──
  const { context: adminCtx, page: adminPage } = await newPage(cookieHeader.adminA);
  await adminPage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(2500);
  assert.equal(await adminPage.locator('[data-testid="act-as-control"]').count(), 0, "no act-as control for a company admin");
  assert.equal(await adminPage.locator('[data-testid="act-as-open"]').count(), 0);
  const refused = await adminPage.evaluate(async () => [
    (await fetch("/api/platform/companies")).status,
    (await fetch("/api/platform/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 20, reason: "x" }) })).status,
  ]);
  assert.deepEqual(refused, [403, 403]);
  await adminCtx.close();
  pass("a company Admin sees no Act-as control and its direct API calls are 403");

  // ── stale session: downgraded account is bounced to the login page ──
  const { context: staleCtx, page: stalePage } = await newPage(cookieHeader.downgrade);
  await stalePage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await stalePage.waitForSelector('[data-testid="act-as-open"]');
  await db.collection("adminusers").updateOne({ _id: 3 }, { $set: { role: "admin", companyId: 10 } });
  // the server caches validity for 30s; use a fresh navigation after the cache window by changing nothing else:
  await stalePage.waitForTimeout(31_000);
  await stalePage.goto(`${baseUrl}/admin/users`, { waitUntil: "domcontentloaded" });
  await stalePage.waitForURL(/\/admin\/login/, { timeout: 30000 });
  assert.equal(await stalePage.locator('[data-testid="act-as-control"]').count(), 0);
  await shot(stalePage, "6-stale-redirect");
  await staleCtx.close();
  pass("a session whose role was downgraded is redirected to /admin/login and never shows privileged navigation");

  console.log(`\nAct-as UI (browser) PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.cleanup();
  process.exit(exitCode);
}
