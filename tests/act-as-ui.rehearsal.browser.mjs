/**
 * Browser check (real Chromium via Playwright) of the Super Admin "Act as company" UI against a DISPOSABLE clone
 * of a MIGRATED rehearsal database. Loopback only.
 *
 *   SOURCE_DB=<migrated local database> PLAYWRIGHT_MODULE=<path>/node_modules/playwright \
 *     node tests/act-as-ui.rehearsal.browser.mjs
 *
 * SOURCE_DB is read, never written; it is cloned into whyte_rehearsal_drill_uiclone and the app + browser use the
 * clone only (test passwords are set, act-as rows and role downgrades are written there).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const SOURCE = process.env.SOURCE_DB;
const CLONE = "whyte_rehearsal_drill_uiclone";
if (!SOURCE || !/^whyte_rehearsal_[a-z0-9_]+$/.test(SOURCE) || !process.env.PLAYWRIGHT_MODULE) {
  console.error("NOT RUN: set SOURCE_DB (a whyte_rehearsal_* database) and PLAYWRIGHT_MODULE.");
  process.exit(2);
}
assert.equal(process.env.MONGODB_URI, undefined, "MONGODB_URI must not be set");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const results = [];
const pass = (name) => { results.push(name); console.log(`  PASS  ${name}`); };
let server;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;

try {
  const mongo = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", { serverSelectionTimeoutMS: 5000 });
  await mongo.connect();
  const src = mongo.db(SOURCE);
  await mongo.db(CLONE).dropDatabase();
  const dst = mongo.db(CLONE);
  for (const { name } of await src.listCollections({}, { nameOnly: true }).toArray()) {
    await dst.createCollection(name);
    const docs = await src.collection(name).find({}).toArray();
    for (let i = 0; i < docs.length; i += 500) await dst.collection(name).insertMany(docs.slice(i, i + 500));
    for (const idx of await src.collection(name).indexes()) {
      if (idx.name === "_id_") continue;
      const { key, name: iname, v, ...opts } = idx;
      await dst.collection(name).createIndex(key, { ...opts, name: iname });
    }
  }
  assert.equal((await dst.collection("companies").findOne({ _id: 1 })).status, "pending");
  assert.equal((await dst.collection("adminusers").findOne({ _id: 8 })).role, "admin", "SOURCE_DB must be a migrated copy");
  const hash = await bcrypt.hash("Password123!", 10);
  await dst.collection("adminusers").updateMany({ _id: { $in: [5, 8, 11] } }, { $set: { passwordHash: hash } });
  const emailOf = async (id) => (await dst.collection("adminusers").findOne({ _id: id })).email;
  const companyName = (await dst.collection("companies").findOne({ _id: 1 })).name;
  const E = { super: await emailOf(5), admin: await emailOf(8), downgrade: await emailOf(11) };
  await mongo.close();

  server = await startIsolatedServer("uiclone", [], { production: true, existingDatabase: CLONE });
  const { db, login, baseUrl } = server;
  const cookieHeader = { super: await login(E.super, "admin"), admin: await login(E.admin, "admin"), downgrade: await login(E.downgrade, "admin") };

  browser = await chromium.launch({ headless: true });
  const newPage = async (cookieString, viewport = { width: 1280, height: 800 }) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookieString.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { context, page };
  };
  const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` }); };
  const logs = () => db.collection("platformaccesslogs");
  const navAndStart = (page, locator) => Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), locator.click()]);
  const optionsReady = (page) => page.waitForFunction(() => document.querySelectorAll('[data-testid="act-as-company"] option').length >= 2);

  // ── Super Admin ──
  const { context: superCtx, page } = await newPage(cookieHeader.super);
  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-open"]');
  assert.equal(await page.locator('[data-testid="act-as-banner"]').count(), 0);
  pass("Super Admin sees the Act-as control and no banner before starting");

  await page.click('[data-testid="act-as-open"]');
  await optionsReady(page);
  assert.deepEqual(await page.locator('[data-testid="act-as-company"] option').allTextContents(), ["Select a company…", `${companyName} (pending)`]);
  const start = page.locator('[data-testid="act-as-start"]');
  assert.equal(await start.isDisabled(), true);
  await page.selectOption('[data-testid="act-as-company"]', "1");
  assert.equal(await start.isDisabled(), true, "company chosen, no reason");
  await page.fill('[data-testid="act-as-reason"]', "   ");
  assert.equal(await start.isDisabled(), true, "blank reason");
  pass(`the dialog lists the migrated company (${companyName}, pending); Start stays disabled until company AND a non-blank reason are given`);

  await page.fill('[data-testid="act-as-reason"]', "migration rehearsal UI check");
  await navAndStart(page, start);
  await page.waitForSelector('[data-testid="act-as-banner"]');
  assert.match(await page.locator('[data-testid="act-as-chip"]').innerText(), new RegExp(`Acting as ${companyName}`));
  const banner = await page.locator('[data-testid="act-as-banner"]').innerText();
  assert.match(banner, /Reason: migration rehearsal UI check/);
  assert.match(banner, /Expires \d{1,2}:\d{2}/);
  const row = await logs().findOne({ reason: "migration rehearsal UI check" });
  assert.deepEqual([row.superAdminUserId, row.companyId, row.endedAt], [5, 1, null]);
  await shot(page, "ui-1-acting");
  pass("start shows chip + banner (company, reason, expiry) and writes one audit row for company 1");

  // the migrated data is actually visible while acting
  await page.goto(`${baseUrl}/admin/products`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-banner"]');
  await page.waitForFunction(() => document.body.innerText.length > 500);
  const bodyActing = await page.evaluate(() => document.body.innerText);
  assert.ok(!/no products/i.test(bodyActing.slice(0, 4000)) || bodyActing.length > 800, "products page rendered");
  const apiCount = await page.evaluate(async () => { const r = await fetch("/api/products"); const j = await r.json(); return (j.data ?? j).length; });
  assert.equal(apiCount, 295, "the migrated catalog (295 active products) is visible while acting");
  await shot(page, "ui-2-products");
  pass("while acting, the products screen/API shows the migrated catalog (295 active products)");

  // expiry display + server-side expiry on reload
  await db.collection("platformaccesslogs").updateOne({ _id: row._id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 - 90) * 1000) } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-banner"]');
  const m = (await page.locator('[data-testid="act-as-banner"]').innerText()).match(/Expires (\d{1,2}):(\d{2})/);
  const soon = new Date(Date.now() + 90_000);
  assert.ok(m && Math.abs(Number(m[1]) * 60 + Number(m[2]) - (soon.getHours() * 60 + soon.getMinutes())) <= 2, "expiry matches startedAt + 4h");
  await db.collection("platformaccesslogs").updateOne({ _id: row._id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 + 5) * 1000) } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="act-as-open"]');
  assert.equal(await page.locator('[data-testid="act-as-banner"]').count(), 0);
  const apiExpired = await page.evaluate(async () => { const r = await fetch("/api/products"); const j = await r.json(); return (j.data ?? j).length; });
  assert.equal(apiExpired, 0, "expired grant => no company data");
  pass("the displayed expiry is start + 4h; once expired the UI drops the grant and the API shows no company data");

  // exit
  await page.click('[data-testid="act-as-open"]');
  await optionsReady(page);
  await page.selectOption('[data-testid="act-as-company"]', "1");
  await page.fill('[data-testid="act-as-reason"]', "exit check");
  await navAndStart(page, page.locator('[data-testid="act-as-start"]'));
  await page.waitForSelector('[data-testid="act-as-exit"]');
  await navAndStart(page, page.locator('[data-testid="act-as-exit"]'));
  await page.waitForSelector('[data-testid="act-as-open"]');
  assert.ok((await logs().findOne({ reason: "exit check" })).endedAt instanceof Date);
  pass("Exit clears the context and closes the audit row");
  await superCtx.close();

  // ── company Admin (id 8) ──
  const { context: adminCtx, page: adminPage } = await newPage(cookieHeader.admin);
  await adminPage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(2500);
  assert.equal(await adminPage.locator('[data-testid="act-as-control"]').count(), 0);
  const refused = await adminPage.evaluate(async () => [(await fetch("/api/platform/companies")).status, (await fetch("/api/platform/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 1, reason: "x" }) })).status]);
  assert.deepEqual(refused, [403, 403]);
  const adminProducts = await adminPage.evaluate(async () => { const r = await fetch("/api/products"); const j = await r.json(); return (j.data ?? j).length; });
  assert.equal(adminProducts, 295, "the migrated company Admin sees the company catalog");
  await adminCtx.close();
  pass("the migrated company Admin (id 8) sees no Act-as control, direct API calls are 403, and the company catalog is visible");

  // ── stale session: id 11 is downgraded (admin -> sales_executive) after sign-in ──
  const { context: staleCtx, page: stalePage } = await newPage(cookieHeader.downgrade);
  await stalePage.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await stalePage.waitForSelector('[data-testid="admin-sidebar"], nav, aside', { timeout: 30000 }).catch(() => {});
  await db.collection("adminusers").updateOne({ _id: 11 }, { $set: { role: "sales_executive" } });
  await stalePage.waitForTimeout(31_000); // the server caches validity for 30s
  await stalePage.goto(`${baseUrl}/admin/users`, { waitUntil: "domcontentloaded" });
  await stalePage.waitForURL((u) => !/\/admin\/users/.test(u.toString()), { timeout: 30000 });
  const landed = new URL(stalePage.url()).pathname;
  assert.ok(landed === "/admin/login" || landed === "/" || landed === "/login", `redirected away from the admin panel to ${landed}`);
  assert.equal(await stalePage.locator('[data-testid="act-as-control"]').count(), 0);
  await staleCtx.close();
  pass(`a downgraded session is redirected away from the admin panel (landed on ${landed}) and shows no privileged navigation`);

  console.log(`\nAct-as UI against a migrated clone: ${results.length} checks, all PASS.`);
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.cleanup();
  process.exit(exitCode);
}
