/**
 * Browser verification: a quotation with zero products must not be able to
 * reach Review (step 4) or Proposal Preview & Export (step 5) — neither via
 * the "Continue" buttons, nor the step indicator, nor a direct "?step=" URL.
 * Once a product exists, the same quotation must proceed normally.
 *
 *   node tests/browser-verify-product-gate.mjs [screenshotDir]
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
  server = await startIsolatedServer("product-gate", [{ _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("roomtypes").insertOne({ _id: 1, name: "Living Room", icon: null, isActive: true, sortOrder: 0 });
  await db.collection("housetypes").insertOne({ _id: 1, name: "2 BHK", isActive: true, sortOrder: 0 });

  const cookie = await login("super_admin@example.com", "admin");
  const created = await api(cookie, "POST", "/api/quotations", { clientName: "Product Gate Check", houseTypeId: 1 });
  assert.ok(created.status < 300, `create quotation: ${created.text}`);
  const quotationId = created.data.id ?? created.data._id;

  const roomRes = await api(cookie, "POST", `/api/quotations/${quotationId}/rooms`, { roomTypeId: 1, sortOrder: 0 });
  assert.ok(roomRes.status < 300, `create room: ${roomRes.text}`);
  const roomId = roomRes.data.id ?? roomRes.data._id;

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-prodgate-chrome-"));
  const port = 9600 + Math.floor(Math.random() * 400);
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
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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
  const bodyText = () => evaluate("document.body.innerText");
  const currentStepParam = () => evaluate("new URLSearchParams(window.location.search).get('step')");

  // ── Phase A: zero products ───────────────────────────────────────────
  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=3` });
  await waitFor(`/Configure Devices|Configure Products/i.test(document.body.innerText) || /Step 3 of 5/.test(document.body.innerText)`, "step 3 render", 60000);
  pass("quotation with 0 products opens on Step 3 (Products)");

  const continueDisabled = await evaluate(`
    [...document.querySelectorAll('button')]
      .filter(b => /Continue to Review/i.test(b.textContent))
      .every(b => b.disabled)
  `);
  assert.equal(continueDisabled, true, "every 'Continue to Review' button should be disabled with 0 products");
  pass("'Continue to Review' button(s) are disabled with 0 products");

  // Clicking a disabled button must not navigate anywhere.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Continue to Review/i.test(b.textContent)).click()`);
  await sleep(500);
  assert.match(await bodyText(), /Configure Devices|Configure Products|Step 3 of 5/i);
  pass("clicking the disabled Continue button does not advance the step");

  // Step indicator: step 4 node must be disabled (not clickable).
  const indicatorBlocked = await evaluate(`
    (() => {
      const nodes = [...document.querySelectorAll('nav[aria-label="Proposal Builder Progress"] li')];
      const step4Circle = nodes[3]?.querySelector('div');
      return step4Circle ? step4Circle.className.includes('cursor-not-allowed') : null;
    })()
  `);
  assert.equal(indicatorBlocked, true, "Review step indicator node should show the not-allowed state");
  pass("step indicator marks Review (step 4) as not reachable");

  await shot("01-step3-zero-products-disabled");

  // Direct URL to step 4 must bounce back, not render Review.
  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=4` });
  await waitFor(`/Configure Devices|Configure Products|Step 3 of 5/i.test(document.body.innerText)`, "redirected to step 3", 20000);
  await waitFor(`new URLSearchParams(window.location.search).get('step') === '3'`, "URL corrected to step=3", 10000);
  assert.doesNotMatch(await bodyText(), /Step 4 of 5/i);
  pass("direct ?step=4 URL with 0 products redirects back to Step 3, URL corrected");

  // Direct URL to step 5 must bounce back too.
  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=5` });
  await waitFor(`/Configure Devices|Configure Products|Step 3 of 5/i.test(document.body.innerText)`, "redirected to step 3 (from 5)", 20000);
  assert.doesNotMatch(await bodyText(), /Download PDF/);
  pass("direct ?step=5 URL with 0 products redirects back to Step 3, Proposal Preview not rendered");

  // Server-side: Review and Review-adjacent API behavior is unaffected (out of
  // scope for this UI gate) — only confirm the quotation really has 0 items.
  const stillEmpty = await api(cookie, "GET", `/api/quotations/${quotationId}`);
  assert.equal((stillEmpty.data.rooms || []).reduce((n, r) => n + (r.items?.length ?? 0), 0), 0);
  pass("quotation still has 0 items after the blocked navigation attempts");

  // ── Phase B: add one product directly (bypassing the variant/pricing UI,
  // consistent with how other test suites in this repo seed items) ───────
  await db.collection("quotationitems").insertOne({
    _id: 1,
    quotationRoomId: Number(roomId),
    productId: 1,
    productVariantId: null,
    variantLabel: null,
    variantConfig: null,
    sbNumber: null,
    quantity: 1,
    unitPrice: Decimal128.fromString("5000.00"),
    priceWithoutTax: Decimal128.fromString("4237.29"),
    taxPercent: Decimal128.fromString("18"),
    taxAmount: Decimal128.fromString("762.71"),
    notes: null,
    sortOrder: 0,
  });

  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=3` });
  await waitFor(`/Configure Devices|Configure Products|Step 3 of 5/i.test(document.body.innerText)`, "step 3 reload", 30000);

  const continueEnabled = await evaluate(`
    [...document.querySelectorAll('button')]
      .filter(b => /Continue to Review/i.test(b.textContent))
      .every(b => !b.disabled)
  `);
  assert.equal(continueEnabled, true, "'Continue to Review' should be enabled once a product exists");
  pass("'Continue to Review' button(s) become enabled once the quotation has a product");

  await evaluate(`[...document.querySelectorAll('button')].find(b => /Continue to Review Quotation/i.test(b.textContent)).click()`);
  await waitFor(`/Step 4 of 5/i.test(document.body.innerText)`, "Review step render", 20000);
  assert.equal(await currentStepParam(), "4");
  await waitFor(`new URLSearchParams(window.location.search).get('step') === '4'`, "URL is step=4", 10000);
  pass("clicking Continue now advances to Step 4 (Review), URL updated");
  await shot("02-step4-review-with-product");

  // Review -> Proposal.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Generate.*Proposal Preview/i.test(b.textContent))?.click()`);
  await waitFor(`/Download PDF/.test(document.body.innerText)`, "Proposal preview render", 20000);
  pass("Review → Proposal (Step 5) renders normally with a product present");
  await shot("03-step5-proposal-with-product");

  // Direct URL to step 5 should now work too (no bounce-back).
  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=5` });
  await waitFor(`/Download PDF/.test(document.body.innerText)`, "direct step=5 render", 20000);
  pass("direct ?step=5 URL now renders Proposal Preview (no redirect) once a product exists");

  console.log(`\nProduct-gate browser verification PASSED (${results.length} checks).`);
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
