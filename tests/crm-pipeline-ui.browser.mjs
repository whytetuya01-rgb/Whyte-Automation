/**
 * CRM pipeline page (real Chromium, isolated production server, throwaway MongoDB): the board shows every stage with
 * counts and totals, the summary tiles add up, search waits for a pause, a card moves by drag and drop and by the
 * stage selector (the board updates at once and the change is saved), moving to Lost asks for a reason in a dialog
 * (not a browser prompt) and saves it, a failed move is rolled back, and the page fits 1280px and 375px with no
 * horizontal page scroll.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/crm-pipeline-ui.browser.mjs
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
const DAY = 86_400_000;

try {
  server = await startIsolatedServer("crm-pipeline", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = Date.now();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const lead = (id, name, status, extra = {}) => ({
    _id: id, companyId: 20, referenceNumber: `LD-${id}`, customerName: name, phone: "9000000000", projectType: "3 BHK Villa", estimatedBudget: 100000,
    status, priority: "medium", createdBy: 1, createdAt: new Date(now - 20 * DAY), updatedAt: new Date(now - 1 * DAY), ...extra,
  });
  await db.collection("leads").insertMany([
    lead("l1", "Asha Patel", "new", { priority: "urgent", estimatedBudget: 250000 }),
    lead("l2", "Brightway Builders", "new", { estimatedBudget: 400000 }),
    lead("l3", "Chirag Shah", "contacted", { priority: "high", updatedAt: new Date(now - 10 * DAY), nextFollowUpAt: new Date(now - 3 * DAY) }),
    lead("l4", "Dev Interiors", "site_visit", { estimatedBudget: 150000 }),
    lead("l5", "Esha Mehta", "quoted", { estimatedBudget: 300000 }),
    lead("l6", "Farhan Traders", "quoted", { notes: "Negotiation & customer revisions in progress", estimatedBudget: 500000, updatedAt: new Date(now - 16 * DAY) }),
    lead("l7", "Gita Residency", "won", { estimatedBudget: 800000 }),
    lead("l8", "Harsh Co", "lost", { estimatedBudget: 90000, lostReason: "Price" }),
  ]);
  const cookie = await login("owner@example.com", "admin");

  browser = await chromium.launch({ headless: true });
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let dialogs = 0;
    page.on("dialog", async (dialog) => { dialogs += 1; await dialog.dismiss(); });
    return { page, context, dialogCount: () => dialogs };
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };
  const column = (page, stage) => page.locator(`[data-testid="pipeline-column"][data-stage="${stage}"]`);
  const stageOf = async (id) => (await db.collection("leads").findOne({ _id: id })).status;

  // ── desktop board ──
  const { page, context, dialogCount } = await open({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pipeline-board").waitFor();
  assert.equal(await page.getByTestId("pipeline-column").count(), 7, "all seven stages");
  assert.equal(await column(page, "new").getByTestId("pipeline-card").count(), 2);
  assert.equal(await column(page, "quoted").getByTestId("pipeline-card").count(), 1);
  assert.equal(await column(page, "negotiation").getByTestId("pipeline-card").count(), 1, "a quoted lead with negotiation notes sits in Negotiation");
  assert.match(await column(page, "new").locator("header").innerText(), /2[\s\S]*6,50,000|2[\s\S]*650,000/, "the stage header shows its count and total");
  const summary = await page.getByTestId("pipeline-summary").innerText();
  assert.match(summary, /Open pipeline[\s\S]*6 open opportunities/i, `open = every stage except won and lost (summary was: ${JSON.stringify(summary)})`);
  assert.match(summary, /Closed won[\s\S]*1 deal won/i);
  assert.match(summary, /Needs attention\s*\n?\s*2/i, "two cards need attention: stuck 10 days / overdue follow-up, and stuck 16 days");
  assert.ok(await noHorizontalScroll(page), "no horizontal page scroll at 1280px (the board scrolls inside itself)");
  await column(page, "contacted").getByText("Overdue 3d").waitFor();
  await column(page, "negotiation").getByText("16d in stage").waitFor();
  await shot(page, "pipeline-1280");
  pass("the board shows all seven stages with counts and totals, summary tiles that add up, and stuck / overdue warnings");

  // ── search waits for a pause ──
  let pipelineRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/crm/pipeline")) pipelineRequests += 1; });
  await page.getByLabel("Search opportunities").pressSequentially("Brightway", { delay: 40 });
  await column(page, "new").getByTestId("pipeline-card").nth(0).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 1);
  assert.ok(pipelineRequests <= 2, `typing 9 letters made ${pipelineRequests} request(s), not one per key`);
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-card"]').length === 8);
  pass("search asks the server once after a pause in typing, and clearing it restores every card");

  // ── drag and drop ──
  await column(page, "new").getByTestId("pipeline-card").filter({ hasText: "Asha Patel" }).dragTo(column(page, "contacted"));
  await column(page, "contacted").getByTestId("pipeline-card").filter({ hasText: "Asha Patel" }).waitFor();
  await page.locator("text=Opportunity moved").first().waitFor();
  assert.equal(await stageOf("l1"), "contacted", "the move is saved");
  assert.equal(await column(page, "contacted").getByTestId("pipeline-card").count(), 2);
  pass("dragging a card to another stage moves it at once and saves the new status");

  // ── stage selector ──
  await column(page, "site_visit").getByTestId("pipeline-card").filter({ hasText: "Dev Interiors" }).getByTestId("pipeline-stage-select").selectOption("won");
  await column(page, "won").getByTestId("pipeline-card").filter({ hasText: "Dev Interiors" }).waitFor();
  for (let i = 0; i < 100 && (await stageOf("l4")) !== "won"; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await stageOf("l4"), "won");
  assert.match(await page.getByTestId("pipeline-summary").innerText(), /2 deals won/, "the summary follows the move");
  pass("the stage selector moves a card (the touch-friendly alternative) and the summary follows");

  // ── lost asks for a reason in a dialog ──
  await column(page, "new").getByTestId("pipeline-card").filter({ hasText: "Brightway" }).getByTestId("pipeline-stage-select").selectOption("lost");
  const form = page.getByTestId("lost-reason-form");
  await form.waitFor();
  assert.equal(await stageOf("l2"), "new", "nothing is saved until the reason is confirmed");
  await form.getByRole("button", { name: "Competitor" }).click();
  await shot(page, "pipeline-lost-dialog-1280");
  await form.getByTestId("lost-reason-confirm").click();
  await column(page, "lost").getByTestId("pipeline-card").filter({ hasText: "Brightway" }).waitFor();
  for (let i = 0; i < 100 && (await stageOf("l2")) !== "lost"; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const lost = await db.collection("leads").findOne({ _id: "l2" });
  assert.deepEqual([lost.status, lost.lostReason], ["lost", "Competitor"], "the status and reason are saved");
  assert.equal(dialogCount(), 0, "no browser prompt was used");
  await form.waitFor({ state: "hidden" });
  // cancelling leaves the card where it was
  await column(page, "new").getByTestId("pipeline-card").filter({ hasText: "Asha Patel" }).count();
  await column(page, "contacted").getByTestId("pipeline-card").filter({ hasText: "Chirag" }).getByTestId("pipeline-stage-select").selectOption("lost");
  await form.waitFor();
  await form.getByRole("button", { name: "Cancel" }).click();
  await form.waitFor({ state: "hidden" });
  assert.equal(await stageOf("l3"), "contacted", "cancelling the dialog moves nothing");
  assert.equal(await column(page, "contacted").getByTestId("pipeline-card").filter({ hasText: "Chirag" }).count(), 1);
  pass("moving to Lost asks for a reason in a dialog (quick reasons + free text), saves it, and cancelling moves nothing");

  // ── a failed move is rolled back ──
  await page.route("**/api/crm/leads/*/status", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Simulated failure" } }) }));
  await column(page, "quoted").getByTestId("pipeline-card").filter({ hasText: "Esha" }).getByTestId("pipeline-stage-select").selectOption("contacted");
  await page.locator("text=Failed to move opportunity").first().waitFor();
  await column(page, "quoted").getByTestId("pipeline-card").filter({ hasText: "Esha" }).waitFor();
  assert.equal(await stageOf("l5"), "quoted");
  await page.unroute("**/api/crm/leads/*/status");
  pass("a failed move puts the card back and says so");
  await context.close();

  // ── phone ──
  {
    // Earlier steps moved the "New" cards away; give this step its own card in the first column.
    await db.collection("leads").insertOne(lead("l9", "Phone Check", "new", { estimatedBudget: 120000 }));
    const { page: phone, context: phoneContext } = await open({ width: 375, height: 800 });
    await phone.goto(`${baseUrl}/admin/crm/pipeline`, { waitUntil: "domcontentloaded" });
    await phone.getByTestId("pipeline-board").waitFor();
    assert.ok(await noHorizontalScroll(phone), "no horizontal page scroll at 375px");
    const firstColumn = await column(phone, "new").boundingBox();
    assert.ok(firstColumn && firstColumn.x >= 0 && firstColumn.x + firstColumn.width <= 375, "a column fits the phone screen width");
    const select = column(phone, "new").getByTestId("pipeline-stage-select").first();
    const box = await select.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 375, "the stage selector is on screen");
    await column(phone, "new").getByTestId("pipeline-card").first().click();
    await phone.locator("text=Opportunity details, text=Lead").first().waitFor({ timeout: 5000 }).catch(() => {});
    await shot(phone, "pipeline-375");
    await phoneContext.close();
    pass("at 375px the page does not scroll sideways, a column fits the screen, and the stage selector is reachable");
  }

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
