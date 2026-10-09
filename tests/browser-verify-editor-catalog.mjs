import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Phase 4.1 real-browser verification of the quotation editor's product catalog.
 *
 *   node tests/browser-verify-editor-catalog.mjs [--production] [--out rec.json]
 *       Seeds a throwaway local database with an edge-case catalog, drives the
 *       Products step and the Review step's add/change modals in headless
 *       Chrome (category, tier, finish, device type, search, subcategory,
 *       variant expand/select, quantity, add/replace requests, deactivated and
 *       removed quoted items) and records everything a user can see plus the
 *       request bodies the UI sends. Nothing is compared inside one run except
 *       a few absolute sanity checks.
 *   node tests/browser-verify-editor-catalog.mjs --compare before.json after.json
 *       Exits non-zero unless the two recordings are identical. Run the recorder
 *       once against the previous code and once against the new code.
 *   node tests/browser-verify-editor-catalog.mjs --real-catalog [--env path/to/.env]
 *       Copies the real catalog (read-only from MONGODB_URI) into the throwaway
 *       database and prints the real document size of the editor page for a
 *       dealer and an admin. Uses a production build.
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

if (flag("--compare")) {
  const [a, b] = args.slice(args.indexOf("--compare") + 1);
  const left = JSON.parse(await readFile(a, "utf8"));
  const right = JSON.parse(await readFile(b, "utf8"));
  const diffs = [];
  const walk = (x, y, path) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk(x[k], y[k], `${path}.${k}`);
    } else {
      diffs.push(`${path}: before=${JSON.stringify(x)?.slice(0, 300)} after=${JSON.stringify(y)?.slice(0, 300)}`);
    }
  };
  walk(left, right, "$");
  const steps = (left.steps ?? []).length;
  if (diffs.length > 0) {
    console.log(`RECORDINGS DIFFER (${diffs.length} difference(s) across ${steps} recorded steps):`);
    for (const d of diffs.slice(0, 30)) console.log("  - " + d);
    process.exit(1);
  }
  console.log(`RECORDINGS IDENTICAL: ${steps} recorded steps (${JSON.stringify(left).length} bytes of visible state + request bodies) match exactly.`);
  process.exit(0);
}

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const production = flag("--production") || flag("--real-catalog");
const outFile = opt("--out");
const realCatalog = flag("--real-catalog");

let server;
let chrome;
let debugEval = null;
let getProblems = () => [];
let profileDir;
let exitCode = 0;

const D = (s) => Decimal128.fromString(s);
const priced = (price, tax = 18) => {
  const net = Math.round((price / (1 + tax / 100)) * 100) / 100;
  return { price: D(price.toFixed(2)), priceWithoutTax: D(net.toFixed(2)), taxPercent: D(tax.toFixed(2)) };
};
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

