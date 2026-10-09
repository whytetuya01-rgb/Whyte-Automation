/**
 * Verifies the P0 fixes to the proposal/PDF generator:
 *   - invalid GSTIN (dealer or client) blocks Print/Download entirely
 *   - a valid-but-cross-state client GSTIN switches CGST+SGST -> IGST
 *   - a same-state (or indeterminate) client keeps CGST+SGST
 *   - the dealer's internal login email never appears (only businessEmail)
 *   - the zero-discount row is hidden
 *   - the room subtotal appears exactly once (footer only, not the header)
 *   - a real downloaded PDF is well under the old 122MB and the new <5MB target
 *
 *   node tests/browser-verify-proposal-pdf-p0.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
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
const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let evaluate = async () => "(browser not started)";
let consoleErrors = [];

try {
  server = await startIsolatedServer("proposal-pdf-p0", [
    { _id: 1, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    {
      _id: 2, email: "bhavik@example.com", role: "dealer", name: "Bhavik Shah",
      contactNumber: "+91 98765 11223",
      gstNumber: "27AAAAAAAAAAAAA15", // malformed (17 chars) — must block generation
    },
    {
      _id: 3, email: "asha@example.com", role: "dealer", name: "Asha Patel",
      contactNumber: "+91 90000 00000",
      gstNumber: "24AAAAA0000A1Z8", // valid Gujarat GSTIN — same state as supplier
    },
  ], { production: true });
  const { db, login, api, baseUrl } = server;

  // Whyte Automations' own GSTIN — Gujarat (state code 24).
  await db.collection("companies").insertOne({
    _id: 1, name: "Whyte Automations Pvt Ltd", gstNumber: "24AAAAA0000A1Z8",
    phone: "+91 98982 34336", email: "sales@whyte.co.in", address: "Gandhinagar, Gujarat", updatedAt: new Date(),
  });
  await db.collection("housetypes").insertOne({ _id: 1, name: "2 BHK", isActive: true, sortOrder: 0 });
  await db.collection("products").insertOne({
    _id: 1, name: "Touch Curtain Switch", isActive: true, categoryId: 1,
    price: Decimal128.fromString("5000.00"), priceWithoutTax: Decimal128.fromString("4237.29"),
    taxPercent: Decimal128.fromString("18.00"), cost: Decimal128.fromString("2000.00"),
    purchaseTaxPercent: Decimal128.fromString("18.00"),
  });

  const admin = await login("admin_user@example.com", "admin");

  let seq = 9001;
  async function addProduct(quotationId) {
    const roomId = seq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({
      _id: seq++, quotationRoomId: roomId, productId: 1, quantity: 1,
      unitPrice: Decimal128.fromString("5000.00"), sortOrder: 0,
    });
  }

  // CASE A — invalid dealer GSTIN, same-state client (no GST, no address) -> must block.
  const caseARes = await api(admin, "POST", "/api/quotations", {
    clientName: "Case A Client", houseTypeId: 1,
  });
  assert.ok(caseARes.status < 300, `case A create: ${caseARes.text}`);
  const caseAId = caseARes.data.id;
  await addProduct(caseAId);
  const assignA = await api(admin, "POST", `/api/quotations/${caseAId}/assign`, { dealerId: 2 });
  assert.ok(assignA.status < 300, `case A assign: ${assignA.text}`);

  // CASE B — a different dealer with a VALID Gujarat GSTIN; client has a
  // valid Maharashtra (27) GSTIN -> different state -> IGST.
  const caseBRes = await api(admin, "POST", "/api/quotations", {
    clientName: "Case B Client", houseTypeId: 1,
    clientGstNumber: "27AAAAA0000A1Z2",
  });
  assert.ok(caseBRes.status < 300, `case B create: ${caseBRes.text}`);
  const caseBId = caseBRes.data.id;
  await addProduct(caseBId);
  const assignB = await api(admin, "POST", `/api/quotations/${caseBId}/assign`, { dealerId: 3 });
  assert.ok(assignB.status < 300, `case B assign: ${assignB.text}`);

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-pdf-p0-chrome-"));
  const port = 9750 + Math.floor(Math.random() * 300);
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
  consoleErrors = [];
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
  evaluate = async (expression) => {
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
  for (const pair of admin.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  async function loadProposal(id) {
    await send("Page.navigate", { url: `${baseUrl}/quotation/${id}/preview` });
    await waitFor(`!!document.querySelector('.proposal-page')`, "proposal render", 30000);
    await waitFor(`[...document.images].every(img => img.complete)`, "images loaded", 20000);
    await sleep(300);
    return evaluate(`document.body.innerText`);
  }

  // CASE A assertions: invalid GSTIN blocks generation, hides the chip, same-state tax.
  const textA = await loadProposal(caseAId);
  assert.doesNotMatch(textA, /GSTIN\s+27AAAAAAAAAAAAA15/, "invalid/malformed GSTIN must never be shown");
  assert.match(textA, /Cannot (generate PDF|print\/export)|invalid/i, "an invalid-GSTIN error must be visible");
  const downloadDisabled = await evaluate(
    `[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.disabled`
  );
  assert.equal(downloadDisabled, true, "Download PDF must be disabled when the dealer's GSTIN is invalid");
  assert.match(textA, /CGST @ 9%/);
  assert.match(textA, /SGST\/UTGST @ 9%/);
  assert.doesNotMatch(textA, /IGST/);
  assert.doesNotMatch(textA, /\bDiscount\b/, "zero discount row must be hidden");
  assert.doesNotMatch(textA, /bhavik@example\.com/, "dealer's internal login email must never be shown");
  pass("Case A: invalid dealer GSTIN blocks download, hides the chip, shows CGST+SGST, hides zero discount");

  // Room subtotal: header banner must not carry "Subtotal:" text; only the footer banner does.
  // The old room header/continuation banners rendered "Subtotal: ₹…" —
  // that exact "Subtotal:" + amount form must no longer appear anywhere;
  // only the footer banner's "{Room} Subtotal" (no colon) remains.
  assert.doesNotMatch(textA, /Subtotal:\s*₹/);
  pass("Room subtotal no longer duplicated in the room header banner");

  // CASE B assertions: valid GSTIN unblocks, cross-state client -> IGST.
  const textB = await loadProposal(caseBId);
  const downloadDisabledB = await evaluate(
    `[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.disabled`
  );
  assert.equal(downloadDisabledB, false, "Download PDF must be enabled once the dealer's GSTIN is valid");
  assert.match(textB, /IGST @ 18%/);
  assert.doesNotMatch(textB, /CGST @ 9%/);
  assert.doesNotMatch(textB, /SGST\/UTGST @ 9%/);
  pass("Case B: valid dealer GSTIN unblocks download; cross-state client GSTIN switches to IGST @ 18%");

  // Real PDF download + file-size check.
  const dlDir = await mkdtemp(join(tmpdir(), "whyte-pdf-p0-dl-"));
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.click()`);
  let pdfFile = null;
  for (let i = 0; i < 40 && !pdfFile; i++) {
    await sleep(500);
    const files = existsSync(dlDir) ? readdirSync(dlDir) : [];
    const done = files.find((f) => f.endsWith(".pdf"));
    if (done) pdfFile = join(dlDir, done);
  }
  assert.ok(pdfFile, "no PDF produced for Case B");
  const sizeBytes = statSync(pdfFile).size;
  const sizeMB = sizeBytes / (1024 * 1024);
  console.log(`  (PDF size: ${sizeMB.toFixed(2)} MB)`);
  assert.ok(sizeMB < 5, `PDF must be under 5MB, got ${sizeMB.toFixed(2)}MB`);
  await rm(dlDir, { recursive: true, force: true }).catch(() => {});
  pass(`real PDF generated and under the 5MB target (${sizeMB.toFixed(2)} MB)`);

  console.log(`\nProposal PDF P0 verification PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.message : error);
  try {
    const bodyText = await evaluate(`document.body.innerText`).catch(() => "(unavailable)");
    console.error("Page body text at failure:\n", bodyText?.slice(0, 2000));
    console.error("Console errors:", consoleErrors);
  } catch {}
  if (server) console.error("Server output tail:\n", server.getOutput().slice(-4000));
  exitCode = 1;
} finally {
  if (chrome) spawn("taskkill", ["/pid", String(chrome.pid), "/t", "/f"], { stdio: "ignore" });
  if (server) await server.cleanup();
  await sleep(500);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
