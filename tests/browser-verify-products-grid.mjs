/**
 * Browser verification for the Admin Products grid UI audit/fix:
 *   - The "More" row-actions menu is never clipped by the card's
 *     overflow-hidden, on the first row, the last row, or after scrolling.
 *   - Row layout stays aligned for long names, missing images, many
 *     variants, single variants, active/inactive products.
 *   - Filter toolbar and grid are responsive with no horizontal overflow
 *     at desktop/tablet/mobile widths.
 *   - Empty-filter-results state renders.
 *   - Menu closes on outside click, Escape, and action selection, and
 *     does not trigger row navigation.
 *
 *   node tests/browser-verify-products-grid.mjs [screenshotDir]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

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
  server = await startIsolatedServer("products-grid", [{ _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
  const { db, login, baseUrl } = server;

  await db.collection("categories").insertMany([
    { _id: 1, name: "Tactus", parentId: null, isActive: true, sortOrder: 0 },
    { _id: 2, name: "Accessories", parentId: null, isActive: true, sortOrder: 1 },
  ]);

  const now = new Date();
  const products = [
    { _id: 1, name: "Zigbee Gateway ( Ethernet Based )", code: "ZB-GW01", description: null, type: "accessory", categoryId: 2, automationTier: null, surfaceFinish: null, unit: "pcs", imageUrl: null, moduleSize: null, notes: null, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null },
    { _id: 2, name: "Touch Door Bell (Only Touch)", code: "Bell-2M", description: null, type: "switch_board", categoryId: 1, automationTier: "wifi", surfaceFinish: "matte", unit: "pcs", imageUrl: null, moduleSize: "2M", notes: null, isActive: true, sortOrder: 1, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null },
    {
      _id: 3,
      name: "Extremely Long Product Name That Should Truncate Gracefully Without Pushing The View Edit Variants And More Action Buttons Out Of The Row Or Off The Screen Edge",
      code: "LONG-NAME-TEST-SKU-0001234", description: null, type: "switch_board", categoryId: 1, automationTier: "zigbee", surfaceFinish: "glossy", unit: "pcs", imageUrl: null, moduleSize: "8M", notes: null, isActive: true, sortOrder: 2, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null,
    },
    { _id: 4, name: "Inactive Legacy Switch", code: "LEGACY-01", description: null, type: "switch_board", categoryId: 1, automationTier: "remote", surfaceFinish: "matte", unit: "pcs", imageUrl: null, moduleSize: "4M", notes: null, isActive: false, sortOrder: 3, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null },
    { _id: 5, name: "Many Variants Switch", code: "MANYVAR-01", description: null, type: "switch_board", categoryId: 1, automationTier: "wifi", surfaceFinish: "matte", unit: "pcs", imageUrl: null, moduleSize: "6M", notes: null, isActive: true, sortOrder: 4, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null },
  ];
  // Pad the list so the grid scrolls and we can test a menu on the LAST row too.
  for (let i = 6; i <= 14; i++) {
    products.push({ _id: i, name: `Filler Product ${i}`, code: `FILLER-${i}`, description: null, type: "switch_board", categoryId: 1, automationTier: "wifi", surfaceFinish: "matte", unit: "pcs", imageUrl: null, moduleSize: "4M", notes: null, isActive: true, sortOrder: i, createdAt: now, updatedAt: now, isMatrix: false, matrixDimensions: null });
  }
  await db.collection("products").insertMany(products);

  const variants = [];
  let variantId = 1;
  for (let v = 0; v < 6; v++) {
    variants.push({ _id: variantId++, productId: 2, variantCode: `BELL-2M-V${v}`, name: `Variant ${v + 1}`, automationTier: "wifi", surfaceFinish: "matte", config: {}, price: Decimal128.fromString("2599.00"), isActive: true, sortOrder: v, createdAt: now, updatedAt: now });
  }
  for (let v = 0; v < 12; v++) {
    variants.push({ _id: variantId++, productId: 5, variantCode: `MANYVAR-01-V${v}`, name: `Variant ${v + 1}`, automationTier: "wifi", surfaceFinish: "matte", config: {}, price: Decimal128.fromString("4999.00"), isActive: true, sortOrder: v, createdAt: now, updatedAt: now });
  }
  variants.push({ _id: variantId++, productId: 1, variantCode: "ZB-GW01-V0", name: null, automationTier: null, surfaceFinish: null, config: {}, price: Decimal128.fromString("7498.99"), isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertMany(variants);

  const cookie = await login("super_admin@example.com", "admin");

  // ── Browser ────────────────────────────────────────────────────────────
  profileDir = await mkdtemp(join(tmpdir(), "whyte-prodgrid-chrome-"));
  const port = 9300 + Math.floor(Math.random() * 400);
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
    window.__rows = () => [...document.querySelectorAll('article')];
    window.__rowByName = (name) => __rows().find(a => a.textContent.includes(name));
    window.__moreBtn = (row) => row.querySelector('button[aria-haspopup="menu"]');
    true;`;
  const open = async (query = "pageSize=20") => {
    await send("Page.navigate", { url: `${baseUrl}/admin/products?${query}` });
    await waitFor(`document.body && document.querySelectorAll('article').length >= 10`, "products render", 60000);
    await evaluate(HELPERS);
  };

  await setViewport(1440, 1000);
  await open();
  pass(`seeded catalog loaded: ${await evaluate("__rows().length")} product rows rendered`);

  // 1. Missing-image products render the Package placeholder, not a broken <img>.
  const placeholderCheck = await evaluate(`(() => { const row = __rowByName('Zigbee Gateway'); return { hasImg: !!row.querySelector('img'), hasPlaceholder: !!row.querySelector('svg') }; })()`);
  assert.equal(placeholderCheck.hasImg, false, "no imageUrl should mean no <img>, not a broken one");
  pass("product with no imageUrl renders the placeholder icon, not a broken image");

  // 2. Long name + long code does not push actions out of the row or overflow it horizontally.
  const longNameRow = await evaluate(`(() => {
    const row = __rowByName('Extremely Long Product Name');
    const rowRect = row.getBoundingClientRect();
    const actions = row.querySelectorAll('button[title^="View details"], button[title^="Edit "], button[title^="Edit variants"]');
    const allWithin = [...actions].every(b => { const r = b.getBoundingClientRect(); return r.right <= rowRect.right + 1 && r.left >= rowRect.left - 1; });
    return { rowWidth: rowRect.width, allWithin, overflowsPage: document.documentElement.scrollWidth > window.innerWidth + 1 };
  })()`);
  assert.ok(longNameRow.allWithin, "action buttons must stay within the row bounds even with a very long product name");
  assert.equal(longNameRow.overflowsPage, false, "a long product name must not cause horizontal page overflow");
  pass("very long product name + SKU: action buttons stay aligned inside the row, no page overflow");

  // 3. Many-variant and single-variant products both show a correct, non-overlapping variant badge.
  const variantBadges = await evaluate(`({
    many: __rowByName('Many Variants Switch').textContent.includes('12 Variants'),
    single: __rowByName('Zigbee Gateway').textContent.includes('1 Variant'),
  })`);
  assert.ok(variantBadges.many, "12-variant product shows '12 Variants'");
  assert.ok(variantBadges.single, "1-variant product shows '1 Variant' (singular)");
  pass("variant count badge correct for both a 12-variant and a 1-variant product");

  // 4. Active vs inactive status badges render distinctly.
  const statusBadges = await evaluate(`({
    inactiveText: __rowByName('Inactive Legacy Switch').textContent.includes('Inactive'),
    activeText: __rowByName('Zigbee Gateway').textContent.includes('Active'),
  })`);
  assert.ok(statusBadges.inactiveText && statusBadges.activeText, "active/inactive badges render correctly");
  pass("Active/Inactive status badges render correctly per product");

  // ── 5. THE CORE BUG: More menu on the FIRST row is not clipped ──────────
  const firstRow = await evaluate(`__rows()[0].getBoundingClientRect().top`);
  await evaluate(`__moreBtn(__rows()[0]).click()`);
  await waitFor(`!!document.querySelector('[role="menu"]')`, "first-row menu open");
  const firstMenu = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"]');
    const row = __rows()[0];
    const menuRect = menu.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const viewItem = [...menu.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('View Product'));
    const viewRect = viewItem.getBoundingClientRect();
    return {
      menuBottom: menuRect.bottom,
      rowBottom: rowRect.bottom,
      viewItemFullyVisible: viewRect.width > 50 && viewRect.height > 10,
      viewItemText: viewItem.textContent.trim(),
      inViewport: menuRect.left >= 0 && menuRect.right <= window.innerWidth,
    };
  })()`);
  assert.ok(firstMenu.viewItemFullyVisible, "the 'View Product' menu item must render at full size, not clipped");
  assert.equal(firstMenu.viewItemText, "View Product", "menu item text must not be cut off mid-word");
  assert.ok(firstMenu.inViewport, "menu must stay within the horizontal viewport");
  pass(`FIXED: first-row 'More' menu renders uncut (was clipped by the card's overflow-hidden) — "${firstMenu.viewItemText}" fully visible`);
  await shot("01-first-row-menu-open");

  // Clicking a menu item must not navigate the row (View Product just calls onView -> router.push,
  // but clicking elsewhere in the menu, e.g. a future no-op area, must never trigger navigation).
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await waitFor(`!document.querySelector('[role="menu"]')`, "menu closes on Escape");
  pass("Escape closes the menu");

  // 6. Outside click closes the menu (the app listens on pointerdown, so dispatch that — a
  // synthetic .click() only fires 'click', which real mouse input always precedes with 'pointerdown').
  await evaluate(`__moreBtn(__rows()[0]).click()`);
  await waitFor(`!!document.querySelector('[role="menu"]')`, "menu reopened");
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await waitFor(`!document.querySelector('[role="menu"]')`, "menu closes on outside click");
  pass("outside click closes the menu");

  // ── 7. More menu on the LAST visible row (near the bottom) is not clipped either ──
  const lastRowIndex = await evaluate(`__rows().length - 1`);
  await evaluate(`__rows()[__rows().length - 1].scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await evaluate(`__moreBtn(__rows()[__rows().length - 1]).click()`);
  await waitFor(`!!document.querySelector('[role="menu"]')`, "last-row menu open");
  const lastMenu = await evaluate(`(() => {
    const menu = document.querySelector('[role="menu"]');
    const rect = menu.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    return { fullyInViewport: rect.top >= 0 && rect.bottom <= window.innerHeight, itemCount: items.length, allVisible: items.every(i => i.getBoundingClientRect().height > 10) };
  })()`);
  assert.ok(lastMenu.fullyInViewport, "last-row menu must flip upward and stay fully within the viewport");
  assert.equal(lastMenu.itemCount, 4, "menu shows all 4 actions");
  assert.ok(lastMenu.allVisible, "every menu item is fully visible (none clipped)");
  pass(`last row (#${lastRowIndex + 1}): menu flips upward correctly and is fully visible, not clipped`);
  await shot("02-last-row-menu-open-flipped");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

  // 8. Menu item selection runs its action and closes the menu (Edit Variants opens the modal).
  await evaluate(`__moreBtn(__rows()[0]).click()`);
  await waitFor(`!!document.querySelector('[role="menu"]')`, "menu open for action test");
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('Edit Variants')).click()`);
  await waitFor(`!document.querySelector('[role="menu"]')`, "menu closes after selecting an action");
  await waitFor(`/Edit Variants/i.test(document.body.innerText)`, "Edit Variants modal opened");
  pass("selecting 'Edit Variants' from the menu closes the menu and opens the correct modal (no row navigation)");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);

  // 9. Empty filter results state.
  await send("Page.navigate", { url: `${baseUrl}/admin/products?search=zzzznonexistentzzzz` });
  await waitFor(`/No products match these filters/i.test(document.body.innerText)`, "empty state render");
  pass("empty search/filter results show the 'No products match these filters' state with a Clear filters action");
  await shot("03-empty-filter-results");

  // ── 10. Responsive: no horizontal overflow at desktop/tablet/mobile ────
  await open();
  for (const [label, w, h, mobile] of [["desktop", 1440, 1000, false], ["tablet", 820, 1300, true], ["mobile", 390, 1400, true]]) {
    await setViewport(w, h, mobile);
    await open();
    await sleep(400);
    const overflow = await evaluate(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, rowsWithin: __rows().every(r => r.getBoundingClientRect().right <= window.innerWidth + 1) })`);
    assert.ok(overflow.sw <= overflow.iw + 1, `${label}: horizontal page overflow ${overflow.sw} > ${overflow.iw}`);
    assert.ok(overflow.rowsWithin, `${label}: a product row overflows the viewport`);
    if (w <= 420) {
      const diag = await evaluate(`(() => {
        const row = __rows()[0];
        const actionsBtn = row.querySelector('button[title^="View details"]');
        const actionsContainer = actionsBtn?.closest('div');
        const rightRail = actionsContainer?.parentElement;
        const rect = (el) => el ? { left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width) } : null;
        return { viewportWidth: window.innerWidth, actionsContainer: rect(actionsContainer), rightRail: rect(rightRail), row: rect(row) };
      })()`);
      console.log("MOBILE DIAG:", JSON.stringify(diag, null, 2));
      assert.ok(diag.actionsContainer.right <= diag.viewportWidth + 1, `${label}: actions clipped — right edge ${diag.actionsContainer.right} > viewport ${diag.viewportWidth}`);
    }
    await shot(`04-${label}-grid`);
    pass(`${label} ${w}px: no horizontal page scroll, product rows fit the viewport`);
  }

  // Toolbar must not overflow at mobile either.
  const toolbarOverflow = await evaluate(`(() => { const section = document.querySelector('section'); return section ? section.getBoundingClientRect().right <= window.innerWidth + 1 : true; })()`);
  assert.ok(toolbarOverflow, "filter toolbar must not overflow the viewport at mobile width");
  pass("filter toolbar fits within the mobile viewport (wraps rather than overflowing)");

  await setViewport(1440, 1000);

  // 11. Console / network health across the whole flow.
  const relevantErrors = consoleErrors.filter(Boolean);
  const relevantBad = badResponses.filter((r) => !/favicon/.test(r));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  assert.deepEqual(relevantBad, [], `failed requests: ${relevantBad.join(" | ")}`);
  pass("no console errors, no failed (4xx/5xx) requests across the whole verification");

  console.log(`\nProducts grid browser verification PASSED (${results.length} checks).`);
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
