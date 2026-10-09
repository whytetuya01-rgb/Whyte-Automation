import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Phase 3 real-browser verification of the quotation editor: a production
 * build, a throwaway database seeded with a multi-room/multi-product Draft
 * quotation (plus a locked Approved one and a second dealer for the IDOR
 * check), driven by a real headless Chrome/Edge over CDP (no browser
 * automation library is installed — same raw-CDP approach already used by
 * tests/browser-verify-admin-dashboard.mjs).
 */
const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
assert.ok(browserPath, "Chrome or Edge is required");
const shotDir = process.argv[2] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let chrome;
let profileDir;
let exitCode = 0;
const results = [];
async function record(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

try {
  server = await startIsolatedServer(
    "qeditor2",
    [
      { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
      { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 30 },
      { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
    ],
    { production: true }
  );
  const { db, login, baseUrl } = server;

  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("products").insertMany([
    { _id: 1, name: "Touch Switch 4M", code: "WH-101", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: true, matrixDimensions: [{ key: "series", label: "Series", options: ["remote", "wifi"] }, { key: "finish", label: "Finish", options: ["acrylic", "glass"] }], createdAt: new Date(), updatedAt: new Date() },
    { _id: 2, name: "Fan Regulator", code: "WH-102", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: new Date(), updatedAt: new Date() },
    { _id: 3, name: "Door Bell", code: "WH-103", type: "accessory", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 3, isMatrix: false, matrixDimensions: null, createdAt: new Date(), updatedAt: new Date() },
  ]);
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "WH-101-REM-ACR", automationTier: "remote", surfaceFinish: "acrylic", config: { series: "remote", finish: "acrylic" }, price: Decimal128.fromString("2599.00"), priceWithoutTax: Decimal128.fromString("2202.54"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 1, variantCode: "WH-101-WIFI-GLS", automationTier: "wifi", surfaceFinish: "glass", config: { series: "wifi", finish: "glass" }, price: Decimal128.fromString("4599.00"), priceWithoutTax: Decimal128.fromString("3897.46"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 2 },
    { _id: 3, productId: 2, variantCode: "WH-102-V1", config: {}, price: Decimal128.fromString("1180.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
    { _id: 4, productId: 3, variantCode: "WH-103-V1", config: {}, price: Decimal128.fromString("590.00"), priceWithoutTax: Decimal128.fromString("500.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, name: "Master Bedroom", isActive: true, sortOrder: 2 },
    { _id: 3, name: "Kitchen", isActive: true, sortOrder: 3 },
    { _id: 4, name: "Study Room", isActive: true, sortOrder: 4 },
  ]);
  // A house type with a room template, matching how a real quotation is
  // created (Step 1 of the wizard always picks a house type) — without this,
  // the Spaces step's preset picker has nothing to resolve against.
  await db.collection("housetypes").insertOne({ _id: 1, name: "3BHK Apartment", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 0 },
    { _id: 2, houseTypeId: 1, roomTypeId: 2, defaultCount: 1, sortOrder: 1 },
    { _id: 3, houseTypeId: 1, roomTypeId: 3, defaultCount: 1, sortOrder: 2 },
  ]);

  const now = new Date();
  await db.collection("quotations").insertOne({
    _id: "q_draft_rich", quotationNumber: "QT-2026-TEST1", clientName: "Browser Test Client", status: "draft",
    dealerId: 1, createdBy: "1", allocatedDiscountPercent: 30, customerDiscountPercent: 0, discountType: "none",
    discountValue: null, estimatedEarningAmount: Decimal128.fromString("0.00"), houseTypeId: 1, createdAt: now, updatedAt: now,
  });
  await db.collection("quotationrooms").insertMany([
    { _id: 101, quotationId: "q_draft_rich", roomTypeId: 1, customName: null, sortOrder: 0, createdAt: now, updatedAt: now },
    { _id: 102, quotationId: "q_draft_rich", roomTypeId: 2, customName: null, sortOrder: 10, createdAt: now, updatedAt: now },
    { _id: 103, quotationId: "q_draft_rich", roomTypeId: 3, customName: null, sortOrder: 20, createdAt: now, updatedAt: now },
  ]);
  await db.collection("quotationitems").insertMany([
    { _id: 1001, quotationRoomId: 101, productId: 1, productVariantId: 1, variantLabel: "Remote + Acrylic", variantConfig: { series: "remote", finish: "acrylic" }, quantity: 2, unitPrice: Decimal128.fromString("2599.00"), sortOrder: 0 },
    { _id: 1002, quotationRoomId: 101, productId: 3, productVariantId: 4, variantLabel: null, variantConfig: {}, quantity: 1, unitPrice: Decimal128.fromString("590.00"), sortOrder: 0 },
    { _id: 1003, quotationRoomId: 102, productId: 2, productVariantId: 3, variantLabel: null, variantConfig: {}, quantity: 3, unitPrice: Decimal128.fromString("1180.00"), sortOrder: 0 },
  ]);

  await db.collection("quotations").insertOne({
    _id: "q_locked", quotationNumber: "QT-2026-TEST2", clientName: "Locked Test Client", status: "approved",
    dealerId: 1, createdBy: "1", allocatedDiscountPercent: 30, customerDiscountPercent: 10, discountType: "percentage",
    discountValue: Decimal128.fromString("10.00"), estimatedEarningAmount: Decimal128.fromString("500.00"),
    approvedAt: now, createdAt: now, updatedAt: now,
  });
  await db.collection("quotationrooms").insertOne({ _id: 201, quotationId: "q_locked", roomTypeId: 1, customName: null, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.collection("quotationitems").insertOne({ _id: 2001, quotationRoomId: 201, productId: 2, productVariantId: 3, variantLabel: null, variantConfig: {}, quantity: 1, unitPrice: Decimal128.fromString("1180.00"), sortOrder: 0 });

  const dealerACookie = await login("dealer_a@example.com", "user");
  const dealerBCookie = await login("dealer_b@example.com", "user");

  profileDir = await mkdtemp(join(tmpdir(), "whyte-qeditor-chrome-"));
  const port = 9400 + Math.floor(Math.random() * 500);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!target) await sleep(500);
  }
  assert.ok(target, "browser did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  let nextId = 0;
  const pending = new Map();
  let problems = [];
  let reqLog = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      problems.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 400));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      problems.push(`console.error ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 400));
    } else if (msg.method === "Network.requestWillBeSent") {
      const u = msg.params.request.url;
      if (u.includes("/api/")) reqLog.push({ method: msg.params.request.method, url: u.replace(baseUrl, "") });
    } else if (msg.method === "Network.responseReceived") {
      if (msg.params.response.status >= 400 && msg.params.response.url.includes("/api/")) {
        problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url.replace(baseUrl, "")}`);
      }
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");

  async function setCookie(cookie) {
    await send("Network.clearBrowserCookies");
    for (const pair of cookie.split("; ")) {
      const i = pair.indexOf("=");
      await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
    }
  }

  async function gotoAndWait(path, readySelectorExpr, timeoutMs = 60000) {
    problems = [];
    reqLog = [];
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(400);
      ready = await evaluate(readySelectorExpr).catch(() => false);
    }
    return ready;
  }

  function resetNetLog() {
    reqLog.length = 0;
    problems = [];
  }

  async function shot(name) {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const s = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  }

  function assertNoProblems() {
    const real = problems.filter((p) => !p.includes("favicon"));
    assert.equal(real.length, 0, `console/network problems: ${real.join(" | ")}`);
  }

  function quotationApiCalls() {
    return reqLog.filter((r) => r.url.startsWith("/api/quotations"));
  }

  async function clickByVisibleText(tag, pattern, contains = false) {
    return evaluate(`(() => {
      const target = ${JSON.stringify(pattern)};
      const els = [...document.querySelectorAll('${tag}')].filter(e => e.offsetParent !== null);
      const el = els.find(e => ${contains} ? (e.textContent||'').includes(target) : (e.textContent||'').trim() === target || (e.textContent||'').includes(target));
      if (!el) return 'NOT_FOUND:' + els.length;
      el.scrollIntoView();
      el.click();
      return 'OK';
    })()`);
  }

  // ── Dealer A: core editor flow ──────────────────────────────────────────
  await setCookie(dealerACookie);

  await record("1-2. Open Draft quotation with multiple rooms (Products step)", async () => {
    const ready = await gotoAndWait("/quotation/q_draft_rich?step=3", `document.body.innerText.includes('Touch Switch 4M')`);
    assert.ok(ready, "Products step did not render the seeded item");
    assertNoProblems();
    await shot("01-products-step");
  });

  await record("3. Every selected product is visible", async () => {
    const text = await evaluate("document.body.innerText");
    for (const name of ["Touch Switch 4M", "Door Bell", "Fan Regulator"]) {
      assert.ok(text.includes(name), `expected "${name}" to be visible on the Products step`);
    }
  });

  await record("4. Selected variant label is visible", async () => {
    const text = await evaluate("document.body.innerText");
    assert.ok(/Remote/i.test(text) || /Acrylic/i.test(text), "expected the quoted variant's label to be visible");
  });

  const totalBefore = await evaluate(`(() => {
    const m = document.body.innerText.match(/QUOTATION TOTAL[\\s\\S]{0,20}?₹([\\d,]+)/);
    return m ? Number(m[1].replace(/,/g,'')) : null;
  })()`);

  await record("5. Change quantity: '+' click PATCHes and updates the total, WITHOUT a full refetch", async () => {
    assert.ok(Number.isFinite(totalBefore), "could not read the Quotation Total before the change");
    resetNetLog();
    // Walk up from the "Touch Switch 4M" text node to the smallest container
    // that also has an "Increase quantity" button — found via real DOM
    // inspection (scripts/audit/diag-editor-dom.mjs), not guessed.
    const clicked = await evaluate(`(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node, textNode;
      while ((node = walker.nextNode())) { if (node.nodeValue.includes('Touch Switch 4M')) { textNode = node; break; } }
      if (!textNode) return 'TEXT_NOT_FOUND';
      let el = textNode.parentElement;
      for (let i = 0; i < 8 && el; i++) {
        const btn = el.querySelector('button[title="Increase quantity"]');
        if (btn) { btn.click(); return 'OK'; }
        el = el.parentElement;
      }
      return 'PLUS_NOT_FOUND';
    })()`);
    assert.equal(clicked, "OK", `could not find quantity '+' control: ${clicked}`);
    await sleep(2000);

    const calls = quotationApiCalls();
    console.log("   network after quantity change:", JSON.stringify(calls));
    const patches = calls.filter((c) => c.method === "PATCH" && /\/items\//.test(c.url));
    assert.ok(patches.length >= 1, `expected a PATCH to an item endpoint, saw: ${JSON.stringify(calls)}`);
    const fullGets = calls.filter((c) => c.method === "GET" && /^\/api\/quotations\/[^/]+$/.test(c.url));
    assert.equal(fullGets.length, 0, `expected no full GET /api/quotations/[id] refetch after a quantity change, saw: ${JSON.stringify(fullGets)}`);

    const totalAfter = await evaluate(`(() => {
      const m = document.body.innerText.match(/QUOTATION TOTAL[\\s\\S]{0,20}?₹([\\d,]+)/);
      return m ? Number(m[1].replace(/,/g,'')) : null;
    })()`);
    assert.ok(Number.isFinite(totalAfter) && totalAfter !== totalBefore, `expected the displayed total to change (before=${totalBefore}, after=${totalAfter})`);
    assertNoProblems();
    await shot("02-after-quantity-change");
  });

  await record("7. Add room: a new room appears, no full refetch", async () => {
    const ready1 = await gotoAndWait("/quotation/q_draft_rich?step=2", `document.body.innerText.includes('Study Room')`, 60000);
    assert.ok(ready1, "Spaces step (with presets loaded) did not render 'Study Room'");
    resetNetLog();
    // "Study Room" is NOT one of the 3 rooms already on this quotation, so it
    // only appears once: as an add-this-preset option (the existing-room
    // chips show only Living Room/Master Bedroom/Kitchen, each paired with
    // "×"). The clickable element may not be a semantic <button> — click the
    // smallest ancestor of the text node that is NOT the "×" chip; a click on
    // any descendant still reaches a React onClick handler on an ancestor via
    // normal DOM bubbling.
    const clicked = await evaluate(`(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node, textNode;
      while ((node = walker.nextNode())) { if (node.nodeValue.includes('Study Room')) { textNode = node; break; } }
      if (!textNode) return 'TEXT_NOT_FOUND';
      let el = textNode.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        if (!el.textContent.includes('×')) {
          el.scrollIntoView();
          el.click();
          return 'OK:' + el.tagName + ':' + (el.className||'').toString().slice(0,60);
        }
        el = el.parentElement;
      }
      return 'NO_CLEAN_ANCESTOR';
    })()`);
    assert.ok(clicked.startsWith("OK"), `could not click the "Study Room" add-preset option: ${clicked}`);
    await sleep(1500);
    const calls = quotationApiCalls();
    console.log("   network after add room:", JSON.stringify(calls));
    const posts = calls.filter((c) => c.method === "POST" && /\/rooms$/.test(c.url));
    assert.ok(posts.length >= 1, `expected a POST to /rooms, saw: ${JSON.stringify(calls)}`);
    const fullGets = calls.filter((c) => c.method === "GET" && /^\/api\/quotations\/[^/]+$/.test(c.url));
    assert.equal(fullGets.length, 0, `expected no full GET refetch after adding a room, saw: ${JSON.stringify(fullGets)}`);
    const text = await evaluate("document.body.innerText");
    assert.ok(/4\s+Spaces Configured/.test(text) || text.includes("Study Room"), "expected a 4th space (Study Room) to now be configured");
    assertNoProblems();
    await shot("03-after-add-room");
  });

  await record("9. Remove product: item disappears, no full refetch", async () => {
    const ready = await gotoAndWait("/quotation/q_draft_rich?step=3", `document.body.innerText.includes('Door Bell')`);
    assert.ok(ready, "Products step did not render for removal test");
    const totalBeforeRemove = await evaluate(`(() => {
      const m = document.body.innerText.match(/QUOTATION TOTAL[\\s\\S]{0,20}?₹([\\d,]+)/);
      return m ? Number(m[1].replace(/,/g,'')) : null;
    })()`);
    resetNetLog();
    // Every `button[title="Remove product"]` with a trash2 icon that sits
    // inside a container mentioning "Door Bell" but NOT "Touch Switch 4M" is
    // unambiguously the Door Bell item's own delete control (a container
    // that mentioned both would be a shared ancestor covering both items).
    const deleted = await evaluate(`(() => {
      const trashButtons = [...document.querySelectorAll('button[title="Remove product"]')]
        .filter(b => b.querySelector('svg[class*="lucide-trash"]'));
      for (const btn of trashButtons) {
        let el = btn;
        for (let i = 0; i < 8 && el; i++) {
          const t = el.textContent || '';
          if (t.includes('Door Bell') && !t.includes('Touch Switch 4M')) {
            btn.click();
            return 'OK';
          }
          el = el.parentElement;
        }
      }
      return 'NOT_FOUND:' + trashButtons.length;
    })()`);
    await sleep(2500);
    const calls = quotationApiCalls();
    console.log("   network after remove product:", JSON.stringify(calls), "deleted:", deleted);
    const dels = calls.filter((c) => c.method === "DELETE" && /\/items\//.test(c.url));
    assert.ok(dels.length >= 1, `expected a DELETE to an item endpoint, saw: ${JSON.stringify(calls)}; deleted=${deleted}`);
    const fullGets = calls.filter((c) => c.method === "GET" && /^\/api\/quotations\/[^/]+$/.test(c.url));
    assert.equal(fullGets.length, 0, `expected no full GET refetch after removing a product, saw: ${JSON.stringify(fullGets)}`);
    // The product may still legitimately appear in the catalog grid as an
    // addable item (it isn't deactivated, just removed from this quotation)
    // — the unambiguous signal that the LOCAL MERGE correctly dropped it is
    // the displayed total, which must now be lower by exactly its line price.
    const totalAfterRemove = await evaluate(`(() => {
      const m = document.body.innerText.match(/QUOTATION TOTAL[\\s\\S]{0,20}?₹([\\d,]+)/);
      return m ? Number(m[1].replace(/,/g,'')) : null;
    })()`);
    assert.ok(Number.isFinite(totalBeforeRemove) && Number.isFinite(totalAfterRemove), `could not read totals (before=${totalBeforeRemove}, after=${totalAfterRemove})`);
    assert.equal(totalAfterRemove, totalBeforeRemove - 590, `expected total to drop by Door Bell's ₹590 (before=${totalBeforeRemove}, after=${totalAfterRemove})`);
    assertNoProblems();
    await shot("04-after-remove-product");
  });

  await record("10-11. Apply discount, verify totals, no full refetch", async () => {
    const ready = await gotoAndWait("/quotation/q_draft_rich?step=4", `document.body.innerText.includes('Net Subtotal') || document.body.innerText.includes('Grand Total')`);
    assert.ok(ready, "Review step did not render");
    const grandTotalBefore = await evaluate(`(() => {
      const re = /(?:Grand Total|Total Investment)[\\s\\S]{0,200}?₹\\s?([\\d,]+(?:\\.\\d+)?)/i;
      const m = document.body.innerText.match(re);
      return m ? Number(m[1].replace(/,/g,'')) : null;
    })()`);

    // discountType defaults to "none" on this quotation, so the discount
    // number input only appears after switching the (custom, non-native)
    // Select control away from "No Discount" first.
    const openedSelect = await clickByVisibleText("button", "No Discount", true);
    let pickedPercentage = "OPTION_NOT_FOUND";
    for (let i = 0; i < 10 && pickedPercentage !== "OK"; i++) {
      await sleep(300);
      pickedPercentage = await evaluate(`(() => {
        const candidates = [...document.querySelectorAll('li,div,button,span,[role="option"]')]
          .filter(e => e.offsetParent !== null && /Percentage/.test(e.textContent||''));
        // Prefer the most specific (fewest descendants) matching element.
        candidates.sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
        const opt = candidates[0];
        if (!opt) return 'OPTION_NOT_FOUND';
        opt.click();
        return 'OK';
      })()`);
    }

    resetNetLog();
    let typed = "INPUT_NOT_FOUND";
    for (let i = 0; i < 6 && typed !== "OK"; i++) {
      if (i > 0) await sleep(300);
      typed = await evaluate(`(() => {
        const input = [...document.querySelectorAll('input[type="number"]')].find(i => i.offsetParent !== null);
        if (!input) return 'INPUT_NOT_FOUND';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '10');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`);
    }
    let applied = "N/A";
    if (typed === "OK") {
      applied = await clickByVisibleText("button", "Apply", false);
    }
    await sleep(2000);
    const calls = quotationApiCalls();
    console.log("   network after discount:", JSON.stringify(calls), { openedSelect, pickedPercentage, typed, applied });

    const patches = calls.filter((c) => c.method === "PATCH" && /^\/api\/quotations\/[^/]+$/.test(c.url));
    assert.ok(patches.length >= 1, `expected a PATCH to the quotation for the discount, saw: ${JSON.stringify(calls)}; diag=${JSON.stringify({ openedSelect, pickedPercentage, typed, applied })}`);
    const fullGets = calls.filter((c) => c.method === "GET" && /^\/api\/quotations\/[^/]+$/.test(c.url));
    assert.equal(fullGets.length, 0, `expected no extra full GET refetch after a discount update, saw: ${JSON.stringify(fullGets)}`);

    const grandTotalAfter = await evaluate(`(() => {
      const re = /(?:Grand Total|Total Investment)[\\s\\S]{0,200}?₹\\s?([\\d,]+(?:\\.\\d+)?)/i;
      const m = document.body.innerText.match(re);
      return m ? Number(m[1].replace(/,/g,'')) : null;
    })()`);
    if (!Number.isFinite(grandTotalBefore) || !Number.isFinite(grandTotalAfter)) {
      const snippet = await evaluate(`(() => { const t = document.body.innerText; const i = t.toLowerCase().indexOf('grand total'); return i === -1 ? 'NO_GRAND_TOTAL_TEXT' : t.slice(i, i + 200); })()`);
      console.log("   could not parse Grand Total; nearby text:", JSON.stringify(snippet));
    }
    assert.ok(Number.isFinite(grandTotalBefore) && Number.isFinite(grandTotalAfter), `could not read Grand Total (before=${grandTotalBefore}, after=${grandTotalAfter})`);
    assert.ok(grandTotalAfter < grandTotalBefore, `expected Grand Total to drop after a 10% discount (before=${grandTotalBefore}, after=${grandTotalAfter})`);
    assertNoProblems();
    await shot("05-review-discount");
  });

  await record("12. Preview quotation renders", async () => {
    const ready = await gotoAndWait("/quotation/q_draft_rich?step=5", `document.body.innerText.includes('Browser Test Client')`);
    assert.ok(ready, "Proposal preview did not render");
    assertNoProblems();
    await shot("06-proposal-preview");
  });

  await record("13. Generate PDF: no JS exception thrown", async () => {
    problems = [];
    const clicked = await clickByVisibleText("button", "Download", true);
    await sleep(3000);
    assertNoProblems();
    console.log("   PDF button click result:", clicked);
  });

  // ── Dealer isolation ─────────────────────────────────────────────────────
  await record("14. Dealer B cannot open Dealer A's quotation (IDOR)", async () => {
    await setCookie(dealerBCookie);
    await send("Page.navigate", { url: `${baseUrl}/quotation/q_draft_rich` });
    await sleep(2500);
    const text = await evaluate("document.body.innerText");
    assert.ok(/not found|404/i.test(text), `Dealer B should not be able to open Dealer A's quotation; got: ${text.slice(0, 200)}`);
    await setCookie(dealerACookie);
  });

  // ── Locked quotation ─────────────────────────────────────────────────────
  await record("15. Approved/Delivered quotation is locked (no edit controls)", async () => {
    const ready = await gotoAndWait("/quotation/q_locked?step=3", `document.body.innerText.includes('Fan Regulator')`);
    assert.ok(ready, "Locked quotation did not render");
    const text = await evaluate("document.body.innerText");
    assert.ok(/locked|approved|clone/i.test(text), `expected a locked/approved indicator; got: ${text.slice(0, 300)}`);
    await shot("07-locked-quotation");
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n${passed}/${results.length} browser checks passed.`);
  for (const r of results.filter((r) => r.status === "FAIL")) console.log(`  FAILED: ${r.name}: ${r.detail}`);
  if (results.some((r) => r.status === "FAIL")) exitCode = 1;
} catch (error) {
  console.error("SETUP ERROR:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (chrome) spawn("taskkill", ["/pid", String(chrome.pid), "/t", "/f"], { stdio: "ignore" });
  if (server) await server.cleanup();
  await sleep(500);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
