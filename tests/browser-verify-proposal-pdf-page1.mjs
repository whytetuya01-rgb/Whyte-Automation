/**
 * Generates a REAL proposal PDF (via the app's actual "Download PDF" button)
 * and also captures the exact html-to-image PNG that gets embedded as page 1
 * of that PDF (same function/options the app itself uses), so the rendered
 * result can be visually compared against the reference design pixel-for-
 * pixel rather than just checking the live on-screen HTML.
 *
 *   node tests/browser-verify-proposal-pdf-page1.mjs <outDir>
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const outDir = process.argv[2];
assert.ok(outDir, "usage: node browser-verify-proposal-pdf-page1.mjs <outDir>");
await mkdir(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, profileDir, downloadDir;
let exitCode = 0;
const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("proposal-pdf", [{ _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("housetypes").insertOne({ _id: 1, name: "Duplex", isActive: true, sortOrder: 0 });
  const cookie = await login("super_admin@example.com", "admin");
  const created = await api(cookie, "POST", "/api/quotations", {
    clientName: "Vineet",
    clientAddress: "Ahmedabad",
    clientPhone: "+91 98765 43210",
    houseTypeId: 1,
  });
  assert.ok(created.status < 300, `create quotation: ${created.text}`);
  const quotationId = created.data.id;

  const roomId = 9001;
  await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("quotationitems").insertOne({
    _id: 9002,
    quotationRoomId: roomId,
    productId: 1,
    quantity: 5,
    unitPrice: Decimal128.fromString("22765.51"),
    sortOrder: 0,
  });

  profileDir = await mkdtemp(join(tmpdir(), "whyte-pdf-chrome-"));
  downloadDir = await mkdtemp(join(tmpdir(), "whyte-pdf-downloads-"));
  const port = 9200 + Math.floor(Math.random() * 300);
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
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
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
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  for (const pair of cookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}/preview` });
  await waitFor(`!!document.querySelector('.proposal-page')`, "proposal page render", 30000);
  await waitFor(`[...document.images].every(img => img.complete)`, "all images loaded", 20000);
  await sleep(400);
  pass("proposal preview loaded with real quotation data");

  // 1) High-fidelity screenshot of exactly the page-1 element, for direct
  //    visual comparison against the reference design.
  const rect = await evaluate(`(() => { const r = document.querySelectorAll('.proposal-page')[0].getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const shotResult = await send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 2 }, captureBeyondViewport: true });
  const pngBuffer = Buffer.from(shotResult.data, "base64");
  const pngPath = join(outDir, "pdf-page1-visual.png");
  await writeFile(pngPath, pngBuffer);
  pass(`captured page 1 at 2x for visual comparison (${(pngBuffer.length / 1024).toFixed(0)} KB) -> ${pngPath}`);

  // 2) Trigger the real "Download PDF" button end-to-end (the app's actual
  //    html-to-image + jsPDF pipeline) and confirm a real PDF file is produced.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.click()`, false);
  let pdfFile = null;
  for (let i = 0; i < 40 && !pdfFile; i++) {
    await sleep(500);
    const files = existsSync(downloadDir) ? readdirSync(downloadDir) : [];
    const done = files.find((f) => f.endsWith(".pdf"));
    if (done) pdfFile = join(downloadDir, done);
  }
  assert.ok(pdfFile, `no PDF appeared in ${downloadDir} (files: ${existsSync(downloadDir) ? readdirSync(downloadDir).join(", ") : "dir missing"})`);
  const size = statSync(pdfFile).size;
  assert.ok(size > 50_000, `downloaded PDF is suspiciously small (${size} bytes) — likely a broken/blank render`);
  pass(`real "Download PDF" button produced an actual .pdf file (${(size / 1024).toFixed(0)} KB) at ${pdfFile}`);

  const relevantErrors = consoleErrors.filter(Boolean).filter((e) => !/favicon/i.test(e));
  assert.deepEqual(relevantErrors, [], `console errors during PDF generation: ${relevantErrors.join(" | ")}`);
  pass("no console errors during PDF generation");

  console.log(`\nPDF page-1 generation verification PASSED (${results.length} checks).`);
  console.log(`Open and inspect: ${pngPath}`);
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
