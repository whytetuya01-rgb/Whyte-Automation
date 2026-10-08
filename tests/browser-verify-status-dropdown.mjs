/**
 * Browser verification: the inline status-change dropdown on the admin
 * Quotations grid must not be clipped by the table's scroll/overflow
 * wrappers when it opens upward (the bug reported from a real screenshot:
 * the popover was cut off, overlapping the row above and the column header).
 *
 *   node tests/browser-verify-status-dropdown.mjs [screenshotDir]
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
  server = await startIsolatedServer("status-dropdown", [{ _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, api, baseUrl } = server;

  // Enough rows that the last one sits near the bottom of a normal-height
  // viewport, forcing its popover to open upward — exactly the reported case.
  const cookie = await login("super_admin@example.com", "admin");
  let firstQuotationId;
  for (let i = 0; i < 9; i++) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName: `Dropdown Check ${i + 1}` });
    assert.ok(res.status < 300, `create quotation ${i}: ${res.text}`);
    if (i === 0) firstQuotationId = res.data.id;
  }
  // The list sorts newest first, so the row at the BOTTOM of the table (the
  // one whose popover gets clicked through below) is the first one created.
  // Give it a product so the Draft -> Sent transition it triggers actually
  // succeeds (a quotation with 0 products is correctly rejected elsewhere).
  const roomId = 9001;
  await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId: firstQuotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("quotationitems").insertOne({
    _id: 9002,
    quotationRoomId: roomId,
    productId: 1,
    quantity: 1,
    unitPrice: Decimal128.fromString("1000.00"),
    sortOrder: 0,
  });

  profileDir = await mkdtemp(join(tmpdir(), "whyte-dropdown-chrome-"));
  const port = 9700 + Math.floor(Math.random() * 300);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1366,760", "about:blank"], { stdio: "ignore" });
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
  for (const pair of cookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const shot = async (name) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  await send("Page.navigate", { url: `${baseUrl}/admin/quotations?pageSize=20` });
  await waitFor(`document.querySelectorAll('table tbody tr').length >= 9`, "quotations table render", 30000);
  pass("admin quotations table rendered with 9 rows");

  // Open the LAST row's status dropdown (closest to the viewport bottom —
  // the exact condition that produced the clipped popover in the report).
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const lastRow = rows[rows.length - 1];
    lastRow.querySelector('button[aria-label="Change quotation status"]').scrollIntoView({ block: 'center' });
  })()`);
  // Let the scroll fully settle before opening — the dropdown intentionally
  // closes itself on page scroll (see test below), so opening mid-scroll
  // would be closed again by its own trailing scroll events.
  await sleep(500);
  const openInfo = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const lastRow = rows[rows.length - 1];
    const trigger = lastRow.querySelector('button[aria-label="Change quotation status"]');
    const beforeRect = trigger.getBoundingClientRect();
    trigger.click();
    return { triggerBottom: beforeRect.bottom, viewportHeight: window.innerHeight };
  })()`);
  console.log("openInfo:", JSON.stringify(openInfo));
  await sleep(350);
  const bodyHasListbox = await evaluate(`!!document.querySelector('ul[role="listbox"]')`);
  console.log("bodyHasListbox:", bodyHasListbox, "consoleErrors:", JSON.stringify(consoleErrors));
  await shot("debug-after-click");

  const popoverCheck = await evaluate(`(() => {
    const popover = document.querySelector('ul[role="listbox"]')?.closest('div');
    if (!popover) return { found: false };
    // Must be portalled directly onto <body>, not nested inside the
    // overflow-hidden table card — that is what makes it immune to clipping.
    const portalledToBody = popover.parentElement === document.body;
    const style = getComputedStyle(popover);
    const options = [...popover.querySelectorAll('[role="option"]')];
    const rect = popover.getBoundingClientRect();
    // Every option must be the actual hit-target at its own center point —
    // if an ancestor were clipping the popover, a clipped option would
    // resolve to something else (or nothing) at that point.
    const allOptionsHittable = options.every((opt) => {
      const r = opt.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && opt.contains(hit);
    });
    return {
      found: true,
      portalledToBody,
      position: style.position,
      optionCount: options.length,
      optionLabels: options.map((o) => o.textContent.trim()),
      allOptionsHittable,
      withinViewportTop: rect.top >= 0,
      withinViewportBottom: rect.bottom <= window.innerHeight,
    };
  })()`);

  assert.ok(popoverCheck.found, "status dropdown popover did not render");
  assert.ok(popoverCheck.portalledToBody, "popover must be portalled onto <body>, not nested in the clipped table wrapper");
  assert.equal(popoverCheck.position, "fixed", "popover must use fixed positioning");
  assert.equal(popoverCheck.optionCount, 5, `expected all 5 status options, got ${popoverCheck.optionCount}: ${JSON.stringify(popoverCheck.optionLabels)}`);
  assert.deepEqual(popoverCheck.optionLabels, ["Draft", "Sent", "Approved", "Rejected", "Delivered"]);
  assert.ok(popoverCheck.allOptionsHittable, "every option must be the real hit-target at its own position (nothing clipping it)");
  assert.ok(popoverCheck.withinViewportTop, "popover must not be pushed off the top of the viewport");
  assert.ok(popoverCheck.withinViewportBottom, "popover must not be pushed off the bottom of the viewport");
  pass(`status dropdown for the bottom row shows all 5 options, fully unclipped (portalled fixed-position): ${popoverCheck.optionLabels.join(", ")}`);
  await shot("01-status-dropdown-open-unclipped");

  // Selecting an option must still work end-to-end (click goes through to the
  // real target, not to whatever used to be rendered on top of a clipped item).
  await evaluate(`(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'Sent');
    opt.click();
  })()`);
  await waitFor(`!document.querySelector('ul[role="listbox"]')`, "popover closes after selection", 10000);
  await sleep(600);
  const afterSelect = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const lastRow = rows[rows.length - 1];
    const trigger = lastRow.querySelector('button[aria-label="Change quotation status"]');
    return trigger.textContent.trim();
  })()`);
  assert.match(afterSelect, /Sent/);
  pass("clicking an option through the portal actually selects it (Draft -> Sent)");

  // Scrolling the page while open must close the popover rather than leave a
  // stale, misplaced one floating on screen.
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    rows[0].querySelector('button[aria-label="Change quotation status"]').scrollIntoView({ block: 'center' });
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    rows[0].querySelector('button[aria-label="Change quotation status"]').click();
  })()`);
  await sleep(350);
  const openBeforeScroll = await evaluate(`!!document.querySelector('ul[role="listbox"]')`);
  assert.equal(openBeforeScroll, true, "popover should be open before scrolling");
  // Dispatch a scroll event the way a real page-level scroll fires one — on
  // \`document\`, bubbling up through window's capture-phase listener — since
  // this page's 9 rows may not actually overflow the test viewport, making a
  // real window.scrollBy a no-op. (Dispatching directly on \`window\` would
  // set e.target to window itself, which real scroll events never do.)
  await evaluate(`document.dispatchEvent(new Event('scroll', { bubbles: true }))`);
  await sleep(300);
  const openAfterScroll = await evaluate(`!!document.querySelector('ul[role="listbox"]')`);
  assert.equal(openAfterScroll, false, "popover should close on page scroll rather than float in a stale position");
  pass("scrolling the page closes the popover instead of leaving it floating in the wrong place");

  console.log(`\nStatus dropdown clipping verification PASSED (${results.length} checks).`);
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
