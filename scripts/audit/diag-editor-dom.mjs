import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "../../tests/helpers/isolatedServer.mjs";

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browserPath = BROWSERS.find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, chrome, profileDir;

try {
  server = await startIsolatedServer("diagdom", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
  ]);
  const { db, login, baseUrl } = server;
  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("products").insertMany([
    { _id: 1, name: "Touch Switch 4M", code: "WH-101", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: true, matrixDimensions: [{ key: "series", label: "Series", options: ["remote", "wifi"] }], createdAt: new Date(), updatedAt: new Date() },
    { _id: 3, name: "Door Bell", code: "WH-103", type: "accessory", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 3, isMatrix: false, matrixDimensions: null, createdAt: new Date(), updatedAt: new Date() },
  ]);
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "V1", automationTier: "remote", surfaceFinish: "acrylic", config: {}, price: Decimal128.fromString("2599.00"), priceWithoutTax: Decimal128.fromString("2202.54"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
    { _id: 4, productId: 3, variantCode: "V2", config: {}, price: Decimal128.fromString("590.00"), priceWithoutTax: Decimal128.fromString("500.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, name: "Master Bedroom", isActive: true, sortOrder: 2 },
    { _id: 3, name: "Kitchen", isActive: true, sortOrder: 3 },
  ]);
  const now = new Date();
  await db.collection("quotations").insertOne({ _id: "q1", quotationNumber: "QT-D1", clientName: "Diag Client", status: "draft", dealerId: 1, createdBy: "1", allocatedDiscountPercent: 30, customerDiscountPercent: 0, discountType: "none", discountValue: null, estimatedEarningAmount: Decimal128.fromString("0.00"), createdAt: now, updatedAt: now });
  await db.collection("quotationrooms").insertOne({ _id: 101, quotationId: "q1", roomTypeId: 1, customName: null, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.collection("quotationitems").insertMany([
    { _id: 1001, quotationRoomId: 101, productId: 1, productVariantId: 1, variantLabel: "Remote", variantConfig: {}, quantity: 2, unitPrice: Decimal128.fromString("2599.00"), sortOrder: 0 },
    { _id: 1002, quotationRoomId: 101, productId: 3, productVariantId: 4, variantLabel: null, variantConfig: {}, quantity: 1, unitPrice: Decimal128.fromString("590.00"), sortOrder: 0 },
  ]);
  const cookie = await login("dealer_a@example.com", "user");

  profileDir = await mkdtemp(join(tmpdir(), "whyte-diag-chrome-"));
  const port = 9700;
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { }
    if (!target) await sleep(500);
  }
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
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  for (const pair of cookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  console.log("=== STEP 3 (Products) ===");
  await send("Page.navigate", { url: `${baseUrl}/quotation/q1?step=3` });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ready = await evaluate(`document.body.innerText.includes('Touch Switch 4M')`).catch(() => false);
    if (ready) break;
  }
  await sleep(1000);
  const plusMinus = await evaluate(`JSON.stringify([...document.querySelectorAll('svg')].filter(s => (s.getAttribute('class')||'').match(/plus|minus/)).map(s => ({
    svgClass: s.getAttribute('class'),
    btnOuter: (s.closest('button')||{}).outerHTML?.slice(0,400) || 'NO_BUTTON_PARENT',
  })))`);
  console.log("--- plus/minus svg icons on Products step ---");
  console.log(plusMinus);

  const trashIcons = await evaluate(`JSON.stringify([...document.querySelectorAll('svg')].filter(s => (s.getAttribute('class')||'').match(/trash|x-circle|delete/i)).map(s => ({
    svgClass: s.getAttribute('class'),
    btnOuter: (s.closest('button')||{}).outerHTML?.slice(0,300) || 'NO_BUTTON_PARENT',
    nearText: (s.closest('button')?.closest('[class]')?.textContent||'').slice(0,80),
  })))`);
  console.log("--- trash/delete svg icons on Products step ---");
  console.log(trashIcons);

  const doorBellCtx = await evaluate(`(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, textNode;
    while ((node = walker.nextNode())) { if (node.nodeValue.includes('Door Bell')) { textNode = node; break; } }
    if (!textNode) return 'TEXT_NOT_FOUND';
    let el = textNode.parentElement;
    for (let i = 0; i < 6 && el; i++) {
      if (el.querySelectorAll('button').length >= 1 && el.querySelectorAll('button').length <= 6) {
        return { depth: i, buttons: [...el.querySelectorAll('button')].map(b=>({text:b.textContent.trim().slice(0,30), svgClass: b.querySelector('svg')?.getAttribute('class')})), html: el.outerHTML.slice(0,1500) };
      }
      el = el.parentElement;
    }
    return 'NO_SMALL_CONTAINER';
  })()`);
  console.log("--- Door Bell ancestor search ---");
  console.log(JSON.stringify(doorBellCtx, null, 2));

  console.log("\n=== STEP 2 (Spaces) ===");
  await send("Page.navigate", { url: `${baseUrl}/quotation/q1?step=2` });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ready = await evaluate(`document.body.innerText.includes('Living Room')`).catch(() => false);
    if (ready) break;
  }
  await sleep(1000);
  const buttons = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b => ({text:b.textContent.trim().replace(/\\s+/g,' ').slice(0,40), svgClass: b.querySelector('svg')?.getAttribute('class'), outer: b.outerHTML.slice(0,200)})))`);
  console.log("--- visible buttons on Spaces step (with svg class) ---");
  console.log(buttons);
  const bodyText = await evaluate(`document.body.innerText.slice(0, 1500)`);
  console.log("--- body text snippet ---");
  console.log(bodyText);
  const pageHeight = await evaluate(`document.documentElement.scrollHeight`);
  console.log("page scrollHeight:", pageHeight);
  const fullText = await evaluate(`document.body.innerText`);
  console.log("--- FULL body text ---");
  console.log(fullText);
  const allButtons = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map(b => ({text:b.textContent.trim().replace(/\\s+/g,' ').slice(0,50), visible: b.offsetParent!==null})))`);
  console.log("--- ALL buttons (incl. hidden) ---");
  console.log(allButtons);

  process.exit(0);
} catch (error) {
  console.error("DIAG ERROR:", error.stack || error);
  process.exitCode = 1;
} finally {
  if (chrome) spawn("taskkill", ["/pid", String(chrome.pid), "/t", "/f"], { stdio: "ignore" });
  if (server) await server.cleanup();
  await sleep(300);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(process.exitCode ?? 0);
}
