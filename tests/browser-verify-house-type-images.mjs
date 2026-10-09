/**
 * Browser verification for the house-type card background images on
 * /admin/house-types. Runs a production build against a throwaway
 * loopback-only database, drives headless Chrome over CDP.
 *
 *   node tests/browser-verify-house-type-images.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
import { HOUSE_TYPE_IMAGES } from "../src/lib/houseTypeImageMap.ts";

const HOUSE_TYPES = [
  { _id: 1, name: "1 BHK", description: "1 Bedroom, Hall, Kitchen", isActive: true, sortOrder: 0 },
  { _id: 2, name: "2 BHK", description: "2 Bedrooms, Hall, Kitchen", isActive: true, sortOrder: 10 },
  { _id: 3, name: "3 BHK", description: "3 Bedrooms, Hall, Kitchen", isActive: true, sortOrder: 20 },
  { _id: 4, name: "4 BHK", description: "4 Bedrooms, Hall, Kitchen", isActive: true, sortOrder: 30 },
  { _id: 5, name: "Duplex", description: "Duplex with multiple floors", isActive: true, sortOrder: 40 },
  { _id: 6, name: "Villa", description: "Independent villa / bungalow", isActive: true, sortOrder: 50 },
  { _id: 7, name: "Penthouse", description: "Luxury penthouse apartment", isActive: true, sortOrder: 60 },
  { _id: 12, name: "Residential / Apartment", description: "Standard residential apartment", isActive: true, sortOrder: 70 },
  { _id: 13, name: "Luxury Villa", description: "Premium villa with luxury specification", isActive: true, sortOrder: 80 },
  { _id: 14, name: "Commercial / Retail", description: "Commercial or retail space", isActive: true, sortOrder: 90 },
  { _id: 15, name: "Corporate Office", description: "Corporate office space", isActive: true, sortOrder: 100 },
  { _id: 16, name: "Hospitality / Hotel", description: "Hotel or hospitality project", isActive: true, sortOrder: 110 },
];
const ROOM_NAMES = ["Living Room", "Master Bedroom", "Kitchen"];

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
  server = await startIsolatedServer("house-type-images", [{ _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, baseUrl } = server;

  await db.collection("roomtypes").insertMany(ROOM_NAMES.map((name, i) => ({ _id: i + 1, name, icon: null, isActive: true, sortOrder: i })));
  await db.collection("housetypes").insertMany(HOUSE_TYPES);
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 0 },
    { _id: 2, houseTypeId: 1, roomTypeId: 3, defaultCount: 1, sortOrder: 1 },
    { _id: 3, houseTypeId: 6, roomTypeId: 1, defaultCount: 2, sortOrder: 0 },
    { _id: 4, houseTypeId: 6, roomTypeId: 2, defaultCount: 3, sortOrder: 1 },
  ]);

  const cookie = await login("super_admin@example.com", "admin");

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-htimg-chrome-"));
  const port = 9500 + Math.floor(Math.random() * 400);
  chrome = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--window-size=1440,1200", "about:blank"], { stdio: "ignore" });
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
  const badResponses = [];
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
    } else if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
      badResponses.push(`${msg.params.response.status} ${msg.params.response.url}`);
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
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  for (const pair of cookie.split("; ")) {
    const i = pair.indexOf("=");
    await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
  }
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const shot = async (name) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };
  const setViewport = (width, height, mobile = false) =>
    send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });

  const HELPERS = `
    window.__cards = () => [...document.querySelectorAll('h3')].map(h => h.closest('.rounded-2xl.border'));
    window.__cardTitle = (c) => c.querySelector('h3').textContent.trim();
    window.__cardImg = (c) => c.querySelector('img');
    window.__imgFile = (img) => { const s = decodeURIComponent(img.currentSrc || img.src); const m = s.match(/(house-type-images|room-images)\\/([a-z0-9-]+)\\.webp/); return m ? m[2] : null; };
    true;`;
  const open = async () => {
    await send("Page.navigate", { url: `${baseUrl}/admin/house-types` });
    await waitFor(`document.body && /House Types/.test(document.body.innerText) && document.querySelectorAll('h3').length >= ${HOUSE_TYPES.length}`, "house types render", 60000);
    await evaluate(HELPERS);
  };

  await setViewport(1440, 1200);
  await open();

  // 1. Every house type renders a card with an image, and the image matches the explicit id-keyed mapping.
  const cards = await evaluate(`Promise.all(__cards().map(async c => { const img = __cardImg(c); c.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 60)); if (!img.complete) await new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000); }); return { title: __cardTitle(c), file: __imgFile(img), loaded: img.complete && img.naturalWidth > 0, alt: img.alt }; }))`);
  assert.equal(cards.length, HOUSE_TYPES.length, `expected ${HOUSE_TYPES.length} cards, saw ${cards.length}`);
  const byName = new Map(HOUSE_TYPES.map((h) => [h.name, h._id]));
  const mapping = [];
  for (const c of cards) {
    const id = byName.get(c.title);
    assert.ok(id, `unexpected card title "${c.title}"`);
    const expected = HOUSE_TYPE_IMAGES[id].src.split("/").pop().replace(".webp", "");
    assert.equal(c.file, expected, `${c.title}: expected image "${expected}", rendered "${c.file}"`);
    assert.ok(c.loaded, `${c.title}: image did not load`);
    assert.equal(c.alt, "", `${c.title}: decorative image should have empty alt`);
    mapping.push(`${c.title} → ${c.file}.webp`);
  }
  pass(`all ${cards.length} house types render their mapped image and load:\n      ${mapping.join("\n      ")}`);
  await shot("01-desktop-collapsed");

  // 2. Duplex correctly reuses the existing staircase room image (no duplicate asset).
  const duplexFile = cards.find((c) => c.title === "Duplex").file;
  assert.equal(duplexFile, "staircase", "Duplex should reuse the existing staircase.webp room image");
  pass("Duplex reuses the existing room-images/staircase.webp asset (no duplicate download)");

  // 3. Text readability: title is near-black text (dark enough over the light overlay), actually laid out, and bold.
  const titleStyles = await evaluate(`__cards().map(c => { const h3 = c.querySelector('h3'); const r = h3.getBoundingClientRect(); const probe = document.createElement('canvas').getContext('2d'); probe.fillStyle = getComputedStyle(h3).color; probe.fillRect(0, 0, 1, 1); const [cr, cg, cb] = probe.getImageData(0, 0, 1, 1).data; return { title: h3.textContent.trim(), rgb: [cr, cg, cb], fontWeight: getComputedStyle(h3).fontWeight, width: r.width, height: r.height }; })`);
  for (const t of titleStyles) {
    const [r, g, b] = t.rgb;
    assert.ok(r < 60 && g < 60 && b < 60, `${t.title}: title color rgb(${r},${g},${b}) is not dark enough over the photo overlay`);
    assert.ok(Number(t.fontWeight) >= 700, `${t.title}: title is not bold (weight ${t.fontWeight})`);
    assert.ok(t.width > 0 && t.height > 0, `${t.title}: title has no rendered layout size`);
  }
  pass(`all ${titleStyles.length} card titles render dark/bold (e.g. "${titleStyles[0].title}" rgb(${titleStyles[0].rgb.join(",")})) and readable over the photo banner`);

  // 4. Expand a card: room/space allocation still visible, no image duplicated in the expanded body, not excessively tall.
  await evaluate(`__cards().find(c => __cardTitle(c) === '1 BHK').querySelector('h3').click()`);
  await sleep(500);
  const debugState = await evaluate(`(() => { const c = __cards().find(x => __cardTitle(x) === '1 BHK'); return { innerText: c.innerText.slice(0, 300), html: c.outerHTML.slice(0, 800) }; })()`);
  console.log("DEBUG after click:", JSON.stringify(debugState, null, 2));
  await waitFor(`[...document.querySelectorAll('h3')].find(h => h.textContent.trim() === '1 BHK').closest('.rounded-2xl.border').innerText.includes('Room / Space Allocation')`, "1 BHK expanded");
  const expanded = await evaluate(`(() => {
    const c = __cards().find(x => __cardTitle(x) === '1 BHK');
    const rect = c.getBoundingClientRect();
    const imgsInCard = c.querySelectorAll('img').length;
    const expandedSection = [...c.querySelectorAll('div')].find(d => d.textContent.includes('Room / Space Allocation'));
    return { height: rect.height, imgsInCard, hasAllocation: !!expandedSection, allocationText: expandedSection ? expandedSection.parentElement.textContent.slice(0, 200) : null };
  })()`);
  assert.equal(expanded.imgsInCard, 1, "expanded card should still carry exactly one image (header banner only, none duplicated into the expanded body)");
  assert.ok(expanded.hasAllocation, "expanded card shows Room / Space Allocation");
  assert.ok(expanded.height < 650, `expanded card is excessively tall: ${expanded.height}px`);
  pass(`expanded card: 1 image (no duplication), room allocation visible, height ${Math.round(expanded.height)}px (not excessively tall)`);
  await shot("02-desktop-expanded");

  // 5. Edit action still works (opens the modal) from inside the photo banner.
  await evaluate(`[...document.querySelectorAll('h3')].find(h => h.textContent.trim() === '1 BHK').closest('.rounded-2xl.border').querySelector('button[title="Edit House Type"]').click()`);
  await waitFor(`/Edit Template: 1 BHK/.test(document.body.innerText)`, "edit modal open");
  pass("Edit action (inside the photo banner) still opens the edit modal");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Close' || b.textContent.trim() === '×')?.click()`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);

  // 6. Villa (has a room template) still shows its real composition line, unaffected by the image redesign.
  const villaComposition = await evaluate(`(() => { const c = __cards().find(x => __cardTitle(x) === 'Villa'); return c.innerText; })()`);
  assert.match(villaComposition, /Living Room|Master Bedroom/, "Villa's real room composition line still renders");
  pass("Villa's room composition line (from real room-template data) still renders correctly");

  // 7. Responsive: no horizontal page overflow at desktop/tablet/mobile.
  for (const [label, w, h, mobile] of [["desktop", 1440, 1000, false], ["tablet", 820, 1300, true], ["mobile", 390, 1400, true]]) {
    await setViewport(w, h, mobile);
    await open();
    await sleep(500);
    const overflow = await evaluate(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cardsWithin: __cards().every(c => c.getBoundingClientRect().right <= window.innerWidth + 1) })`);
    assert.ok(overflow.sw <= overflow.iw + 1, `${label}: horizontal overflow ${overflow.sw} > ${overflow.iw}`);
    assert.ok(overflow.cardsWithin, `${label}: a card overflows the viewport`);
    await shot(`03-${label}`);
    pass(`${label} ${w}px: no horizontal page scroll, cards fit the viewport`);
  }
  await setViewport(1440, 1000);

  // 8. Console / network health.
  const relevantErrors = consoleErrors.filter(Boolean);
  const relevantBad = badResponses.filter((r) => !/favicon/.test(r));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  assert.deepEqual(relevantBad, [], `failed requests: ${relevantBad.join(" | ")}`);
  pass("no console errors, no failed (4xx/5xx) requests");

  console.log(`\nHouse-type image browser verification PASSED (${results.length} checks).`);
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
