import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Real-browser verification of the Dealer earnings dashboard and the customer
 * discount cap. Drives a headless Chrome/Edge through the DevTools protocol
 * (no extra dependencies) against an isolated server and throwaway database.
 *
 * Screenshots are written to the directory given as argv[2] (optional).
 */

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const { existsSync } = await import("node:fs");
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const shotDir = process.argv[2] || null;

const { assertCase, summary } = createRunner();
let server;
let chrome;
let profileDir;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "eval failed");
    return res.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  server = await startIsolatedServer("browser", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20 },
    { _id: 3, email: "admin_user@example.com", role: "admin", name: "Admin User" },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const dealerCookie = await login("dealer_a@example.com", "user");
  const admin = await login("admin_user@example.com", "admin");

  // Minimal catalog so the Review step can render line items.
  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, isActive: true, sortOrder: 1 });
  await db.collection("products").insertOne({
    _id: 1, name: "Touch Switch", code: "TS-1", type: "switch_board", categoryId: 1,
    price: Decimal128.fromString("100000.00"), isActive: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  });
  let seq = 1000;
  async function quoteWithSubtotal(cookie, body, amount) {
    const res = await api(cookie, "POST", "/api/quotations", { clientName: "Browser Client", ...body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId: res.data.id, sortOrder: 0, customName: "Living", createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({
      _id: seq++, quotationRoomId: roomId, productId: 1, quantity: 1,
      unitPrice: Decimal128.fromString(amount.toFixed(2)), sortOrder: 0,
    });
    return res.data.id;
  }

  // Approved quotation (10% earning), same one then Delivered (must not double), plus a Draft.
  const approvedId = await quoteWithSubtotal(dealerCookie, {}, 100000);
  await api(dealerCookie, "PATCH", `/api/quotations/${approvedId}`, { discountType: "percentage", discountValue: 10, customerDiscountPercent: 10 });
  await api(admin, "POST", `/api/quotations/${approvedId}/mark-sent`);
  await api(admin, "POST", `/api/quotations/${approvedId}/transition`, { action: "approve" });
  const draftId = await quoteWithSubtotal(dealerCookie, {}, 50000);

  profileDir = await mkdtemp(join(tmpdir(), "whyte-chrome-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  chrome = spawn(browserPath, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--disable-gpu", "--window-size=1440,1000", "about:blank",
  ], { stdio: "ignore" });

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch { /* browser starting */ }
    if (!target) await sleep(500);
  }
  assert.ok(target, "browser did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  const diagnostics = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") diagnostics.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 400));
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) diagnostics.push(`CONSOLE.${msg.params.type} ${msg.params.args.map((x) => x.value ?? x.description ?? "").join(" ")}`.slice(0, 400));
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) diagnostics.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
    if (msg.method === "Network.loadingFailed") diagnostics.push(`NETFAIL ${msg.params.errorText} ${msg.params.blockedReason ?? ""}`);
  });

  for (const pair of dealerCookie.split("; ")) {
    const idx = pair.indexOf("=");
    await cdp.send("Network.setCookie", { name: pair.slice(0, idx), value: pair.slice(idx + 1), url: baseUrl });
  }

  async function open(path, waitFor) {
    await cdp.send("Page.navigate", { url: `${baseUrl}${path}` });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(700);
      try {
        const text = await cdp.eval("document.body ? document.body.innerText : ''");
        if (text.toLowerCase().includes(waitFor.toLowerCase())) {
          // Server-rendered text appears before React hydrates; interactions need hydration.
          await waitForHydration();
          return (await cdp.eval("document.body.innerText")) || text;
        }
      } catch { /* navigating */ }
    }
    throw new Error(`timed out waiting for "${waitFor}" on ${path}`);
  }
  async function waitForHydration() {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const hydrated = await cdp.eval(`(() => {
        const el = document.querySelector('header') || document.body.firstElementChild;
        return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
      })()`).catch(() => false);
      if (hydrated) return;
      await sleep(500);
    }
    throw new Error("page never hydrated");
  }
  async function shot(name) {
    if (!shotDir) return;
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await mkdir(shotDir, { recursive: true });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(data, "base64"));
  }

  await assertCase("Browser: Dealer home shows Confirmed Earnings ₹10,000 for the Approved quotation", async () => {
    const text = await open("/", "Confirmed Earnings");
    assert.match(text.replace(/\s+/g, " "), /Confirmed Earnings\s*₹\s?10,000/i);
    await shot("dealer-home-approved");
  });

  await assertCase("Browser: Earnings page lists the approved quotation with its confirmed earning", async () => {
    // The earnings page loads its numbers client-side, so wait for the amount itself.
    const text = await open("/earnings", "₹10,000");
    const flat = text.replace(/\s+/g, " ");
    assert.match(flat, /Confirmed Earnings/i);
    assert.ok(flat.includes("₹10,000"), "confirmed earning of ₹10,000 must be visible");
    await shot("dealer-earnings-approved");
  });

  await assertCase("Browser: Delivered does not double the confirmed earning", async () => {
    await api(admin, "POST", `/api/quotations/${approvedId}/transition`, { action: "deliver" });
    const home = (await open("/", "Confirmed Earnings")).replace(/\s+/g, " ");
    assert.match(home, /Confirmed Earnings\s*₹\s?10,000(?!\d|,)/i);
    const earn = (await open("/earnings", "₹10,000")).replace(/\s+/g, " ");
    await shot("dealer-earnings-delivered");
    // The Confirmed Earnings card, not the Estimated Commission card (which also counts the draft).
    const card = earn.match(/Confirmed Earnings\s+Unlocked\s+₹\s?([\d,]+(?:\.\d+)?)/i);
    assert.ok(card, `Confirmed Earnings card not found in: ${earn.slice(0, 400)}`);
    assert.equal(card[1], "10,000", "Approved -> Delivered must not double the confirmed earning");
  });

  await assertCase("Browser: discount input shows 'Maximum allowed' and rejects values above the allocation", async () => {
    await open(`/quotation/${draftId}?step=4`, "Customer Discount");
    // Choose Percentage in the custom Select, then type 25 into the number input.
    // The page may still be hydrating in dev mode, so retry the click until the list opens.
    await cdp.eval(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const findOption = () => [...document.querySelectorAll('[role="option"]')].find((o) => /percentage/i.test(o.innerText));
      for (let i = 0; i < 40 && !findOption(); i++) {
        const trigger = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => /no discount/i.test(b.innerText));
        if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
        await wait(500);
      }
      findOption().click();
      await wait(300);
    })()`);
    let text = (await cdp.eval("document.body.innerText")).replace(/\s+/g, " ");
    assert.match(text, /Maximum allowed: 20%/i, "maximum allowed must be shown near the input");
    assert.match(text, /Allocated: 20%/i);
    assert.ok(!/cannot exceed/i.test(text), "no warning for a valid (empty) value");

    await cdp.eval(`(() => {
      const input = document.querySelector('input[type="number"][max]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '25');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
    text = (await cdp.eval("document.body.innerText")).replace(/\s+/g, " ");
    assert.match(text, /Customer discount cannot exceed your allocated discount of 20%\./i);
    const applyDisabled = await cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Apply').disabled`);
    assert.equal(applyDisabled, true, "Apply must be disabled above the cap");
    await shot("discount-over-cap");

    await cdp.eval(`(() => {
      const input = document.querySelector('input[type="number"][max]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
    text = (await cdp.eval("document.body.innerText")).replace(/\s+/g, " ");
    assert.ok(!/cannot exceed/i.test(text), "no warning for a valid value");
    assert.match(text, /Estimated Earning \(5%\)/i);
    await shot("discount-valid");
  });

  await assertCase("Browser: the API still rejects an excessive discount when the UI is bypassed (from the page's own session)", async () => {
    const result = await cdp.eval(`fetch('/api/quotations/${draftId}', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountType: 'percentage', discountValue: 25, customerDiscountPercent: 25 })
    }).then(async (r) => ({ status: r.status, body: await r.text() }))`);
    assert.equal(result.status, 400);
    assert.match(result.body, /cannot exceed your allocated discount of 20%/);
  });

  await assertCase("Browser: Approved quotation Review shows 'Confirmed Earnings' (not 'Estimated')", async () => {
    await open(`/quotation/${approvedId}?step=4`, "Customer Discount");
    const text = (await cdp.eval("document.body.innerText")).replace(/\s+/g, " ");
    assert.match(text, /Confirmed Earnings \(10%\):\s*₹10,000/i);
    assert.ok(!/Estimated Earning/i.test(text));
    await shot("approved-review-confirmed");
  });

  if (diagnostics.length > 0) {
    console.log("BROWSER DIAGNOSTICS:");
    for (const line of [...new Set(diagnostics)].slice(0, 25)) console.log(`  ${line}`);
  }
  const failures = summary();
  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (chrome) {
    try { spawn("taskkill", ["/pid", String(chrome.pid), "/t", "/f"], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  if (server) await server.cleanup();
  await sleep(500);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(process.exitCode ?? 0);
}
