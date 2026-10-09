/**
 * Browser verification for Room Type / House Type delete functionality:
 *   - Super Admin sees Delete buttons on both pages; Admin does not.
 *   - Deleting an unused record succeeds.
 *   - Deleting a record with dependencies (room template / quotation) is blocked
 *     with a clear error, and the record is NOT removed.
 *
 *   node tests/browser-verify-catalog-delete.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

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
  server = await startIsolatedServer(
    "catalog-delete",
    [
      { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 5, email: "admin@example.com", role: "admin", name: "Regular Admin" },
    ],
    { production: true }
  );
  const { db, login, baseUrl } = server;

  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Unused Room", icon: null, isActive: true, sortOrder: 0 },
    { _id: 2, name: "Used Room", icon: null, isActive: true, sortOrder: 1 },
  ]);
  await db.collection("housetypes").insertMany([
    { _id: 1, name: "Unused House Type", description: null, isActive: true, sortOrder: 0 },
    { _id: 2, name: "Used House Type", description: null, isActive: true, sortOrder: 1 },
  ]);
  // "Used Room" is referenced by a template on "Used House Type" — both become non-deletable.
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, houseTypeId: 2, roomTypeId: 2, defaultCount: 1, sortOrder: 0 },
  ]);

  const superCookie = await login("super_admin@example.com", "admin");
  const adminCookie = await login("admin@example.com", "admin");

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-catdel-chrome-"));
  const port = 9900 + Math.floor(Math.random() * 400);
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
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
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
  const setCookies = async (cookie) => {
    for (const pair of cookie.split("; ")) {
      const i = pair.indexOf("=");
      await send("Network.setCookie", { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl });
    }
  };
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const shot = async (name) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  // ── 1. Regular Admin: no Delete button on either page ──────────────────
  await setCookies(adminCookie);
  await send("Page.navigate", { url: `${baseUrl}/admin/room-types` });
  await waitFor(`document.body && /Room Types/.test(document.body.innerText) && document.querySelectorAll('h3').length >= 2`, "room types render (admin)", 60000);
  const adminRoomDelete = await evaluate(`document.querySelectorAll('button[title="Delete Room Type"]').length`);
  assert.equal(adminRoomDelete, 0, "regular admin should not see a Delete Room Type button");
  pass("Regular Admin: no Delete button on Room Types page");

  await send("Page.navigate", { url: `${baseUrl}/admin/house-types` });
  await waitFor(`document.body && /House Types/.test(document.body.innerText) && document.querySelectorAll('h3').length >= 2`, "house types render (admin)", 60000);
  const adminHouseDelete = await evaluate(`document.querySelectorAll('button[title="Delete House Type"]').length`);
  assert.equal(adminHouseDelete, 0, "regular admin should not see a Delete House Type button");
  pass("Regular Admin: no Delete button on House Types page");

  // ── 2. Super Admin: Delete buttons present ──────────────────────────────
  await setCookies(superCookie);
  await send("Page.navigate", { url: `${baseUrl}/admin/room-types` });
  await waitFor(`document.body && /Room Types/.test(document.body.innerText) && document.querySelectorAll('h3').length >= 2`, "room types render (super)", 60000);
  const superRoomDelete = await evaluate(`document.querySelectorAll('button[title="Delete Room Type"]').length`);
  assert.equal(superRoomDelete, 2, "super admin should see a Delete button on every room type card");
  pass("Super Admin: Delete button visible on every Room Type card");
  await shot("01-room-types-super-admin");

  await send("Page.navigate", { url: `${baseUrl}/admin/house-types` });
  await waitFor(`document.body && /House Types/.test(document.body.innerText) && document.querySelectorAll('h3').length >= 2`, "house types render (super)", 60000);
  const superHouseDelete = await evaluate(`document.querySelectorAll('button[title="Delete House Type"]').length`);
  assert.equal(superHouseDelete, 2, "super admin should see a Delete button on every house type card");
  pass("Super Admin: Delete button visible on every House Type card");
  await shot("02-house-types-super-admin");

  // ── 3. Blocked delete: "Used House Type" has a room template → must fail, record stays ──
  await evaluate(`[...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Used House Type').closest('.rounded-2xl.border').querySelector('button[title="Delete House Type"]').click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete House Type')`, "confirm dialog (house type)");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete House Type').click()`);
  await waitFor(`/Cannot delete house type/i.test(document.body.innerText)`, "blocked-delete toast (house type)");
  const usedHouseTypeStillThere = await evaluate(`[...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'Used House Type')`);
  assert.ok(usedHouseTypeStillThere, "House type with a room template must NOT be deleted");
  pass('Blocked: "Used House Type" (has a room template) cannot be deleted; a clear error is shown and the record remains');
  await shot("03-house-type-delete-blocked");

  // ── 4. Successful delete: "Unused House Type" has no dependencies ──────
  await evaluate(`[...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Unused House Type').closest('.rounded-2xl.border').querySelector('button[title="Delete House Type"]').click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete House Type')`, "confirm dialog (unused house type)");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete House Type').click()`);
  await waitFor(`![...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'Unused House Type')`, "unused house type removed from grid");
  pass('Success: "Unused House Type" (no dependencies) is deleted and disappears from the grid');
  await shot("04-house-type-deleted");

  // ── 5. Room Types: same blocked vs. success behavior ────────────────────
  await send("Page.navigate", { url: `${baseUrl}/admin/room-types` });
  await waitFor(`document.body && document.querySelectorAll('h3').length >= 2`, "room types reload");

  await evaluate(`(() => { const card = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Used Room').closest('div.group'); card.querySelector('button[title="Delete Room Type"]').click(); })()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete Room Type')`, "confirm dialog (used room)");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete Room Type').click()`);
  await waitFor(`/Cannot delete room type/i.test(document.body.innerText)`, "blocked-delete toast (room type)");
  const usedRoomStillThere = await evaluate(`[...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'Used Room')`);
  assert.ok(usedRoomStillThere, "Room type used in a house-type template must NOT be deleted");
  pass('Blocked: "Used Room" (referenced by a house-type template) cannot be deleted; record remains');

  await evaluate(`(() => { const card = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Unused Room').closest('div.group'); card.querySelector('button[title="Delete Room Type"]').click(); })()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete Room Type')`, "confirm dialog (unused room)");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete Room Type').click()`);
  await waitFor(`![...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'Unused Room')`, "unused room removed from grid");
  pass('Success: "Unused Room" (no dependencies) is deleted and disappears from the grid');
  await shot("05-room-types-after-deletes");

  // ── 6. API-level guard: a regular Admin's own session cannot DELETE even via a direct fetch ──
  await setCookies(adminCookie);
  await send("Page.navigate", { url: `${baseUrl}/admin/room-types` });
  await waitFor(`document.body && document.querySelectorAll('h3').length >= 1`, "room types render (admin, pre-API-check)");
  const adminDirectStatus = await evaluate(`fetch(${JSON.stringify(`${baseUrl}/api/room-types/2`)}, { method: 'DELETE' }).then(r => r.status)`);
  assert.equal(adminDirectStatus, 403, "a regular Admin's DELETE call must be rejected with 403, even bypassing the UI");
  const usedRoomSurvivedApiAttempt = await evaluate(`fetch(${JSON.stringify(`${baseUrl}/api/room-types`)}).then(r => r.json()).then(d => (d.data ?? d).some(r => r.name === 'Used Room'))`);
  assert.ok(usedRoomSurvivedApiAttempt, "the record must still exist after the rejected admin-role DELETE attempt");
  pass("API-level guard: a regular Admin's direct DELETE call to /api/room-types/[id] is rejected with 403 (super_admin only)");

  // ── 7. Console health ────────────────────────────────────────────────────
  const relevantErrors = consoleErrors.filter(Boolean);
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  pass("no console errors during any delete flow");

  console.log(`\nCatalog delete browser verification PASSED (${results.length} checks).`);
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
