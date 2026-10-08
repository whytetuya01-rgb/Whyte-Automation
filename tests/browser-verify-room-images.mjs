/**
 * Browser verification for the room-image card backgrounds on the
 * "Select Automated Spaces" step. Runs a production build against a
 * throwaway loopback-only database, drives headless Chrome over CDP.
 *
 *   node tests/browser-verify-room-images.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
import { getRoomImage } from "../src/lib/roomImageMap.ts";

const ROOM_NAMES = [
  "Living Room", "Master Bedroom", "Bedroom", "Bedroom 2", "Bedroom 3", "Kitchen", "Dining Room",
  "Balcony", "Study Room", "Home Office", "Home Theatre", "Entrance / Foyer", "Utility Room", "Terrace",
  "Garden", "Gym", "Puja Room", "Store Room", "Corridor", "Staircase", "Garage", "Common Area",
  "Servant Room", "Driver Room", "Guest Room", "Kids Room",
];

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
  server = await startIsolatedServer("room-images", [{ _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, api, baseUrl } = server;

  await db.collection("roomtypes").insertMany(ROOM_NAMES.map((name, i) => ({ _id: i + 1, name, icon: null, isActive: true, sortOrder: i })));
  await db.collection("housetypes").insertMany([
    { _id: 1, name: "3 BHK", isActive: true, sortOrder: 0 },
    { _id: 2, name: "Duplex", isActive: true, sortOrder: 1 },
  ]);

  const cookie = await login("super_admin@example.com", "admin");
  const created = await api(cookie, "POST", "/api/quotations", { clientName: "Room Image Check", houseTypeId: 1 });
  assert.ok(created.status < 300, `create quotation: ${created.text}`);
  const quotationId = created.data.id ?? created.data._id;

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-roomimg-chrome-"));
  const port = 9100 + Math.floor(Math.random() * 400);
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

  // Page helpers evaluated in the browser.
  const HELPERS = `
    window.__cards = () => [...document.querySelectorAll('div.group')].filter(c => c.querySelector('p'));
    window.__cardName = (c) => c.querySelector('p').textContent.trim();
    window.__roomImg = (c) => c.querySelector('[aria-hidden="true"] img');
    window.__imgFile = (img) => { const s = decodeURIComponent(img.currentSrc || img.src); const m = s.match(/room-images\\/([a-z0-9-]+)\\.webp/); return m ? m[1] : null; };
    window.__selectedCards = () => window.__cards().filter(c => window.__roomImg(c));
    window.__presetCard = (name) => window.__cards().find(c => !window.__roomImg(c) && window.__cardName(c) === name);
    true;`;
  const openStep2 = async () => {
    await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}?step=2` });
    await waitFor(`document.body && /Select Automated Spaces/.test(document.body.innerText) && document.querySelectorAll('div.group p').length > 5`, "step 2 render", 60000);
    await evaluate(HELPERS);
  };

  await setViewport(1440, 1000);
  await openStep2();

  // 1. Unselected presets stay clean white cards (no photo).
  const initial = await evaluate(`({ selected: __selectedCards().length, presets: __cards().length, whiteBg: __cards().every(c => getComputedStyle(c).backgroundColor === 'rgb(255, 255, 255)') })`);
  assert.equal(initial.selected, 0, "no card should carry a photo before anything is selected");
  assert.ok(initial.presets >= ROOM_NAMES.length, `expected all ${ROOM_NAMES.length} presets, saw ${initial.presets}`);
  assert.ok(initial.whiteBg, "unselected preset cards must keep their white background");
  pass(`${initial.presets} unselected preset cards render clean (white, no photo)`);
  await shot("01-desktop-unselected");

  // 2. Selecting a preset turns it into the photo card.
  await evaluate(`__presetCard('Living Room').click()`);
  await waitFor(`__selectedCards().some(c => __cardName(c) === 'Living Room')`, "Living Room selected");
  const living = await evaluate(`(() => { const c = __selectedCards().find(c => __cardName(c) === 'Living Room'); const img = __roomImg(c); return { file: __imgFile(img), alt: img.alt, hidden: img.closest('[aria-hidden]')?.getAttribute('aria-hidden'), hasCheck: !!c.querySelector('svg'), removeBtn: c.querySelector('button[aria-label^="Remove"]')?.tagName, addAnother: [...c.querySelectorAll('button')].some(b => /add another/i.test(b.textContent)), hint: c.innerText }; })()`);
  assert.equal(living.file, "living-room");
  assert.equal(living.alt, "", "background photo is decorative (empty alt)");
  assert.equal(living.hidden, "true", "background layer hidden from assistive tech");
  assert.equal(living.removeBtn, "BUTTON");
  assert.ok(living.addAnother, "+ Add another button present");
  assert.match(living.hint, /Selected space|configured/);
  pass("selecting Living Room shows living-room.webp with overlay, check, remove, + Add another");

  // 3. Add Another creates a second instance with the same photo.
  await evaluate(`[...__selectedCards().find(c => __cardName(c) === 'Living Room').querySelectorAll('button')].find(b => /add another/i.test(b.textContent)).click()`);
  await waitFor(`__selectedCards().filter(c => /^Living Room/.test(__cardName(c))).length === 2`, "second Living Room");
  const twoFiles = await evaluate(`__selectedCards().filter(c => /^Living Room/.test(__cardName(c))).map(c => __imgFile(__roomImg(c)))`);
  assert.deepEqual(twoFiles, ["living-room", "living-room"]);
  const roomsAfterAdd = await api(cookie, "GET", `/api/quotations/${quotationId}`);
  assert.equal(roomsAfterAdd.data.rooms.length, 2, "Add Another persisted a second room");
  pass("+ Add another adds a second Living Room (persisted), both with the photo");

  // 4. Deselect via × → confirm dialog → removed.
  await evaluate(`__selectedCards().filter(c => /^Living Room/.test(__cardName(c)))[1].querySelector('button[aria-label^="Remove"]').click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Remove Space')`, "confirm dialog");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Remove Space').click()`);
  await waitFor(`__selectedCards().filter(c => /^Living Room/.test(__cardName(c))).length === 1`, "one Living Room left");
  const roomsAfterRemove = await api(cookie, "GET", `/api/quotations/${quotationId}`);
  assert.equal(roomsAfterRemove.data.rooms.length, 1, "remove persisted");
  pass("× → confirm removes one instance (persisted); the other keeps its photo");

  // 5. Select every remaining preset through the UI, then check each card's photo.
  for (const name of ROOM_NAMES.filter((n) => n !== "Living Room")) {
    await evaluate(`__presetCard(${JSON.stringify(name)}).click()`);
    await waitFor(`__selectedCards().some(c => __cardName(c) === ${JSON.stringify(name)})`, `${name} selected`);
  }
  await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
  await sleep(800);
  await evaluate(`window.scrollTo(0, 0)`);
  const cards = await evaluate(`Promise.all(__selectedCards().map(async c => { const img = __roomImg(c); c.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 120)); if (!img.complete) await new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000); }); return { name: __cardName(c), file: __imgFile(img), loaded: img.complete && img.naturalWidth > 0, loading: img.getAttribute('loading') }; }))`);
  assert.equal(cards.length, ROOM_NAMES.length, `expected ${ROOM_NAMES.length} selected cards, saw ${cards.length}`);
  const mapping = [];
  for (const c of cards) {
    const expected = getRoomImage(c.name).file;
    assert.equal(c.file, expected, `${c.name}: expected ${expected}, rendered ${c.file}`);
    assert.ok(c.loaded, `${c.name}: image did not load`);
    mapping.push(`${c.name} → ${c.file}`);
  }
  pass(`all ${cards.length} room presets render their mapped photo and load:\n      ${mapping.join("\n      ")}`);
  assert.ok(cards.every((c) => c.loading === "lazy"), "card photos are lazy-loaded");
  pass("card photos are lazy-loaded (loading=lazy)");
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(300);
  await shot("02-desktop-all-selected");

  // 6. Readability: text sits on the dark overlay and is white.
  const readability = await evaluate(`__selectedCards().every(c => { const overlay = c.querySelector('[aria-hidden="true"] > div'); const bg = getComputedStyle(overlay).backgroundColor; const name = getComputedStyle(c.querySelector('p')).color; const op = parseFloat((bg.match(/[\\d.]+(?=\\))/) || [1])[0]); return name === 'rgb(255, 255, 255)' && op >= 0.6 && !/gradient/.test(getComputedStyle(overlay).backgroundImage); })`);
  assert.ok(readability, "every selected card has white text over a ≥60% flat dark overlay (no gradient)");
  pass("white room names over a flat ≥60% dark overlay (no gradient) on every card");

  // 7. Keyboard: buttons in a photo card are reachable and focusable.
  const focusable = await evaluate(`(() => { const b = __selectedCards()[0].querySelector('button[aria-label^="Remove"]'); b.focus(); return document.activeElement === b; })()`);
  assert.ok(focusable, "remove button focusable");
  pass("card buttons remain real, focusable <button>s");

  // 8. Image payload.
  const perf = await evaluate(`(() => { const e = performance.getEntriesByType('resource').filter(r => /room-images/.test(decodeURIComponent(r.name))); return { count: e.length, kb: Math.round(e.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024), maxMs: Math.round(Math.max(0, ...e.map(r => r.duration))) }; })()`);
  pass(`room photos fetched: ${perf.count} requests, ~${perf.kb} KB total, slowest ${perf.maxMs} ms`);

  // 9. Responsive: no page-level horizontal scroll.
  for (const [label, w, h, mobile] of [["desktop", 1440, 1000, false], ["tablet", 820, 1180, true], ["mobile", 390, 844, true]]) {
    await setViewport(w, h, mobile);
    await openStep2();
    await sleep(600);
    const overflow = await evaluate(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cardsWithin: __selectedCards().every(c => c.getBoundingClientRect().right <= window.innerWidth + 1) })`);
    assert.ok(overflow.sw <= overflow.iw, `${label}: horizontal overflow ${overflow.sw} > ${overflow.iw}`);
    assert.ok(overflow.cardsWithin, `${label}: a card overflows the viewport`);
    const firstCard = await evaluate(`(() => { const c = __selectedCards()[0]; c.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); return true; })()`);
    assert.ok(firstCard);
    await sleep(500);
    await shot(`03-${label}`);
    pass(`${label} ${w}px: no horizontal page scroll, cards fit the viewport`);
  }
  await setViewport(1440, 1000);

  // 10. Floor/location tab (multi-floor house): photo cards, dropdown not clipped.
  const patched = await api(cookie, "PATCH", `/api/quotations/${quotationId}`, { houseTypeId: 2 });
  assert.ok(patched.status < 300, `switch to Duplex: ${patched.text}`);
  await openStep2();
  await waitFor(`[...document.querySelectorAll('button')].some(b => /2\\. Floor \\/ Location/i.test(b.textContent))`, "floor tab button");
  await evaluate(`[...document.querySelectorAll('button')].find(b => /2\\. Floor \\/ Location/i.test(b.textContent)).click()`);
  await waitFor(`/Floor \\/ Location Assignment/i.test(document.body.innerText) && __selectedCards().length > 0`, "floor tab");
  const floorCards = await evaluate(`__selectedCards().map(c => __imgFile(__roomImg(c)))`);
  assert.equal(floorCards.length, ROOM_NAMES.length);
  assert.ok(floorCards.every(Boolean), "every floor card has a photo");
  const dropdown = await evaluate(`(async () => {
    const card = __selectedCards()[0];
    card.scrollIntoView({ block: 'center' });
    const trigger = card.querySelector('button[aria-haspopup="listbox"]');
    trigger.click();
    await new Promise(r => setTimeout(r, 300));
    const opts = [...document.querySelectorAll('[role="option"]')];
    const last = opts[opts.length - 1];
    if (!last) return { opened: false };
    last.scrollIntoView({ block: 'nearest' });
    const r = last.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { opened: true, options: opts.length, clipped: !(hit && last.contains(hit)), beyondCard: r.bottom > card.getBoundingClientRect().bottom };
  })()`);
  assert.ok(dropdown.opened, "floor dropdown opened");
  assert.equal(dropdown.clipped, false, "floor dropdown options are not clipped by the card");
  await shot("04-floor-tab-dropdown");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  pass(`floor tab: ${floorCards.length} photo cards; floor dropdown opens unclipped (${dropdown.options} options, extends past card: ${dropdown.beyondCard})`);

  // 11. Console / network health.
  const relevantErrors = consoleErrors.filter(Boolean);
  const relevantBad = badResponses.filter((r) => !/favicon/.test(r));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  assert.deepEqual(relevantBad, [], `failed requests: ${relevantBad.join(" | ")}`);
  pass("no console errors, no failed (4xx/5xx) requests");

  console.log(`\nRoom image browser verification PASSED (${results.length} checks).`);
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