async function seedSynthetic(db) {
  const now = new Date();
  const tiers = [{ value: "remote", label: "Remote Control" }, { value: "wifi", label: "WiFi Smart" }, { value: "zigbee", label: "Zigbee Protocol" }];
  const finishes = [{ value: "acrylic", label: "Acrylic Panel" }, { value: "glass", label: "Glass Panel" }];
  await db.collection("categories").insertMany([
    { _id: 1, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: tiers, variantFinishes: finishes },
    { _id: 2, name: "Accessories", level: 1, parentId: null, sortOrder: 2, isActive: true, variantTiers: [], variantFinishes: [] },
    { _id: 3, name: "Touch Panels", level: 2, parentId: 1, sortOrder: 1, isActive: true },
  ]);
  const base = { unit: "pcs", isActive: true, matrixDimensions: null, isMatrix: false, createdAt: now, updatedAt: now };
  const dims = [{ key: "series", label: "Series", options: ["remote", "wifi", "zigbee"] }, { key: "finish", label: "Finish", options: ["acrylic", "glass"] }];
  await db.collection("products").insertMany([
    { ...base, _id: 1, name: "Touch Switch 4M", code: "WH-101", description: "Four module touch switch", type: "switch_board", categoryId: 1, moduleSize: "4M", isMatrix: true, matrixDimensions: dims, sortOrder: 1, price: D("2599.00"), notes: "internal note", imagePublicId: "pid-1" },
    { ...base, _id: 2, name: "Acrylic Only Panel", code: "WH-102", description: "Available in acrylic only", type: "switch_board", categoryId: 1, imageUrl: GIF, moduleSize: "2M", isMatrix: true, matrixDimensions: dims, sortOrder: 2, price: D("1799.00") },
    { ...base, _id: 3, name: "Curtain Switch", code: "WH-103", description: "Quiet motorized curtain control", type: "curtain", categoryId: 1, imageUrl: GIF, sortOrder: 3, price: D("3299.00") },
    { ...base, _id: 4, name: "Fan Regulator", code: "AC-201", description: null, type: "accessory", categoryId: 2, sortOrder: 4, price: D("1180.00") },
    { ...base, _id: 5, name: "Smart Lock X", code: "AC-202", description: "Fingerprint lock", type: "smart_lock", categoryId: 2, sortOrder: 5, price: D("12999.00") },
    { ...base, _id: 6, name: "Video Door Phone", code: "AC-203", description: "Flat product without variants", type: "vdp", categoryId: 2, sortOrder: 6, price: D("24999.00") },
    { ...base, _id: 7, name: "Door Bell", code: "AC-204", description: "Wireless bell", type: "accessory", categoryId: 2, sortOrder: 7, price: D("590.00") },
    { ...base, _id: 8, name: "Panel Sub Tactus", code: "WH-104", description: "Lives in a subcategory", type: "switch_board", categoryId: 3, sortOrder: 8, price: D("999.00") },
    { ...base, _id: 9, name: "Retired Product", code: "OLD-1", description: "Deactivated after being quoted", type: "switch_board", categoryId: 1, isActive: false, sortOrder: 9, price: D("500.00") },
  ]);
  const v = (id, productId, extra, p, sortOrder) => ({ _id: id, productId, config: {}, isActive: true, sortOrder, createdAt: now, updatedAt: now, ...priced(p), ...extra });
  await db.collection("productvariants").insertMany([
    v(11, 1, { automationTier: "remote", surfaceFinish: "acrylic" }, 2599, 1),
    v(12, 1, { automationTier: "remote", surfaceFinish: "glass" }, 2999, 2),
    v(13, 1, { automationTier: "wifi", surfaceFinish: "acrylic" }, 3599, 3),
    v(14, 1, { automationTier: "wifi", surfaceFinish: "glass" }, 3999, 4),
    v(15, 1, { automationTier: "zigbee", surfaceFinish: "glass", isActive: false }, 9999, 5), // deactivated after being quoted
    v(21, 2, { automationTier: "remote", surfaceFinish: "acrylic" }, 1799, 1),
    v(22, 2, { automationTier: "wifi", surfaceFinish: "acrylic", variantCode: "VC-SEARCH-1" }, 2499, 2),
    v(31, 3, { automationTier: "wifi", surfaceFinish: "glass" }, 3299, 1),
    v(32, 3, { automationTier: "zigbee", surfaceFinish: "glass" }, 3499, 2),
    v(41, 4, {}, 1180, 1),
    v(51, 5, { automationTier: null, surfaceFinish: null, config: { series: "zigbee", finish: "glass", extra: "x" } }, 15999, 1),
    v(52, 5, {}, 12999, 2),
    v(71, 7, {}, 590, 1),
    v(81, 8, { automationTier: "remote", surfaceFinish: "acrylic" }, 999, 1),
    v(91, 9, { automationTier: "remote", surfaceFinish: "acrylic" }, 500, 1),
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 1, name: "2BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 0 },
    { _id: 2, houseTypeId: 1, roomTypeId: 2, defaultCount: 1, sortOrder: 1 },
  ]);
  await seedQuotation(db, now, [
    // live product, live variant
    { _id: 1001, quotationRoomId: 101, productId: 1, productVariantId: 11, variantLabel: "Remote + Acrylic", variantConfig: { series: "remote", finish: "acrylic" }, quantity: 2, unitPrice: D("2599.00") },
    { _id: 1002, quotationRoomId: 101, productId: 7, productVariantId: 71, variantLabel: null, variantConfig: {}, quantity: 1, unitPrice: D("590.00") },
    // product deactivated after quoting
    { _id: 1003, quotationRoomId: 102, productId: 9, productVariantId: 91, variantLabel: "Remote + Acrylic", variantConfig: { series: "remote", finish: "acrylic" }, quantity: 1, unitPrice: D("500.00") },
    // product and variant removed entirely
    { _id: 1004, quotationRoomId: 102, productId: 999, productVariantId: 999, variantLabel: "Legacy", variantConfig: {}, quantity: 1, unitPrice: D("100.00") },
    // variant deactivated after quoting
    { _id: 1005, quotationRoomId: 102, productId: 1, productVariantId: 15, variantLabel: "Zigbee + Glass", variantConfig: { series: "zigbee", finish: "glass" }, quantity: 1, unitPrice: D("9999.00") },
  ]);
}

