/**
 * Reproduces: "Company name and email are not storing in DB — after page
 * refresh it reverts." Drives the REAL /profile UI (fills inputs, clicks
 * Save, reloads the page) rather than calling the PATCH API directly, to
 * catch a frontend-only bug the direct-API test wouldn't see.
 *
 *   node tests/browser-verify-profile-save.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, profileDir;
let exitCode = 0;

try {
  server = await startIsolatedServer("profile-save", [
    {
      _id: 2, email: "dealer@example.com", role: "dealer", name: "Old Name",
      firstName: "Old", lastName: "Name",
      contactNumber: "+91 98765 11223", gstNumber: "24AAAAA0000A1Z8",
      companyName: "Old Company", address: "Old Address, Ahmedabad",
    },
  ], { production: true });
  const { login, baseUrl } = server;

  const dealerCookie = await login("dealer@example.com", "user");

  profileDir = await mkdtemp(join(tmpdir(), "whyte-profile-save-chrome-"));
  const port = 9350 + Math.floor(Math.random() * 300);
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
    } else if (msg.method === "Network.responseReceived" && msg.params.response.url.includes("/api/dealer/profile")) {
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
  for (const pair of dealerCookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  await send("Page.navigate", { url: `${baseUrl}/profile` });
  await waitFor(`!!document.querySelector('input')`, "profile form render", 30000);
  await sleep(500);

  // Sets a React-controlled <input>'s value the way a real user typing
  // would — dispatching the native input event so React's onChange fires
  // (plain `.value = x` alone does NOT trigger a controlled-input update).
  const setReactInputValue = async (labelText, value) => {
    const expr = `
      (function() {
        const label = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
        if (!label) return 'NO_LABEL';
        const input = label.closest('div').querySelector('input') || document.getElementById(label.getAttribute('for'));
        if (!input) return 'NO_INPUT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()
    `;
    const result = await evaluate(expr);
    assert.ok(result !== "NO_LABEL" && result !== "NO_INPUT", `could not find input for label "${labelText}" (${result})`);
    assert.equal(result, value);
  };

  await setReactInputValue("Company Name", "New Company Ltd");
  await setReactInputValue("Business Email", "sales@newcompany.com");
  await sleep(200);

  const clickResult = await evaluate(`
    (function() {
      const btn = [...document.querySelectorAll('button')].find(b => /Save Profile Changes/i.test(b.textContent));
      if (!btn) return 'NO_BUTTON';
      btn.click();
      return 'CLICKED';
    })()
  `);
  assert.equal(clickResult, "CLICKED", "Save Profile Changes button not found");

  // Wait for the PATCH request to actually complete.
  const deadline = Date.now() + 10000;
  while (networkLog.length === 0 && Date.now() < deadline) await sleep(200);
  assert.ok(networkLog.length > 0, "no PATCH /api/dealer/profile request was ever sent — the Save button did nothing");
  console.log("  network:", JSON.stringify(networkLog));
  assert.ok(networkLog[0].status < 300, `PATCH /api/dealer/profile failed with status ${networkLog[0].status}`);

  await sleep(500);
  const toastText = await evaluate(`document.body.innerText`);
  console.log("  (page text after save, first 300 chars):", toastText.slice(0, 300).replace(/\n+/g, " | "));

  // Now actually reload the page (simulating the user's refresh) and verify
  // the values came back from a fresh GET, not just left-over form state.
  await send("Page.navigate", { url: `${baseUrl}/profile` });
  await waitFor(`!!document.querySelector('input')`, "profile form render after reload", 30000);
  await sleep(500);

  const companyNameValue = await evaluate(`
    (function() {
      const label = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Company Name'));
      const input = label?.closest('div').querySelector('input');
      return input ? input.value : null;
    })()
  `);
  const businessEmailValue = await evaluate(`
    (function() {
      const label = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Business Email'));
      const input = label?.closest('div').querySelector('input');
      return input ? input.value : null;
    })()
  `);

  console.log(`  after reload: companyName="${companyNameValue}" businessEmail="${businessEmailValue}"`);
  assert.equal(companyNameValue, "New Company Ltd", "Company Name did not persist across a page reload");
  assert.equal(businessEmailValue, "sales@newcompany.com", "Business Email did not persist across a page reload");

  console.log("\n✓ Profile save verification PASSED.");
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
