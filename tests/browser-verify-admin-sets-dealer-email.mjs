/**
 * Admins can now set a dealer's Company Name + Business Email directly from
 * the admin Dealers page (new "Edit Details" modal), and it must then show
 * under Authorized Dealer on that dealer's proposals.
 *
 *   node tests/browser-verify-admin-sets-dealer-email.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, profileDir;
let exitCode = 0;

try {
  server = await startIsolatedServer("admin-set-email", [
    { _id: 1, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    {
      _id: 2, email: "dealer.login@example.com", role: "dealer", name: "Raj Mehta",
      firstName: "Raj", lastName: "Mehta", contactNumber: "+91 90000 00000", gstNumber: "24AAAAA0000A1Z8",
    },
  ], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("housetypes").insertOne({ _id: 1, name: "2 BHK", isActive: true, sortOrder: 0 });
  await db.collection("products").insertOne({
    _id: 1, name: "Touch Curtain Switch", isActive: true, categoryId: 1,
    price: Decimal128.fromString("5000.00"), priceWithoutTax: Decimal128.fromString("4237.29"),
    taxPercent: Decimal128.fromString("18.00"), cost: Decimal128.fromString("2000.00"),
    purchaseTaxPercent: Decimal128.fromString("18.00"),
  });

  const admin = await login("admin_user@example.com", "admin");

  const quotRes = await api(admin, "POST", "/api/quotations", { clientName: "Test Client", houseTypeId: 1 });
  assert.ok(quotRes.status < 300, `quotation create: ${quotRes.text}`);
  const quotId = quotRes.data.id;
  await db.collection("quotationrooms").insertOne({ _id: 9101, quotationId: quotId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("quotationitems").insertOne({
    _id: 9102, quotationRoomId: 9101, productId: 1, quantity: 1,
    unitPrice: Decimal128.fromString("5000.00"), sortOrder: 0,
  });
  const assignRes = await api(admin, "POST", `/api/quotations/${quotId}/assign`, { dealerId: 2 });
  assert.ok(assignRes.status < 300, `assign: ${assignRes.text}`);

  profileDir = await mkdtemp(join(tmpdir(), "whyte-admin-set-email-chrome-"));
  const port = 9450 + Math.floor(Math.random() * 300);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1200,1400", "about:blank"], { stdio: "ignore" });
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
  const networkLog = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Network.responseReceived" && /\/api\/admin\/dealers\/\d+$/.test(msg.params.response.url)) {
      networkLog.push({ url: msg.params.response.url, status: msg.params.response.status });
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
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  for (const pair of admin.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  await send("Page.navigate", { url: `${baseUrl}/admin/dealers` });
  await waitFor(`!!document.querySelector('table')`, "dealers table render", 30000);
  await sleep(500);

  const clicked = await evaluate(`
    (function() {
      const btn = document.querySelector('button[title*="Edit Company Name"]');
      if (!btn) return 'NO_BUTTON';
      btn.click();
      return 'CLICKED';
    })()
  `);
  assert.equal(clicked, "CLICKED", "Edit Details button not found in the dealers table");
  await sleep(400);

  const setReactInputValue = async (labelText, value) => {
    const expr = `
      (function() {
        const label = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
        if (!label) return 'NO_LABEL';
        const input = label.closest('div').querySelector('input');
        if (!input) return 'NO_INPUT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()
    `;
    const result = await evaluate(expr);
    assert.ok(result !== "NO_LABEL" && result !== "NO_INPUT", `input for "${labelText}" not found (${result})`);
  };

  await setReactInputValue("Company Name", "Mehta Automation LLP");
  await setReactInputValue("Business Email", "contact@mehtaautomation.in");
  await sleep(200);

  const saveClicked = await evaluate(`
    (function() {
      const btn = [...document.querySelectorAll('button')].find(b => /Save Details/i.test(b.textContent));
      if (!btn) return 'NO_BUTTON';
      btn.click();
      return 'CLICKED';
    })()
  `);
  assert.equal(saveClicked, "CLICKED", "Save Details button not found");

  const deadline = Date.now() + 10000;
  while (networkLog.length === 0 && Date.now() < deadline) await sleep(200);
  assert.ok(networkLog.length > 0, "no PATCH /api/admin/dealers/:id request was sent");
  assert.ok(networkLog[0].status < 300, `PATCH failed with status ${networkLog[0].status}`);
  await sleep(800);

  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotId}/preview` });
  await waitFor(`!!document.querySelector('.proposal-page')`, "proposal render", 30000);
  await sleep(300);
  const text = await evaluate(`document.body.innerText`);

  assert.match(text, /AUTHORIZED DEALER/i);
  assert.match(text, /Mehta Automation LLP/);
  assert.match(text, /contact@mehtaautomation\.in/);
  assert.doesNotMatch(text, /dealer\.login@example\.com/);
  console.log("  ✓ Admin-set Company Name + Business Email appear under Authorized Dealer; login email never shown");

  console.log("\nAdmin-sets-dealer-email verification PASSED.");
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
