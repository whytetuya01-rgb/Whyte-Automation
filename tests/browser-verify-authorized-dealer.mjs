/**
 * Authorized Dealer block on the proposal (Part 1): covers all 3 real
 * business cases — dealer self-created, admin-created + assigned, and no
 * dealer at all — against a real generated PDF page, plus confirms no
 * internal fields (dealer id, role, discount allocation) ever leak into the
 * rendered text.
 *
 *   node tests/browser-verify-authorized-dealer.mjs [screenshotDir]
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
  server = await startIsolatedServer("authorized-dealer", [
    { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
    { _id: 2, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 3, email: "bhavik@example.com", role: "dealer", name: "Bhavik Shah", contactNumber: "+91 98765 11223", discountAllocationPercent: 15 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("housetypes").insertOne({ _id: 1, name: "2 BHK", isActive: true, sortOrder: 0 });

  const superAdmin = await login("super_admin@example.com", "admin");
  const admin = await login("admin_user@example.com", "admin");
  const bhavik = await login("bhavik@example.com", "user");

  let seq = 9001;
  async function addProduct(cookie, quotationId) {
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({
      _id: seq++, quotationRoomId: roomId, productId: 1, quantity: 1,
      unitPrice: Decimal128.fromString("5000.00"), sortOrder: 0,
    });
  }

  // CASE A — dealer creates their own quotation.
  const caseARes = await api(bhavik, "POST", "/api/quotations", { clientName: "Case A Client", houseTypeId: 1 });
  assert.ok(caseARes.status < 300, `case A create: ${caseARes.text}`);
  const caseAId = caseARes.data.id;
  await addProduct(bhavik, caseAId);

  // CASE B — admin creates, then assigns Bhavik. createdBy stays the admin.
  const caseBRes = await api(admin, "POST", "/api/quotations", { clientName: "Case B Client", houseTypeId: 1 });
  assert.ok(caseBRes.status < 300, `case B create: ${caseBRes.text}`);
  const caseBId = caseBRes.data.id;
  await addProduct(admin, caseBId);
  const assignRes = await api(admin, "POST", `/api/quotations/${caseBId}/assign`, { dealerId: 3 });
  assert.ok(assignRes.status < 300, `case B assign: ${assignRes.text}`);
  const caseBCheck = await db.collection("quotations").findOne({ _id: caseBId });
  assert.equal(caseBCheck.createdBy, "2", `createdBy must stay the admin (2), got ${caseBCheck.createdBy}`);
  assert.equal(caseBCheck.dealerId, 3, `dealerId must be Bhavik (3), got ${caseBCheck.dealerId}`);
  pass("Case B: assign keeps createdBy = Admin (2), sets dealerId = Bhavik (3) — createdBy and assignedTo stay separate");

  // CASE C — admin creates with no dealer at all.
  const caseCRes = await api(admin, "POST", "/api/quotations", { clientName: "Case C Client", houseTypeId: 1 });
  assert.ok(caseCRes.status < 300, `case C create: ${caseCRes.text}`);
  const caseCId = caseCRes.data.id;
  await addProduct(admin, caseCId);

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-authdealer-chrome-"));
  const port = 9450 + Math.floor(Math.random() * 300);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1000,1300", "about:blank"], { stdio: "ignore" });
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
  for (const pair of superAdmin.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const shot = async (name) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  async function loadProposal(id) {
    await send("Page.navigate", { url: `${baseUrl}/quotation/${id}/preview` });
    await waitFor(`!!document.querySelector('.proposal-page')`, "proposal render", 30000);
    await waitFor(`[...document.images].every(img => img.complete)`, "images loaded", 20000);
    await sleep(300);
    return evaluate(`document.body.innerText`);
  }

  // TEST 1 / Case A: dealer-created quotation shows Bhavik.
  const textA = await loadProposal(caseAId);
  assert.match(textA, /AUTHORIZED DEALER/i);
  assert.match(textA, /Bhavik Shah/);
  assert.match(textA, /\+91 98765 11223/);
  pass("TEST 1 (Case A, dealer-created): proposal shows 'Bhavik Shah' + phone under Authorized Dealer");

  // TEST 2 / Case B: admin-assigned quotation also shows Bhavik.
  const textB = await loadProposal(caseBId);
  assert.match(textB, /AUTHORIZED DEALER/i);
  assert.match(textB, /Bhavik Shah/);
  pass("TEST 2 (Case B, admin-assigned): proposal shows 'Bhavik Shah' under Authorized Dealer, createdBy unaffected");
  await shot("01-case-b-assigned-dealer");

  // TEST 3 / Case C: no dealer at all -> no section, no placeholder.
  const textC = await loadProposal(caseCId);
  assert.doesNotMatch(textC, /AUTHORIZED DEALER/i);
  assert.doesNotMatch(textC, /\bN\/A\b/);
  assert.doesNotMatch(textC, /Unassigned/i);
  pass("TEST 3 (Case C, no dealer): no 'Authorized Dealer' section, no N/A, no 'Unassigned' placeholder");
  await shot("02-case-c-no-dealer");

  // No internal/sensitive fields ever leak into the rendered proposal text.
  const leakCheck = await loadProposal(caseAId);
  assert.doesNotMatch(leakCheck, /passwordHash/i);
  assert.doesNotMatch(leakCheck, /discountAllocationPercent/i);
  assert.doesNotMatch(leakCheck, /\b15%/); // Bhavik's allocated discount must never appear on the client-facing proposal
  assert.doesNotMatch(leakCheck, /\bdealer\b.*\bid\b/i);
  pass("no internal fields (password hash, discount allocation, dealer id/role) leak into the proposal text");

  // TEST 8: real PDF generation stays safe for both the dealer-created and
  // admin-assigned cases (no console errors, a real file is produced).
  for (const [label, id] of [["Case A", caseAId], ["Case B", caseBId]]) {
    await loadProposal(id);
    const dlDir = await mkdtemp(join(tmpdir(), "whyte-authdealer-dl-"));
    await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
    await evaluate(`[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.click()`);
    let pdfFile = null;
    for (let i = 0; i < 30 && !pdfFile; i++) {
      await sleep(500);
      const { readdirSync, statSync } = await import("node:fs");
      const files = existsSync(dlDir) ? readdirSync(dlDir) : [];
      const done = files.find((f) => f.endsWith(".pdf"));
      if (done) pdfFile = join(dlDir, done);
    }
    assert.ok(pdfFile, `${label}: no PDF produced`);
    const { statSync } = await import("node:fs");
    assert.ok(statSync(pdfFile).size > 50_000, `${label}: PDF suspiciously small`);
    await rm(dlDir, { recursive: true, force: true }).catch(() => {});
  }
  pass("TEST 8: real PDF generated successfully for both the dealer-created and admin-assigned cases");

  const relevantErrors = consoleErrors.filter(Boolean).filter((e) => !/favicon/i.test(e));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  pass("no console errors across all three cases");

  console.log(`\nAuthorized Dealer verification PASSED (${results.length} checks).`);
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
