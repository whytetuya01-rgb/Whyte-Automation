/**
 * Super-admin-only Activity Log: verifies the new /admin/activity screen and
 * its /api/admin/activity endpoint surface real audit events across every
 * dealer and admin action, that an "admin" (non-super_admin) account is
 * blocked from both the API and the page, and that filtering/search work.
 *
 *   node tests/browser-verify-activity-log.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const shotDir = process.argv[2] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, profileDir;
let exitCode = 0;
const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("activity-log", [
    { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
    { _id: 2, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 3, email: "dealer_a@example.com", role: "dealer", name: "Dealer Rohan", discountAllocationPercent: 15 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("housetypes").insertOne({ _id: 1, name: "2 BHK", isActive: true, sortOrder: 0 });

  const superAdmin = await login("super_admin@example.com", "admin");
  const admin = await login("admin_user@example.com", "admin");
  const dealerA = await login("dealer_a@example.com", "user");

  let seq = 9001;
  async function seedQuotation(cookie, clientName) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName, houseTypeId: 1 });
    assert.ok(res.status < 300, `create quotation: ${res.text}`);
    const id = res.data.id;
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId: id, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({
      _id: seq++, quotationRoomId: roomId, productId: 1, quantity: 1,
      unitPrice: Decimal128.fromString("5000.00"), sortOrder: 0,
    });
    return id;
  }

  // ── Generate a real, varied trail of audit events ──────────────────────
  // 1. Dealer creates and sends their own quotation.
  const dealerQuoteId = await seedQuotation(dealerA, "Dealer Client One");
  const sentRes = await api(dealerA, "POST", `/api/quotations/${dealerQuoteId}/mark-sent`, undefined);
  assert.ok(sentRes.status < 300, `dealer mark-sent: ${sentRes.text}`);

  // 2. Admin creates a quotation and assigns it to the dealer.
  const adminQuoteId = await seedQuotation(admin, "Admin Assigned Client");
  const assignRes = await api(admin, "POST", `/api/quotations/${adminQuoteId}/assign`, { dealerId: 3 });
  assert.ok(assignRes.status < 300, `admin assign: ${assignRes.text}`);

  // 3. Super admin approves the dealer's sent quotation.
  const approveRes = await api(superAdmin, "POST", `/api/quotations/${dealerQuoteId}/transition`, { action: "approve" });
  assert.ok(approveRes.status < 300, `approve: ${approveRes.text}`);

  // 4. Super admin creates, sends and rejects a third quotation.
  const rejectQuoteId = await seedQuotation(superAdmin, "Rejected Client");
  await api(superAdmin, "POST", `/api/quotations/${rejectQuoteId}/mark-sent`, undefined);
  const rejectRes = await api(superAdmin, "POST", `/api/quotations/${rejectQuoteId}/transition`, { action: "reject" });
  assert.ok(rejectRes.status < 300, `reject: ${rejectRes.text}`);

  pass("seeded a real audit trail: dealer create+send, admin create+assign, super admin approve+create+send+reject");

  // ── API-level access control (the real security boundary) ──────────────
  const adminBlocked = await api(admin, "GET", "/api/admin/activity");
  assert.equal(adminBlocked.status, 403, `admin role should be blocked, got ${adminBlocked.status}: ${adminBlocked.text}`);
  const dealerBlocked = await api(dealerA, "GET", "/api/admin/activity");
  assert.equal(dealerBlocked.status, 403, `dealer role should be blocked, got ${dealerBlocked.status}`);
  pass("GET /api/admin/activity returns 403 for both 'admin' and 'dealer' roles");

  const superAdminList = await api(superAdmin, "GET", "/api/admin/activity?pageSize=50");
  assert.ok(superAdminList.status < 300, `super admin list: ${superAdminList.text}`);
  const actions = superAdminList.data.data.map((e) => e.action);
  assert.ok(actions.includes("quotation_created"), "expected quotation_created in the feed");
  assert.ok(actions.includes("status_changed"), "expected status_changed (mark-sent) in the feed");
  assert.ok(actions.includes("quotation_assigned"), "expected quotation_assigned in the feed");
  assert.ok(actions.includes("quotation_approved"), "expected quotation_approved in the feed");
  assert.ok(actions.includes("quotation_rejected"), "expected quotation_rejected in the feed");
  const roles = new Set(superAdminList.data.data.map((e) => e.performedByRole));
  assert.ok(roles.has("dealer") && roles.has("admin") && roles.has("super_admin"), `expected all 3 roles represented, got: ${[...roles]}`);
  pass(`GET /api/admin/activity (super admin) returns the full trail: ${actions.length} events across roles [${[...roles].join(", ")}]`);

  // ── Browser: the actual page ─────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-activity-chrome-"));
  const port = 9400 + Math.floor(Math.random() * 300);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
    if (!target) await sleep(500);
  }
  assert.ok(target, "browser did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expression, label, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for: ${label}`);
  };
  await send("Page.enable"); await send("Runtime.enable");
  const setCookies = async (cookie) => {
    for (const pair of cookie.split("; ")) {
      const i = pair.indexOf("=");
      await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
    }
  };
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const shot = async (name) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  // Nav link must be hidden for a plain admin.
  await setCookies(admin);
  await send("Page.navigate", { url: `${baseUrl}/admin/dashboard` });
  await waitFor(`!!document.querySelector('aside')`, "admin dashboard render", 30000);
  const navHiddenForAdmin = await evaluate(`![...document.querySelectorAll('aside a')].some(a => /Activity Log/i.test(a.textContent))`);
  assert.ok(navHiddenForAdmin, "'Activity Log' nav link must not appear for an admin-role session");
  pass("'Activity Log' nav link is hidden from an admin-role session");

  // An admin hitting the URL directly sees the blocked message, not the data.
  await send("Page.navigate", { url: `${baseUrl}/admin/activity` });
  await waitFor(`/Super Admin Only/i.test(document.body.innerText)`, "admin blocked message", 15000);
  assert.doesNotMatch(await evaluate(`document.body.innerText`), /Dealer Rohan/);
  pass("admin role visiting /admin/activity directly sees the blocked message, no audit data");

  // Super admin: full page experience.
  await setCookies(superAdmin);
  await send("Page.navigate", { url: `${baseUrl}/admin/dashboard` });
  await waitFor(`!!document.querySelector('aside')`, "super admin dashboard render", 30000);
  const navVisibleForSuperAdmin = await evaluate(`[...document.querySelectorAll('aside a')].some(a => /Activity Log/i.test(a.textContent))`);
  assert.ok(navVisibleForSuperAdmin, "'Activity Log' nav link must appear for a super_admin session");
  pass("'Activity Log' nav link is visible for a super_admin session");

  await evaluate(`[...document.querySelectorAll('aside a')].find(a => /Activity Log/i.test(a.textContent)).click()`);
  await waitFor(`/Activity Log/.test(document.body.innerText) && document.querySelectorAll('tbody tr').length > 0`, "activity table render", 20000);
  await shot("01-activity-log-super-admin");

  const tableCheck = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasDealer: /Dealer Rohan/.test(text),
      hasAdmin: /Admin User/.test(text),
      hasSuperAdmin: /Super Admin/.test(text),
      hasApproved: /Approved this quotation/.test(text),
      hasRejected: /Rejected this quotation/.test(text),
      hasAssigned: /Assigned this quotation to Dealer Rohan/.test(text),
      rowCount: document.querySelectorAll('tbody tr').length,
    };
  })()`);
  assert.ok(tableCheck.hasDealer, "feed must show the dealer's name");
  assert.ok(tableCheck.hasAdmin, "feed must show the admin's name");
  assert.ok(tableCheck.hasSuperAdmin, "feed must show the super admin's name");
  assert.ok(tableCheck.hasApproved, "feed must describe the approval in plain English");
  assert.ok(tableCheck.hasRejected, "feed must describe the rejection in plain English");
  assert.ok(tableCheck.hasAssigned, "feed must describe the dealer assignment by name");
  pass(`activity table renders ${tableCheck.rowCount} real rows with actor names, roles, and human-readable descriptions`);

  // Filter by role = dealer.
  await evaluate(`[...document.querySelectorAll('button[aria-label="Filter by role"]')][0]?.click()`);
  await sleep(300);
  const roleOptionClicked = await evaluate(`(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find(o => /^Dealer$/i.test(o.textContent.trim()));
    if (!opt) return false;
    opt.click();
    return true;
  })()`);
  assert.ok(roleOptionClicked, "could not find the Dealer role filter option");
  await waitFor(`!document.body.innerText.includes('Admin User')`, "role filter narrows to dealer-only", 15000);
  const afterRoleFilter = await evaluate(`({ hasDealer: document.body.innerText.includes('Dealer Rohan'), hasAdmin: document.body.innerText.includes('Admin User'), hasSuperAdmin: /\\bSuper Admin\\b/.test(document.body.innerText) })`);
  assert.ok(afterRoleFilter.hasDealer, "dealer-only filter should still show the dealer's own event");
  assert.ok(!afterRoleFilter.hasAdmin, "dealer-only filter should hide admin-performed events");
  pass("role filter narrows the feed to dealer-performed events only");

  // Clear filters, then search by quotation number.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Clear all filters/i.test(b.textContent))?.click()`);
  await waitFor(`document.body.innerText.includes('Admin User')`, "filters cleared", 15000);
  const quotationNumber = await api(superAdmin, "GET", `/api/quotations/${dealerQuoteId}`).then((r) => r.data.quotationNumber);
  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder*="Search by person"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(quotationNumber)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(`!document.body.innerText.includes('Admin Assigned Client') && document.body.innerText.includes(${JSON.stringify(quotationNumber)})`, "search narrows results", 15000);
  pass(`search by quotation number ("${quotationNumber}") narrows the feed correctly`);
  await shot("02-activity-log-filtered");

  const relevantErrors = consoleErrors.filter(Boolean).filter((e) => !/favicon/i.test(e));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  pass("no console errors across the whole flow");

  console.log(`\nActivity log verification PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  if (chrome) spawn("taskkill", ["/pid", String(chrome.pid), "/t", "/f"], { stdio: "ignore" });
  if (server) await server.cleanup();
  await sleep(500);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
