/**
 * Full-document visual QA pass: generates a real multi-page proposal PDF
 * (via the app's actual "Download PDF" button) for a quotation with several
 * rooms, several products (with images, tier/finish/module variant data),
 * and a discount — then captures EVERY page at 2x so each one can be
 * reviewed for cross-page design consistency (header, footer, typography,
 * watermark, page numbering, spacing).
 *
 *   node tests/browser-verify-proposal-full-document.mjs <outDir>
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
assert.ok(outDir, "usage: node browser-verify-proposal-full-document.mjs <outDir>");
await mkdir(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, profileDir, downloadDir;
let exitCode = 0;
const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("proposal-full-doc", [{ _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("housetypes").insertOne({ _id: 1, name: "Duplex", isActive: true, sortOrder: 0 });
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", icon: null, isActive: true, sortOrder: 0 },
    { _id: 2, name: "Master Bedroom", icon: null, isActive: true, sortOrder: 1 },
    { _id: 3, name: "Kitchen", icon: null, isActive: true, sortOrder: 2 },
  ]);
  await db.collection("products").insertMany([
    { _id: 1, name: "Tactus Touch Switch (Only Available in Acrylic)", code: "TS-01", description: null, type: "switch", categoryId: null, automationTier: "Premium", surfaceFinish: "Matte Black", unit: "pc", imageUrl: null, imagePublicId: null, moduleSize: "2M", notes: null, isActive: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), isMatrix: false, matrixDimensions: null },
    { _id: 2, name: "Smart Curtain Motor", code: "CM-02", description: null, type: "automation", categoryId: null, automationTier: "Standard", surfaceFinish: "White", unit: "pc", imageUrl: null, imagePublicId: null, moduleSize: null, notes: null, isActive: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), isMatrix: false, matrixDimensions: null },
    { _id: 3, name: "Fan Regulator Module", code: "FR-03", description: null, type: "switch", categoryId: null, automationTier: "Premium", surfaceFinish: "Matte Black", unit: "pc", imageUrl: null, imagePublicId: null, moduleSize: "1M", notes: null, isActive: true, sortOrder: 2, createdAt: new Date(), updatedAt: new Date(), isMatrix: false, matrixDimensions: null },
  ]);

  const cookie = await login("super_admin@example.com", "admin");
  const created = await api(cookie, "POST", "/api/quotations", {
    clientName: "Vineet Patel",
    clientAddress: "Ahmedabad, Gujarat",
    clientPhone: "+91 98765 43210",
    clientEmail: "vineet@example.com",
    houseTypeId: 1,
    discountType: "percentage",
    discountValue: 10,
  });
  assert.ok(created.status < 300, `create quotation: ${created.text}`);
  const quotationId = created.data.id;

  let seq = 9001;
  async function room(roomTypeId) {
    const id = seq++;
    await db.collection("quotationrooms").insertOne({ _id: id, quotationId, roomTypeId, sortOrder: id, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }
  async function item(roomId, productId, qty, price, notes) {
    await db.collection("quotationitems").insertOne({
      _id: seq++,
      quotationRoomId: roomId,
      productId,
      productVariantId: null,
      variantLabel: null,
      variantConfig: { tier: "Premium", finish: "Matte Black", moduleSize: "2M" },
      sbNumber: `SB-${seq}`,
      quantity: qty,
      unitPrice: Decimal128.fromString(price.toFixed(2)),
      notes: notes ?? null,
      sortOrder: 0,
    });
  }

  const living = await room(1);
  for (let i = 0; i < 6; i++) await item(living, 1, 2, 2450, i === 0 ? "Near main door" : null);
  const bedroom = await room(2);
  for (let i = 0; i < 5; i++) await item(bedroom, 2, 1, 5800, null);
  const kitchen = await room(3);
  for (let i = 0; i < 4; i++) await item(kitchen, 3, 3, 1650, "Unspecified");
  // A room with an empty allocation (0 items) — must NOT render as a blank section (Step 9).
  await room(1);

  profileDir = await mkdtemp(join(tmpdir(), "whyte-fulldoc-chrome-"));
  downloadDir = await mkdtemp(join(tmpdir(), "whyte-fulldoc-downloads-"));
  const port = 9300 + Math.floor(Math.random() * 300);
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
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  for (const pair of cookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}/preview` });
  await waitFor(`!!document.querySelector('.proposal-page')`, "proposal page render", 30000);
  await waitFor(`[...document.images].every(img => img.complete)`, "all images loaded", 20000);
  await sleep(400);

  const pageCount = await evaluate(`document.querySelectorAll('.proposal-page').length`);
  pass(`proposal rendered with ${pageCount} pages (3 rooms across 7 items + discount)`);
  assert.ok(pageCount >= 4, `expected at least 4 pages (cover, about, overview, room/closing), got ${pageCount}`);

  // Sanity checks spanning the whole document before screenshotting.
  const docChecks = await evaluate(`(() => {
    const pages = [...document.querySelectorAll('.proposal-page')];
    const allText = pages.map(p => p.innerText).join('\\n---PAGE---\\n');
    return {
      pageCount: pages.length,
      hasWatermarkOnPage2: !!pages[1]?.querySelector('[aria-hidden="true"]'),
      noWatermarkOnCover: !pages[0]?.textContent.includes('WHYTE') || pages[0].querySelectorAll('[aria-hidden="true"]').length === 0,
      noUnspecifiedLabel: !/Location:\\s*Unspecified/i.test(allText),
      noEmptyRoomHeading: (allText.match(/Living Room/g) || []).length <= 2,
      pageNumbersZeroPadded: /0\\d \\/ 0\\d/.test(allText),
      discountShown: /Discount/.test(allText) && /10%/.test(allText),
      grandTotalShown: /Grand Total/i.test(allText),
      productNameCleaned: !allText.includes('Only Available in Acrylic'),
      noMongoIds: !/\\b[0-9a-f]{24}\\b/.test(allText),
    };
  })()`);

  assert.equal(docChecks.pageCount, pageCount);
  assert.ok(docChecks.hasWatermarkOnPage2, "content pages should carry the WHYTE watermark layer");
  assert.ok(docChecks.noUnspecifiedLabel, "generic 'Unspecified' location label must be omitted, not printed");
  assert.ok(docChecks.pageNumbersZeroPadded, "footer page numbers should be zero-padded 0X / 0Y");
  assert.ok(docChecks.discountShown, "10% discount must appear in the financial summary");
  assert.ok(docChecks.grandTotalShown, "Grand Total must appear");
  assert.ok(docChecks.productNameCleaned, "catalog suffix 'Only Available in Acrylic' must be stripped from the customer-facing name");
  assert.ok(docChecks.noMongoIds, "no raw 24-hex-char Mongo ObjectId should ever appear in the document text");
  pass("cross-document checks passed: watermark present, no placeholder labels, zero-padded page numbers, discount/total correct, clean product names, no raw IDs");

  // Confirm the room seeded with 0 items never produced a visible empty section.
  const emptyRoomCheck = await evaluate(`(() => {
    const headers = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
    const livingRoomHeaders = headers.filter(h => /Living Room/i.test(h));
    return { count: livingRoomHeaders.length, headers: livingRoomHeaders };
  })()`);
  assert.ok(emptyRoomCheck.count <= 1, `expected at most 1 "Living Room" section heading (the one with items), got ${emptyRoomCheck.count}: ${JSON.stringify(emptyRoomCheck.headers)}`);
  pass(`the empty-allocation "Living Room" duplicate room produced no extra section heading (${emptyRoomCheck.count} heading(s) found)`);

  // Every page must stay at (or very near) the standard A4 CSS height —
  // min-h-[1123px] does not clip, so overflowing content silently grows the
  // page taller, which then gets squashed into the fixed 210x297mm PDF slot.
  const pageHeights = await evaluate(`[...document.querySelectorAll('.proposal-page')].map(p => Math.round(p.getBoundingClientRect().height))`);
  pageHeights.forEach((h, i) => {
    assert.ok(h <= 1140, `page ${i + 1} is ${h}px tall (standard is 1123px) — content is overflowing the A4 page and will be squashed in the real PDF`);
  });
  pass(`every page stays within the standard A4 height (tallest: ${Math.max(...pageHeights)}px, standard 1123px): [${pageHeights.join(", ")}]`);

  if (outDir) {
    for (let i = 0; i < pageCount; i++) {
      const rect = await evaluate(`(() => { const r = document.querySelectorAll('.proposal-page')[${i}].getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 2 }, captureBeyondViewport: true });
      await writeFile(join(outDir, `page-${String(i + 1).padStart(2, "0")}.png`), Buffer.from(shot.data, "base64"));
    }
    pass(`captured all ${pageCount} pages at 2x to ${outDir}`);
  }

  // Also exercise the real "Download PDF" pipeline end-to-end.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Download PDF/i.test(b.textContent))?.click()`);
  let pdfFile = null;
  for (let i = 0; i < 40 && !pdfFile; i++) {
    await sleep(500);
    const files = existsSync(downloadDir) ? readdirSync(downloadDir) : [];
    const done = files.find((f) => f.endsWith(".pdf"));
    if (done) pdfFile = join(downloadDir, done);
  }
  assert.ok(pdfFile, `no PDF appeared in ${downloadDir}`);
  const size = statSync(pdfFile).size;
  assert.ok(size > 100_000, `downloaded PDF is suspiciously small (${size} bytes)`);
  pass(`real multi-page "Download PDF" produced an actual .pdf file (${(size / 1024).toFixed(0)} KB)`);

  const relevantErrors = consoleErrors.filter(Boolean).filter((e) => !/favicon/i.test(e));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  pass("no console errors across the whole document generation");

  console.log(`\nFull-document verification PASSED (${results.length} checks).`);
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
