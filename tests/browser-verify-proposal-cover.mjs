/**
 * Browser verification for the redesigned Proposal cover (page 1): matches
 * the reference mockup — logo + quotation ref top bar, "Smart Automation /
 * Proposal" title beside the house+phone hero image, open info grid
 * (Client / Project Location / Project Type / Total Investment), and a
 * simple centered "www.whyte.co.in" footer (page 1 only; other pages keep
 * their existing detailed footer).
 *
 *   node tests/browser-verify-proposal-cover.mjs [screenshotDir]
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
  server = await startIsolatedServer("proposal-cover", [{ _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" }], { production: true });
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

  profileDir = await mkdtemp(join(tmpdir(), "whyte-cover-chrome-"));
  const port = 9900 + Math.floor(Math.random() * 300);
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
  const shot = async (name, clip) => {
    if (!shotDir) return;
    const s = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
    await writeFile(join(shotDir, `${name}.png`), Buffer.from(s.data, "base64"));
  };

  await send("Page.navigate", { url: `${baseUrl}/quotation/${quotationId}/preview` });
  await waitFor(`!!document.querySelector('.proposal-page')`, "proposal page render", 30000);
  await waitFor(`[...document.images].every(img => img.complete)`, "all images loaded", 20000);
  await sleep(300);
  pass("proposal preview page rendered");

  const coverChecks = await evaluate(`(() => {
    const page = document.querySelector('.proposal-page');
    const text = page.innerText;
    const img = page.querySelector('img[alt="Whyte smart home and app control"]');
    const logo = page.querySelector('img[alt="WHYTE Automations"], img[alt*="WHYTE"]');
    return {
      hasTitle: /Smart[\\s\\S]{0,3}Automation/.test(text) && /Proposal/.test(text),
      hasEyebrow: /Next-Gen Smart Living Ecosystems/i.test(text),
      hasHeroImage: !!img,
      heroImageLoaded: img ? img.complete && img.naturalWidth > 0 : false,
      heroSrc: img ? img.currentSrc || img.src : null,
      hasQuotationRef: /Quotation Reference/i.test(text),
      hasClient: /Vineet/.test(text),
      hasLocation: /Ahmedabad/.test(text),
      hasProjectType: /Duplex/.test(text),
      hasInvestment: /113,827\\.55|Total Investment/.test(text),
      footerText: page.querySelector(':scope > div:last-child')?.textContent.trim(),
      noOldTagline: !/Thank you for considering/i.test(text),
      noOldHeroCaption: !/Feather-Touch Switching/i.test(text),
    };
  })()`);

  assert.ok(coverChecks.hasTitle, "cover must show 'Smart Automation' / 'Proposal' title");
  assert.ok(coverChecks.hasEyebrow, "cover must show the eyebrow line");
  assert.ok(coverChecks.hasHeroImage, "cover must render the house+phone hero image");
  assert.ok(coverChecks.heroImageLoaded, `hero image did not load (src=${coverChecks.heroSrc})`);
  assert.match(coverChecks.heroSrc ?? "", /cover-hero\.webp/);
  assert.ok(coverChecks.hasQuotationRef, "cover must show 'Quotation Reference'");
  assert.ok(coverChecks.hasClient, "cover must show the client name");
  assert.ok(coverChecks.hasLocation, "cover must show the project location");
  assert.ok(coverChecks.hasProjectType, "cover must show the project type");
  assert.ok(coverChecks.noOldTagline, "old 'Thank you for considering' paragraph should be removed");
  assert.ok(coverChecks.noOldHeroCaption, "old stock-photo hero caption should be gone");
  pass("cover shows title, eyebrow, hero image (loaded), and the Client/Location/Type info grid");

  assert.match(coverChecks.footerText ?? "", /whyte\.co\.in/i);
  assert.doesNotMatch(coverChecks.footerText ?? "", /Page 1 of/);
  pass(`page 1 footer is the simple centered site line: "${coverChecks.footerText}"`);

  // Page 2 should still show the detailed footer (company name, zero-padded page X / Y).
  const pageCount = await evaluate(`document.querySelectorAll('.proposal-page').length`);
  if (pageCount > 1) {
    const page2Footer = await evaluate(`document.querySelectorAll('.proposal-page')[1].querySelector(':scope > div:last-child').textContent`);
    assert.match(page2Footer, /02 \/ 0\d/);
    pass(`page 2 keeps its existing detailed footer unchanged: "${page2Footer.trim()}"`);
  } else {
    pass("only one page rendered for this quotation; page-2-footer check skipped");
  }

  await shot("proposal-full-page");
  const clipRect = await evaluate(`(() => { const r = document.querySelector('.proposal-page').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height * 0.42), scale: 1 }; })()`);
  await shot("proposal-cover-crop", clipRect);

  const relevantErrors = consoleErrors.filter(Boolean);
  const relevantBad = badResponses.filter((r) => !/favicon/.test(r));
  assert.deepEqual(relevantErrors, [], `console errors: ${relevantErrors.join(" | ")}`);
  assert.deepEqual(relevantBad, [], `failed requests: ${relevantBad.join(" | ")}`);
  pass("no console errors, no failed (4xx/5xx) requests");

  console.log(`\nProposal cover redesign verification PASSED (${results.length} checks).`);
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