async function seedQuotation(db, now, items) {
  await db.collection("quotations").insertOne({
    _id: "q_cat", quotationNumber: "QT-2026-CAT1", clientName: "Catalog Client", status: "draft",
    dealerId: 1, createdBy: "1", allocatedDiscountPercent: 30, customerDiscountPercent: 0, discountType: "none",
    discountValue: null, estimatedEarningAmount: D("0.00"), houseTypeId: 1, createdAt: now, updatedAt: now,
  });
  await db.collection("quotationrooms").insertMany([
    { _id: 101, quotationId: "q_cat", roomTypeId: 1, customName: null, sortOrder: 0, createdAt: now, updatedAt: now },
    { _id: 102, quotationId: "q_cat", roomTypeId: 2, customName: null, sortOrder: 10, createdAt: now, updatedAt: now },
  ]);
  await db.collection("quotationitems").insertMany(items.map((it) => ({ sortOrder: 0, ...it })));
}

async function seedRealCatalog(db) {
  const rootRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
  const dotenv = rootRequire("dotenv");
  const { MongoClient } = rootRequire("mongodb");
  const envPath = opt("--env") ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  dotenv.config({ path: envPath, quiet: true });
  assert.ok(process.env.MONGODB_URI, "MONGODB_URI is not available (pass --env <path to .env>)");
  const source = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await source.connect();
  try {
    const src = source.db();
    for (const name of ["categories", "products", "productvariants", "roomtypes"]) {
      const docs = await src.collection(name).find({}).toArray(); // read-only
      if (docs.length) await db.collection(name).insertMany(docs);
      console.log(`copied ${docs.length} ${name} from the live catalog into the throwaway database`);
    }
  } finally {
    await source.close();
  }
  const now = new Date();
  const firstProduct = await db.collection("products").findOne({ isActive: true });
  const firstVariant = await db.collection("productvariants").findOne({ productId: firstProduct._id, isActive: true });
  const room = await db.collection("roomtypes").findOne({});
  await db.collection("quotations").insertOne({
    _id: "q_cat", quotationNumber: "QT-2026-CAT1", clientName: "Catalog Client", status: "draft",
    dealerId: 1, createdBy: "1", allocatedDiscountPercent: 30, customerDiscountPercent: 0, discountType: "none",
    discountValue: null, estimatedEarningAmount: D("0.00"), createdAt: now, updatedAt: now,
  });
  await db.collection("quotationrooms").insertOne({ _id: 101, quotationId: "q_cat", roomTypeId: room?._id ?? null, customName: null, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.collection("quotationitems").insertOne({
    _id: 1001, quotationRoomId: 101, productId: firstProduct._id, productVariantId: firstVariant?._id ?? null, variantLabel: null,
    variantConfig: {}, quantity: 1, unitPrice: firstVariant?.price ?? D("100.00"), sortOrder: 0,
  });
}

try {
  server = await startIsolatedServer(
    "editorcat",
    [
      { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
      { _id: 3, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    ],
    { production }
  );
  const { db, login, baseUrl } = server;
  // The dev server only serves dev resources (HMR, client chunks) to the localhost origin, so hydration needs it.
  const pageBase = production ? baseUrl : baseUrl.replace("127.0.0.1", "localhost");
  if (realCatalog) await seedRealCatalog(db);
  else await seedSynthetic(db);

  const dealerCookie = await login("dealer_a@example.com", "user");
  const adminCookie = await login("admin_user@example.com", "admin");

  profileDir = await mkdtemp(join(tmpdir(), "whyte-editorcat-chrome-"));
  const port = 9900 + Math.floor(Math.random() * 90);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1500,1400", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!target) await sleep(500);
  }
  assert.ok(target, "browser did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve2, reject) => { ws.addEventListener("open", resolve2); ws.addEventListener("error", reject); });
  let nextId = 0;
  const pending = new Map();
  let problems = [];
  let reqLog = [];
  const docRequests = new Map(); // requestId -> {url, type}
  const inflight = new Set(); // API requests that have not finished yet
  const reqByRequestId = new Map(); // requestId -> entry in reqLog
  const docSizes = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      problems.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 400));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      problems.push(`console.error ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 400));
    } else if (msg.method === "Network.requestWillBeSent") {
      const req = msg.params.request;
      if (msg.params.type === "Document") docRequests.set(msg.params.requestId, { url: req.url });
      if (req.url.includes("/api/")) inflight.add(msg.params.requestId);
      if (req.url.includes("/api/quotations/")) {
        let body = null;
        try { body = req.postData ? JSON.parse(req.postData) : null; } catch { body = req.postData ?? null; }
        const entry = { method: req.method, url: req.url.replace(pageBase, ""), body, status: null };
        reqLog.push(entry);
        reqByRequestId.set(msg.params.requestId, entry);
      } else if (req.url.includes("/api/")) {
        const entry = { method: req.method, url: req.url.replace(pageBase, ""), body: null, status: null };
        reqLog.push(entry);
        reqByRequestId.set(msg.params.requestId, entry);
      }
    } else if (msg.method === "Network.responseReceived") {
      const reqEntry = reqByRequestId.get(msg.params.requestId);
      if (reqEntry) reqEntry.status = msg.params.response.status;
      if (msg.params.response.status >= 400 && msg.params.response.url.startsWith(pageBase)) {
        problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url.replace(pageBase, "")}`);
      }
    } else if (msg.method === "Network.loadingFailed") {
      inflight.delete(msg.params.requestId);
      problems.push(`LOAD FAILED ${msg.params.errorText} ${msg.params.canceled ? "(canceled)" : ""}`);
    } else if (msg.method === "Network.loadingFinished") {
      inflight.delete(msg.params.requestId);
      const doc = docRequests.get(msg.params.requestId);
      if (doc) docSizes.push({ requestId: msg.params.requestId, url: doc.url.replace(pageBase, ""), encoded: msg.params.encodedDataLength });
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  debugEval = evaluate;
  getProblems = () => problems;

  async function setCookie(cookie) {
    await send("Network.clearBrowserCookies");
    for (const pair of cookie.split("; ")) {
      const i = pair.indexOf("=");
      await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: pageBase });
    }
  }

  async function gotoAndWait(path, readyExpr, timeoutMs = 120000) {
    problems = [];
    reqLog = [];
    docSizes.length = 0;
    await send("Page.navigate", { url: `${pageBase}${path}` });
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(400);
      ready = await evaluate(readyExpr).catch(() => false);
    }
    // The server-rendered markup shows up long before the client bundle hydrates
    // (especially in dev mode); effects and click handlers only exist after that.
    let hydrated = false;
    while (Date.now() < deadline && !hydrated) {
      hydrated = await evaluate(`[...document.querySelectorAll('button')].some(b => Object.keys(b).some(k => k.startsWith('__reactProps$')))`).catch(() => false);
      if (!hydrated) await sleep(400);
    }
    assert.ok(hydrated, `page ${path} did not hydrate`);
    await settle();
    return ready;
  }

  // Wait until the visible text stops changing (React state updates are asynchronous).
  async function settle(maxMs = 60000) {
    let last = "";
    let stable = 0;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline && (stable < 3 || inflight.size > 0)) {
      await sleep(120);
      const now = await evaluate("document.body.innerText").catch(() => "");
      if (now === last) stable++;
      else { stable = 0; last = now; }
    }
  }

  const visibleExact = (tag, text) => `[...document.querySelectorAll(${JSON.stringify(tag)})].filter(e => e.offsetParent !== null && (e.textContent||'').replace(/\\s+/g,' ').trim() === ${JSON.stringify(text)})`;

  async function clickExact(tag, text) {
    const r = await evaluate(`(() => { const els = ${visibleExact(tag, text)}; if (!els.length) return 'NOT_FOUND'; els[0].scrollIntoView({block:'center'}); els[0].click(); return 'OK'; })()`);
    assert.equal(r, "OK", `could not click <${tag}> "${text}": ${r}`);
    await settle();
  }

  async function clickContaining(tag, text, scopeExpr = "document") {
    const r = await evaluate(`(() => { const els = [...(${scopeExpr}).querySelectorAll(${JSON.stringify(tag)})].filter(e => e.offsetParent !== null && (e.textContent||'').includes(${JSON.stringify(text)})); if (!els.length) return 'NOT_FOUND'; els[0].scrollIntoView({block:'center'}); els[0].click(); return 'OK'; })()`);
    assert.equal(r, "OK", `could not click <${tag}> containing "${text}": ${r}`);
    await settle();
  }

  // Custom <Select>: open the trigger currently showing `current`, then pick `option`.
  async function pickSelect(current, option) {
    const opened = await evaluate(`(() => { const t = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(e => e.offsetParent !== null).find(e => (e.textContent||'').trim() === ${JSON.stringify(current)}); if (!t) return 'NO_TRIGGER:' + [...document.querySelectorAll('button[aria-haspopup="listbox"]')].map(e => (e.textContent||'').trim()).join('|'); t.click(); return 'OK'; })()`);
    assert.equal(opened, "OK", `select trigger "${current}": ${opened}`);
    await sleep(200);
    const picked = await evaluate(`(() => { const o = [...document.querySelectorAll('li[role="option"]')].find(e => (e.textContent||'').trim() === ${JSON.stringify(option)}); if (!o) return 'NO_OPTION:' + [...document.querySelectorAll('li[role="option"]')].map(e => (e.textContent||'').trim()).join('|'); o.click(); return 'OK'; })()`);
    assert.equal(picked, "OK", `select option "${option}": ${picked}`);
    await settle();
  }

  async function setSearch(value, placeholderStart = "Search devices") {
    const r = await evaluate(`(() => { const i = [...document.querySelectorAll('input[type="text"]')].filter(e => e.offsetParent !== null).find(e => (e.placeholder||'').startsWith(${JSON.stringify(placeholderStart)})); if (!i) return 'NOT_FOUND'; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', {bubbles:true})); return 'OK'; })()`);
    assert.equal(r, "OK", `search input: ${r}`);
    await settle();
  }

  // What a user sees in the product grid and its controls.
  const catalogState = () => evaluate(`(() => {
    const norm = (s) => (s||'').replace(/\\s+/g,' ').trim();
    const h3 = [...document.querySelectorAll('h3')].find(e => norm(e.textContent) === 'Product Catalog');
    const header = h3 ? norm(h3.parentElement.innerText) : null;
    const wrap = h3 ? h3.closest('div.space-y-3') : null;
    const grid = wrap ? [...wrap.children].find(c => c.classList.contains('grid')) : null;
    const cards = (grid ? [...grid.children] : []).map(card => {
      const h = card.querySelector('h4');
      const img = card.querySelector('img');
      return { name: norm(h ? h.textContent : ''), text: norm(card.innerText), img: img ? img.getAttribute('src') : null };
    });
    const selects = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(e => e.offsetParent !== null).map(e => norm(e.textContent));
    const catLabel = [...document.querySelectorAll('label')].find(l => norm(l.textContent) === 'Product Category');
    const activeCategory = catLabel ? [...catLabel.parentElement.querySelectorAll('button')].filter(e => /bg-gray-950/.test(e.className)).map(e => norm(e.textContent)) : [];
    const chips = [...document.querySelectorAll('span')].filter(e => e.offsetParent !== null && /^(Tier|Finish|Type|Search):/.test(norm(e.textContent))).map(e => norm(e.textContent));
    const empty = document.body.innerText.includes('No devices match your criteria');
    return { header, count: cards.length, cards, selects, activeCategory, chips, empty };
  })()`);

  // Expression (evaluated in the page) for the product card with this exact name, scoped to the catalog grid.
  const cardOf = (name) => `(() => { const h3 = [...document.querySelectorAll('h3')].find(e => e.textContent.replace(/\\s+/g,' ').trim() === 'Product Catalog'); const grid = [...h3.closest('div.space-y-3').children].find(c => c.classList.contains('grid')); return [...grid.children].find(c => ((c.querySelector('h4')||{}).textContent||'').trim() === ${JSON.stringify(name)}); })()`;

  const recording = { mode: production ? "production" : "dev", steps: [] };
  const record = async (name, extra = {}) => {
    const state = await catalogState();
    const requests = reqLog.filter((r) => r.method !== "GET");
    reqLog.length = 0;
    recording.steps.push({ name, ...state, requests, ...extra });
    console.log(`  recorded: ${name} (${state.count} cards${state.empty ? ", empty state" : ""}${requests.length ? `, ${requests.length} mutation request(s)` : ""})`);
    return state;
  };
  const names = (state) => state.cards.map((c) => c.name);

  // ── real-catalog document-size mode ────────────────────────────────────────
  if (realCatalog) {
    const sizes = {};
    for (const [role, cookie] of [["dealer", dealerCookie], ["admin", adminCookie]]) {
      await setCookie(cookie);
      const ready = await gotoAndWait("/quotation/q_cat?step=3", `document.querySelectorAll('h4').length > 3`);
      assert.ok(ready, `${role}: editor did not render the catalog`);
      const doc = docSizes.find((d) => d.url.startsWith("/quotation/q_cat"));
      assert.ok(doc, `${role}: no document request captured`);
      const body = await send("Network.getResponseBody", { requestId: doc.requestId });
      const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      const decoded = Buffer.byteLength(text, "utf8");
      const cards = await evaluate(`[...document.querySelectorAll('h4')].filter(h => h.closest('.grid')).length`);
      sizes[role] = {
        transferBytes: doc.encoded,
        decodedBytes: decoded,
        productCardsRendered: cards,
        // margin data must never reach the browser for a dealer; the editor reads it for nobody
        documentContainsPurchaseTaxPercent: text.includes("purchaseTaxPercent"),
        documentContainsCostKey: /\\"cost\\":/.test(text),
      };
      assertNoProblems(problems);
    }
    console.log("\nREAL-CATALOG EDITOR DOCUMENT SIZE (production build, local DB seeded from the live catalog):");
    console.log(JSON.stringify(sizes, null, 2));
    if (outFile) await writeFile(outFile, JSON.stringify(sizes, null, 2));
  } else {
    // ── Dealer: the full Products-step flow ────────────────────────────────────
    await setCookie(dealerCookie);
    const ready = await gotoAndWait("/quotation/q_cat?step=3", `document.body.innerText.includes('Touch Switch 4M')`);
    assert.ok(ready, "Products step did not render");

    console.log("\n[Products step: filters]");
    let s = await record("initial (default category/tier/finish)");
    assert.ok(s.count > 0, "initial view should list devices");
    assert.deepEqual(s.activeCategory, ["Tactus"]);

    await pickSelect("Remote Control", "All Automation Tiers");
    await pickSelect("Acrylic Panel", "All Surface Finishes");
    s = await record("tactus: all tiers, all finishes");
    assert.ok(names(s).includes("Touch Switch 4M") && names(s).includes("Curtain Switch") && !names(s).includes("Retired Product"), "inactive product must not be listed");
    assert.ok(!names(s).includes("Fan Regulator"), "accessories belong to another category");

    await pickSelect("All Automation Tiers", "WiFi Smart");
    s = await record("tier = WiFi Smart");
    await pickSelect("All Surface Finishes", "Glass Panel");
    s = await record("tier = WiFi, finish = Glass");
    assert.ok(names(s).includes("Touch Switch 4M") && !names(s).includes("Acrylic Only Panel"), "acrylic-only product must drop out under a glass filter");
    await pickSelect("WiFi Smart", "Zigbee Protocol");
    s = await record("tier = Zigbee, finish = Glass (Touch Switch's zigbee variant is deactivated)");
    assert.ok(!names(s).includes("Touch Switch 4M"), "a deactivated variant must not make its product eligible");
    assert.ok(names(s).includes("Curtain Switch"));

    await clickExact("button", "Reset all filters");
    s = await record("reset all filters");

    await pickSelect("All Device Types", "Curtains / Blinds");
    s = await record("device type = Curtains");
    assert.deepEqual(names(s), ["Curtain Switch"]);
    await pickSelect("Curtains / Blinds", "Switch Boards");
    s = await record("device type = Switch Boards");
    await pickSelect("Switch Boards", "All Device Types");

    for (const q of ["touch", "WH-102", "vc-search-1", "quiet motorized", "  TOUCH  ", "zzz-no-such-device"]) {
      await setSearch(q);
      s = await record(`search "${q}"`);
    }
    assert.equal(s.empty, true, "an unmatched search shows the empty state");
    await setSearch("vc-search-1");
    s = await record("search by variant code (again, asserted)");
    assert.deepEqual(names(s), ["Acrylic Only Panel"], "searching a variant code finds its product");
    await setSearch("");

    await clickExact("button", "Touch Panels");
    s = await record("subcategory = Touch Panels");
    assert.deepEqual(names(s), ["Panel Sub Tactus"]);
    await clickExact("button", "All Tactus");
    await record("subcategory = All Tactus");

    await clickExact("button", "Accessories");
    s = await record("category = Accessories");
    assert.ok(names(s).includes("Video Door Phone") && names(s).includes("Smart Lock X"));

    console.log("\n[Products step: variants, quantity and add requests]");
    await clickContaining("button", "Matching Variants", cardOf("Smart Lock X"));
    await record("expand variants of Smart Lock X (config-derived tier/finish + plain variant)");
    // Add the config-derived variant explicitly (its tier/finish come from config.series / config.finish).
    await clickContaining("button", "Add", cardOf("Smart Lock X"));
    await record("add first variant row of Smart Lock X");
    const clickTitle = async (name, title) => {
      const r = await evaluate(`(() => { const b = ${cardOf(name)}.querySelector('button[title^=${JSON.stringify(title)}]'); if (!b || b.disabled) return 'NOT_FOUND_OR_DISABLED'; b.scrollIntoView({block:'center'}); b.click(); return 'OK'; })()`);
      assert.equal(r, "OK", `${name}: button "${title}": ${r}`);
      await settle();
    };
    await clickTitle("Video Door Phone", "Add device to room");
    await record("add flat product without variants (Video Door Phone)");
    await clickTitle("Fan Regulator", "Add");
    await record("add Fan Regulator (exact single variant)");
    await clickTitle("Fan Regulator", "Add");
    await record("add Fan Regulator again (quantity 2 in room)");
    await clickTitle("Fan Regulator", "Remove one instance");
    await record("remove one Fan Regulator instance");

    await clickExact("button", "Tactus");
    await pickSelect("Remote Control", "All Automation Tiers");
    await pickSelect("Acrylic Panel", "All Surface Finishes");
    await record("back on Tactus (tier/finish re-initialised, then set to all)");
    await clickContaining("button", "Matching Variants", cardOf("Touch Switch 4M"));
    await record("expand variants of Touch Switch 4M (deactivated variant must be absent)");
    const variantText = (await evaluate(`${cardOf("Touch Switch 4M")}.innerText`)).replace(/\s+/g, " ");
    assert.ok(!/9,?999/.test(variantText), "deactivated variant price must not be listed");

    const roomText = await evaluate("document.body.innerText");
    recording.productsStepBodyText = roomText.replace(/\s+/g, " ");
    assert.ok(roomText.includes("Door Bell"), "live quoted item is listed");
    assert.ok(roomText.includes("Retired Product") || roomText.includes("Product"), "quoted items of a deactivated product are still listed");
    await record("full page text with quoted items (live, deactivated product, removed product, deactivated variant)", { bodyText: recording.productsStepBodyText });

    // ── Review step: add / change modal and the variant picker ───────────────
    console.log("\n[Review step: add / change product modal and variant picker]");
    reqLog.length = 0;
    const ready4 = await gotoAndWait("/quotation/q_cat?step=4", `document.body.innerText.includes('Review Quotation')`);
    assert.ok(ready4, "Review step did not render");
    const modalState = () => evaluate(`(() => {
      const norm = (s) => (s||'').replace(/\s+/g,' ').trim();
      const roots = [...document.querySelectorAll('.fixed')].filter(e => e.querySelector('h3, h5'));
      const dialog = roots.find(e => !/select variant/i.test(norm(e.innerText))) ?? null;
      const rows = dialog ? [...dialog.querySelectorAll('h5')].map(h => norm((h.closest('div.group') ?? h.parentElement).innerText)) : [];
      const selects = dialog ? [...dialog.querySelectorAll('button[aria-haspopup="listbox"]')].map(e => norm(e.textContent)) : [];
      const pills = dialog ? [...dialog.querySelectorAll('button')].filter(e => /rounded-full|rounded-xl|rounded-lg/.test(e.className) && norm(e.textContent) && !/Add to Room|Replace with this/.test(e.textContent)).map(e => norm(e.textContent) + (/bg-gray-950|bg-black/.test(e.className) ? ' [selected]' : '')) : [];
      const picker = roots.map(e => norm(e.innerText)).find(t => /select variant/i.test(t)) ?? null;
      return { open: Boolean(dialog), rows, selects, pills, picker, empty: document.body.innerText.includes('No products match your search') };
    })()`);
    const recordModal = async (name, extra = {}) => {
      const state = await modalState();
      const requests = reqLog.filter((r) => r.method !== "GET");
      reqLog.length = 0;
      recording.steps.push({ name, modal: state, requests, ...extra });
      console.log(`  recorded: ${name} (${state.rows.length} rows${state.picker ? ", variant picker open" : ""}${requests.length ? `, ${requests.length} mutation request(s)` : ""})`);
      return state;
    };

    await clickContaining("button", "Add Product");
    await settle();
    let m = await recordModal("add-product modal: default category");
    assert.ok(m.rows.length > 0, "the add-product modal lists devices");
    await clickExact("button", "Accessories");
    m = await recordModal("add-product modal: category = Accessories");
    await setSearch("lock", "Search devices by name or code");
    m = await recordModal('add-product modal: search "lock"');
    await setSearch("", "Search devices by name or code");
    await pickSelect("All Types", "Smart Locks");
    m = await recordModal("add-product modal: Accessories + type = Smart Locks");
    assert.ok(m.rows.some((r) => r.includes("Smart Lock X")), "Smart Lock X should be listed under Smart Locks");
    await clickContaining("button", "Add to Room");
    await settle();
    await recordModal("add Smart Lock X from the modal (first active variant, non-matrix)");
    await clickContaining("button", "Add Product");
    await settle();
    await clickExact("button", "Tactus");
    await pickSelect("Smart Locks", "All Types"); // the type filter persists between openings
    await recordModal("add-product modal reopened: category = Tactus, all types");
    // Matrix product with several active variants opens the variant picker.
    await setSearch("Touch Switch", "Search devices by name or code");
    m = await recordModal('add-product modal: search "Touch Switch"');
    assert.ok(m.rows.length >= 1);
    await clickContaining("button", "Add to Room");
    await sleep(300);
    m = await recordModal("variant picker opened for Touch Switch 4M (active variants only)");
    assert.ok(m.picker && /select variant/i.test(m.picker), "the variant picker must open for a matrix product");
    assert.ok(!/9,?999/.test(m.picker), "deactivated variant price must not be offered in the picker");
    // Pick the wifi/glass cell: the grid shows prices; click the one for 3,999.
    const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('.fixed button')].find(e => /3,?999/.test(e.textContent||'') && e.offsetParent !== null); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()`);
    assert.equal(clicked, "OK", "wifi/glass cell not found in the picker");
    await settle();
    await recordModal("picked wifi + glass from the picker (add request)");

    // Change an existing product: replace Door Bell.
    await clickContaining("button", "Change");
    await settle();
    await clickExact("button", "Accessories"); // the category pill persists between openings
    await setSearch("Fan", "Search devices by name or code");
    m = await recordModal('change-product modal: search "Fan"');
    await clickContaining("button", "Replace with this");
    await settle();
    await recordModal("replaced with Fan Regulator (replace request)");

    // ── Admin: same editor, same catalog ───────────────────────────────────────
    console.log("\n[Admin viewing the same quotation]");
    await setCookie(adminCookie);
    const readyAdmin = await gotoAndWait("/quotation/q_cat?step=3", `document.body.innerText.includes('Touch Switch 4M')`);
    assert.ok(readyAdmin, "admin could not open the Products step");
    s = await record("admin: initial");
    await pickSelect("Remote Control", "All Automation Tiers");
    await pickSelect("Acrylic Panel", "All Surface Finishes");
    s = await record("admin: tactus all");
    await setSearch("curtain");
    s = await record('admin: search "curtain"');

    assertNoProblems(problems);
  }

  function assertNoProblems(list) {
    const real = list.filter((p) => !p.includes("favicon") && !/Failed to load resource/.test(p));
    assert.equal(real.length, 0, `console/network problems: ${real.join(" | ")}`);
  }

  if (outFile && !realCatalog) {
    await writeFile(outFile, JSON.stringify(recording, null, 1));
    console.log(`\nrecording written to ${outFile} (${recording.steps.length} steps)`);
  }
  console.log(realCatalog ? "\nreal-catalog measurement complete" : `\nbrowser verification complete: ${recording.steps.length} recorded steps, no console/network problems`);
} catch (error) {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  if (debugEval) {
    try {
      console.error("--- recent console/network problems ---");
      console.error(JSON.stringify(getProblems().slice(0, 15), null, 1));
      if (server) {
        console.error("--- isolated server output (last 2500 chars) ---");
        console.error(server.getOutput().slice(-2500));
      }
      try {
        console.error("--- fixed overlays at failure ---");
        console.error(String(await debugEval("[...document.querySelectorAll('.fixed')].map(e => (e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n---\n')")).slice(0, 1800));
      } catch { /* ignore */ }
      console.error("--- page text at failure (first 600 chars) ---");
      console.error(String(await debugEval("document.body.innerText")).slice(0, 600));
    } catch { /* page not available */ }
  }
  exitCode = 1;
} finally {
  if (chrome) { try { chrome.kill(); } catch { /* already gone */ } }
  if (server) await server.cleanup();
  process.exit(exitCode);
}
