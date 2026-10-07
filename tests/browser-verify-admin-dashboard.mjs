import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Real-browser check of the admin dashboard at desktop / tablet / mobile widths,
 * against a production build and a throwaway database seeded with quotations
 * across several months and statuses. Screenshots go to argv[2].
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

try {
  server = await startIsolatedServer(
    "dash",
    [
      { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Smartnode Automations", discountAllocationPercent: 20 },
    ],
    { production: true }
  );
  const { db, login, baseUrl } = server;
  const adminCookie = await login("super_admin@example.com", "admin");

  // ---- Seed realistic data over the last six months -------------------------------------------
  const now = new Date();
  const monthsAgo = (n, day = 10) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day, 6, 0, 0));
  const plan = [
    // [monthsAgo, status, dealerId|null, subtotal, customerDiscount]
    [5, "draft", null, 40000, 0], [5, "rejected", 1, 30000, 5],
    [4, "approved", 1, 100000, 10], [4, "sent", null, 25000, 0],
    [3, "delivered", 1, 150000, 5], [3, "approved", null, 80000, 0], [3, "draft", 1, 20000, 0],
    [2, "approved", 1, 120000, 10], [2, "sent", 1, 60000, 0], [2, "rejected", null, 15000, 0],
    [1, "delivered", 1, 200000, 15], [1, "approved", 1, 90000, 0], [1, "draft", null, 30000, 0], [1, "sent", 1, 45000, 5],
    [0, "approved", 1, 110000, 10], [0, "draft", 1, 50000, 0], [0, "sent", null, 70000, 0],
  ];
  let seq = 1;
  let roomSeq = 100;
  for (const [ago, status, dealerId, subtotal, customer] of plan) {
    const id = `q_seed_${seq}`;
    const createdAt = monthsAgo(ago);
    await db.collection("quotations").insertOne({
      _id: id,
      quotationNumber: `QT-2026-${String(seq).padStart(3, "0")}`,
      clientName: ["Rajesh Sharma", "Meera Patel", "Anil Kapoor", "Sunita Rao", "Vikram Shah", "Neha Joshi"][seq % 6],
      status,
      dealerId,
      createdBy: dealerId ? "1" : "4",
      allocatedDiscountPercent: dealerId ? 20 : 0,
      customerDiscountPercent: customer,
      discountType: customer > 0 ? "percentage" : "none",
      discountValue: customer > 0 ? Decimal128.fromString(customer.toFixed(2)) : null,
      estimatedEarningAmount: Decimal128.fromString("0"),
      createdAt,
      updatedAt: createdAt,
    });
    const roomId = roomSeq++;
    await db.collection("quotationrooms").insertOne({ _id: roomId, quotationId: id, sortOrder: 0, createdAt, updatedAt: createdAt });
    await db.collection("quotationitems").insertOne({
      _id: roomSeq++, quotationRoomId: roomId, productId: 1, quantity: 1,
      unitPrice: Decimal128.fromString(subtotal.toFixed(2)), sortOrder: 0,
    });
    seq++;
  }
  await db.collection("categories").insertMany([
    { _id: 1, name: "Tactus", level: 1, isActive: true, sortOrder: 1 },
    { _id: 2, name: "Accessories", level: 1, isActive: true, sortOrder: 2 },
  ]);
  const types = ["switch_board", "switch_board", "switch_board", "accessory", "accessory", "curtain", "smart_lock", "vdp"];
  await db.collection("products").insertMany(
    types.map((type, i) => ({
      _id: i + 1, name: `${["Touch Switch 4M", "Touch Switch 8M", "Fan Regulator", "Door Bell", "Wi-Fi Hub", "Curtain Motor", "Smart Lock Pro", "Video Door Phone"][i]}`,
      code: `WH-${100 + i}`, type, categoryId: i < 3 ? 1 : 2, price: Decimal128.fromString(String(4000 + i * 1500)),
      isActive: i !== 6, isMatrix: i < 2, sortOrder: i, createdAt: monthsAgo(0, 1 + i), updatedAt: new Date(),
    }))
  );

  // ---- Drive the browser -----------------------------------------------------------------------
  profileDir = await mkdtemp(join(tmpdir(), "whyte-dash-chrome-"));
  const port = 9300 + Math.floor(Math.random() * 500);
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
  const problems = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") problems.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 300));
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push(`console.error ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 300));
    else if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  for (const pair of adminCookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }

  const viewports = [
    { name: "desktop", width: 1440, height: 2100, mobile: false },
    { name: "tablet", width: 820, height: 2700, mobile: true },
    { name: "mobile", width: 390, height: 3800, mobile: true },
  ];

  for (const vp of viewports) {
    problems.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await send("Page.navigate", { url: `${baseUrl}/admin/dashboard` });
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(700);
      ready = await evaluate(`document.body && /Quotation Performance/i.test(document.body.innerText)`).catch(() => false);
    }
    assert.ok(ready, `${vp.name}: dashboard did not render`);
    await sleep(800);

    const report = JSON.parse(await evaluate(`JSON.stringify({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      kpis: [...document.querySelectorAll('a[href^="/admin/quotations"], a[href="/admin/dealers"]')].filter(a => a.querySelector('p.text-2xl')).map(a => a.innerText.replace(/\\s+/g,' ').trim()),
      barTotals: [...document.querySelectorAll('svg[role="img"] text')].map(t => t.textContent).join(','),
      rows: document.querySelectorAll('tbody tr').length,
      h1: document.querySelector('h1')?.innerText,
      pageHeight: document.documentElement.scrollHeight,
    })`));
    console.log(`\n[${vp.name} ${vp.width}px]`, JSON.stringify(report));
    assert.ok(report.scrollW <= report.clientW + 1, `${vp.name}: horizontal overflow (${report.scrollW} > ${report.clientW})`);
    assert.equal(report.h1, "Dashboard");
    if (problems.length) console.log("  PROBLEMS:", [...new Set(problems)].slice(0, 8));
    assert.equal(problems.filter((p) => !p.includes("favicon")).length, 0, `${vp.name}: browser errors: ${problems.join(" | ")}`);

    if (shotDir) {
      await mkdir(shotDir, { recursive: true });
      const metrics = await send("Page.getLayoutMetrics");
      const height = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height, scale: 1 } });
      await writeFile(join(shotDir, `dashboard-${vp.name}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  console.log("\nAdmin dashboard browser verification PASSED (desktop, tablet, mobile).");
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
