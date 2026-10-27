/**
 * Browser check (real Chromium via Playwright, production build, throwaway local Mongo) of the Proposal Product
 * Summary: flat product rows with large images, one room container, rooms flowing consecutively across the fixed
 * A4 pages (the PDF is captured from these pages), no overflow, no large blank areas, missing images, long names,
 * unchanged prices / quantities, and a phone viewport.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/proposal-product-summary.browser.mjs
 * Optional: SCREENSHOT_DIR=<dir>   SOFT_LAYOUT=1 (report layout problems instead of failing)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;
const soft = Boolean(process.env.SOFT_LAYOUT);

const svg = (w, h, label) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#e8d5dc"/><text x="50%" y="50%" font-size="${Math.round(h / 5)}" text-anchor="middle" dominant-baseline="middle" fill="#7a3550">${label}</text></svg>`)}`;
const LONG_NAME = "Premium Glass Touch Smart Switchboard Controller With Integrated Scene Memory And Energy Metering Module";

try {
  server = await startIsolatedServer(
    "proposal-summary",
    [{ _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 }],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Company 1", slug: "company-1", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  const roomNames = ["Living Room", "Master Bedroom", "Kitchen", "Dining Room"];
  await db.collection("roomtypes").insertMany(roomNames.map((name, i) => ({ _id: i + 1, companyId: 1, name, isActive: true, sortOrder: i + 1 })));
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany(roomNames.map((_, i) => ({ _id: i + 1, companyId: 1, houseTypeId: 1, roomTypeId: i + 1, defaultCount: 1, sortOrder: i + 1 })));
  const product = (id, name, imageUrl) => ({ _id: id, companyId: 1, name, code: `P-${id}`, type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, imageUrl, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([
    product(1, "Wide Panel Switch", svg(400, 120, "WIDE")),
    product(2, "Tall Touch Panel", svg(120, 400, "TALL")),
    product(3, "Plain Switch With No Photo", null),
    product(4, LONG_NAME, svg(300, 300, "SQUARE")),
    product(5, "Fan Regulator", svg(300, 300, "FAN")),
    product(6, "Curtain Motor Controller", svg(300, 300, "CURTAIN")),
  ]);
  const variant = (id, productId, price, config) => ({ _id: id, companyId: 1, productId, variantCode: `V-${id}`, config, price: Decimal128.fromString(price), priceWithoutTax: Decimal128.fromString(price), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: id });
  const PRICES = { 1: 1250, 2: 2400, 3: 800, 4: 3100, 5: 650, 6: 5200 };
  await db.collection("productvariants").insertMany([
    variant(1, 1, "1250.00", { moduleSize: "8M", finish: "acrylic", connectivity: "WiFi" }),
    variant(2, 2, "2400.00", { moduleSize: "6M" }),
    variant(3, 3, "800.00", {}),
    variant(4, 4, "3100.00", { moduleSize: "12M", finish: "glass", connectivity: "Remote" }),
    variant(5, 5, "650.00", {}),
    variant(6, 6, "5200.00", {}),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer_a@example.com", "user");
  const created = await api(dealer, "POST", "/api/quotations", { clientName: "Summary Client", houseTypeId: 1 });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const rooms = (await api(dealer, "GET", `/api/quotations/${qid}`)).data.rooms;
  const roomOf = (roomTypeId) => rooms.find((r) => r.roomTypeId === roomTypeId);
  const add = async (room, productId, quantity, extra = {}) => {
    const res = await api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId, productVariantId: productId, quantity, ...extra });
    assert.equal(res.status, 201, `add item ${productId}: ${res.text.slice(0, 120)}`);
  };
  // Living Room: 1 product. Master Bedroom: 2. Kitchen: 4. Dining Room: 10 (spills across a page).
  await add(roomOf(1), 1, 2, { sbNumber: "SB01", notes: "Sofa Left" });
  await add(roomOf(2), 2, 1, { sbNumber: "SB02", notes: "TV Unit" });
  await add(roomOf(2), 3, 4);
  await add(roomOf(3), 4, 1, { sbNumber: "SB03", notes: "Entrance foyer wall next to the main door, above the shoe cabinet and the umbrella stand" });
  await add(roomOf(3), 5, 3);
  await add(roomOf(3), 6, 1);
  await add(roomOf(3), 1, 1, { sbNumber: "SB04", notes: "Bed Side" });
  // Distinct SB numbers keep these ten entries ten rows: entries of the same product with identical specifications
  // would otherwise be grouped into one row by the proposal (covered by tests/independent-quotation-items.browser.mjs).
  for (let i = 0; i < 10; i++) await add(roomOf(4), [1, 2, 3, 4, 5, 6][i % 6], 1 + (i % 3), { sbNumber: `SBD${String(i + 1).padStart(2, "0")}` });

  const storedBefore = JSON.stringify((await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray()).map((i) => [i._id, i.quantity, i.unitPrice.toString(), i.productId]));
  const apiBefore = (await api(dealer, "GET", `/api/quotations/${qid}`)).data;

  browser = await chromium.launch({ headless: true });
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(dealer.split("; ").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${baseUrl}/quotation/${qid}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(1500);
    return { context, page };
  };
  const problems = [];
  const check = (condition, message) => { if (!condition) { if (soft) problems.push(message); else assert.fail(message); } };

  const { context, page } = await open({ width: 1280, height: 1000 });
  // Geometry of every page, measured in the page's own (unscaled) coordinates.
  const layout = await page.evaluate(() => [...document.querySelectorAll(".proposal-page")].map((el, index) => {
    const pageBox = el.getBoundingClientRect();
    const scale = pageBox.width / el.offsetWidth;
    const content = [...el.children].find((c) => c.classList.contains("z-10") && c.classList.contains("relative"));
    const footer = el.lastElementChild;
    const sections = [...(content?.children ?? [])].filter((c) => /Subtotal|continued/i.test(c.innerText || ""));
    return {
      index: index + 1,
      height: el.offsetHeight,
      contentBottom: content ? Math.round((content.getBoundingClientRect().bottom - pageBox.top) / scale) : null,
      footerTop: footer ? Math.round((footer.getBoundingClientRect().top - pageBox.top) / scale) : null,
      isProductPage: sections.length > 0,
      roomSections: sections.length,
    };
  }));
  console.log("pages:", JSON.stringify(layout));
  for (const l of layout) check(l.height <= 1124, `page ${l.index} overflows its A4 canvas: ${l.height}px`);
  pass(`${layout.length} pages; none overflows the 1123px A4 canvas`);

  const productPages = layout.filter((l) => l.isProductPage);
  assert.ok(productPages.length >= 2, "the product summary spans several pages");
  for (const l of productPages.slice(0, -1)) {
    if (l.contentBottom != null && l.footerTop != null) {
      const free = l.footerTop - l.contentBottom;
      check(free < 330, `page ${l.index} leaves ${free}px blank above the footer`);
    }
  }
  check(productPages.some((l) => l.roomSections >= 2), "at least one page holds two or more rooms (rooms flow consecutively)");
  pass("rooms flow consecutively: a page holds several rooms and no product page ends with a large blank band");

  const body = await page.locator("body").innerText();
  for (const name of ["Wide Panel Switch", "Tall Touch Panel", "Plain Switch With No Photo", "Fan Regulator", "Curtain Motor Controller"]) {
    assert.match(body, new RegExp(name), `${name} is rendered`);
  }
  assert.match(body, /Premium Glass Touch Smart Switchboard Controller/, "the very long name is rendered in full");
  for (const sb of ["SB01", "SB02", "SB03", "SB04"]) assert.match(body, new RegExp(sb), `${sb} shown where the data has it`);
  assert.doesNotMatch(body, /SB05|SB00/, "no switchboard identifier is invented");
  assert.match(body, /Sofa Left/);
  assert.match(body, /TV Unit/);
  assert.match(body, /Entrance foyer wall next to the main door/, "a long location wraps instead of being cut");
  assert.match(body, /8M/);
  assert.match(body, /6M/);
  assert.match(body, /WiFi/i);
  assert.match(body, /No image/i, "a product without a photo shows a subtle placeholder");
  assert.equal(await page.locator('img[alt="Plain Switch With No Photo"]').count(), 0, "no broken image for the missing photo");
  for (const room of roomNames) assert.match(body, new RegExp(room, "i"), `${room} is rendered`);
  const rows = await page.evaluate(() => document.querySelectorAll(".proposal-page .divide-y > div").length);
  assert.equal(rows, 1 + 2 + 4 + 10, `every product row is rendered once (${rows})`);
  pass("every product of every room (1 / 2 / 4 / 10 products) is rendered once, with SB id only where it exists, configuration, location, long name and placeholder");

  const images = await page.evaluate(() => [...document.querySelectorAll(".proposal-page img")].filter((img) => ["Wide Panel Switch", "Tall Touch Panel"].includes(img.alt)).map((img) => {
    const box = img.parentElement.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img.parentElement);
    return { alt: img.alt, fit: getComputedStyle(img).objectFit, boxW: Math.round(box.width), boxH: Math.round(box.height), natural: [img.naturalWidth, img.naturalHeight], w: r.width, h: r.height, bg: cs.backgroundColor, border: cs.borderTopWidth };
  }));
  assert.ok(images.length >= 2);
  for (const c of images) {
    assert.equal(c.fit, "contain", `${c.alt} uses object-fit: contain`);
    assert.ok(c.boxW >= 100 && c.boxH >= 100, `${c.alt}: the image area is large (${c.boxW}x${c.boxH})`);
    assert.ok(Math.abs(c.w / c.h - c.natural[0] / c.natural[1]) < 0.06, `${c.alt} keeps its proportions`);
    assert.ok(c.w <= c.boxW + 1 && c.h <= c.boxH + 1, `${c.alt} is not cropped`);
    assert.equal(c.border, "0px", `${c.alt} has no frame`);
    assert.match(c.bg, /rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/, `${c.alt} sits on a clean background (${c.bg})`);
  }
  pass("product images are large (112px area), object-fit: contain, undistorted, uncropped and frame-less on a clean background");

  const sub = (await api(dealer, "GET", `/api/quotations/${qid}`)).data;
  assert.deepEqual(sub.subtotal, apiBefore.subtotal);
  assert.equal(JSON.stringify((await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray()).map((i) => [i._id, i.quantity, i.unitPrice.toString(), i.productId])), storedBefore, "no price or quantity changed");
  const flat = body.replace(/,/g, "");
  const kitchen = 1 * 3100 + 3 * 650 + 1 * 5200 + 1 * 1250;
  assert.match(flat, new RegExp(`Kitchen Subtotal[\\s\\S]{0,30}${kitchen}`, "i"), "the Kitchen subtotal is still qty x unit price");
  const dining = [...Array(10).keys()].reduce((sum, i) => sum + PRICES[[1, 2, 3, 4, 5, 6][i % 6]] * (1 + (i % 3)), 0);
  assert.match(flat, new RegExp(`Dining Room Subtotal[\\s\\S]{0,30}${dining}`, "i"), "the Dining Room subtotal is still qty x unit price");
  pass("prices, quantities and the room subtotals are unchanged and displayed exactly as before");

  assert.doesNotMatch(body, /Ground Floor|First Floor/, "the flat still shows no floor labels");
  pass("flat configuration keeps floor labels hidden in the room headers");

  if (shotDir) {
    const nth = page.locator(".proposal-page");
    const count = await nth.count();
    for (let i = 3; i < count; i++) await nth.nth(i).screenshot({ path: `${shotDir}/p-page-${i + 1}.png` });
  }
  // Company panel and footers on the final page.
  const closing = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".proposal-page")];
    const last = pages[pages.length - 1];
    const scale = last.getBoundingClientRect().width / last.offsetWidth;
    const lastTop = last.getBoundingClientRect().top;
    const rel = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round((b.top - lastTop) / scale), bottom: Math.round((b.bottom - lastTop) / scale), left: Math.round(b.left / scale), right: Math.round(b.right / scale) }; };
    const panel = last.querySelector('[data-testid="company-panel"]');
    const social = panel ? [...panel.querySelectorAll("a")].filter((a) => /linkedin|instagram|youtube|facebook/.test(a.href)) : [];
    const footers = [...document.querySelectorAll('[data-testid="page-footer"]')];
    return {
      panelCount: document.querySelectorAll('[data-testid="company-panel"]').length,
      panel: panel ? rel(panel) : null,
      panelText: panel ? panel.innerText : "",
      social: social.map((a) => ({ name: a.innerText.trim(), href: a.href, ...rel(a) })),
      totalSocialAnchors: [...document.querySelectorAll(".proposal-page a")].filter((a) => /linkedin|instagram|youtube|facebook/.test(a.href)).length,
      footerCount: footers.length,
      footerPageCount: pages.length,
      footerSocial: footers.reduce((n, f) => n + f.querySelectorAll("svg, a[href*=linkedin], a[href*=instagram], a[href*=youtube], a[href*=facebook]").length, 0),
      footerTexts: footers.map((f) => f.innerText.replace(/\s+/g, " ").trim()),
      lastFooter: footers.length ? rel(footers[footers.length - 1]) : null,
      lastHeight: last.offsetHeight,
      sectionChildren: panel ? [...panel.parentElement.children].map((c) => [c.className.slice(0, 40), c.offsetHeight]) : [],
    };
  });
  if (soft) console.log("closing children:", JSON.stringify(closing.sectionChildren), "page", closing.lastHeight);
  assert.equal(closing.panelCount, 1, "exactly one company information panel");
  for (const text of ["Whyte Automations Private Limited", "Gandhinagar, Gujarat, India", "Next-Gen Smart Living", "+91 98982 34336 / +91 98989 26336", "sales@whyte.co.in", "https://whyte.co.in/"]) {
    assert.ok(closing.panelText.includes(text), `the panel keeps "${text}" unchanged`);
  }
  assert.deepEqual(closing.social.map((x) => x.name), ["LinkedIn", "Instagram", "YouTube", "Facebook"]);
  assert.equal(new Set(closing.social.map((x) => x.top)).size, 1, `all four social links share one row (tops ${closing.social.map((x) => x.top)})`);
  assert.ok(closing.social.every((x) => x.left >= closing.panel.left && x.right <= closing.panel.right), "social links stay inside the panel");
  assert.ok(closing.social.every((x) => x.href.startsWith("https://")), "social links are real https links");
  pass("company panel: logo/name/address on the left, phone/email/website on the right (text unchanged); LinkedIn, Instagram, YouTube, Facebook sit in one unwrapped row");
  assert.equal(closing.totalSocialAnchors, 4, "social links appear once, not again in the footer");
  assert.equal(closing.footerSocial, 0, "the global footer carries no social icons");
  assert.equal(closing.footerCount, closing.footerPageCount, "every proposal page keeps its footer");
  closing.footerTexts.forEach((t, i) => assert.match(t, new RegExp(`www\\.whyte\\.co\\.in\\s+Page ${i + 1} of ${closing.footerPageCount}`), `footer ${i + 1}: ${t}`));
  pass("the global footer is minimal on every page (website + 'Page N of M'); social links are not duplicated");
  assert.ok(closing.lastFooter.top - closing.panel.bottom >= 10, `the panel clears the footer (gap ${closing.lastFooter.top - closing.panel.bottom}px)`);
  assert.ok(closing.lastHeight <= 1124, `the final page fits A4 (${closing.lastHeight}px)`);
  pass("the panel sits wholly on the final page above the footer, and the page fits A4 with no extra page");

  // Real PDF: click Download PDF, check page count / A4 size and pull each page image out of the file.
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Download PDF/i }).click()]);
  const pdfPath = shotDir ? `${shotDir}/proposal.pdf` : await download.path();
  if (shotDir) await download.saveAs(pdfPath);
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pageCount, layout.length, `the PDF has one page per proposal page (${pageCount} / ${layout.length})`);
  assert.match(pdf.toString("latin1"), /\/MediaBox\s*\[\s*0\s+0\s+595\.\d+\s+841\.\d+\s*\]/, "A4 page size");
  let found = 0;
  for (let i = 0; i < pdf.length - 3; i++) {
    if (pdf[i] === 0xff && pdf[i + 1] === 0xd8 && pdf[i + 2] === 0xff) {
      let end = pdf.indexOf(Buffer.from([0xff, 0xd9, 0x0a, 0x65, 0x6e, 0x64, 0x73, 0x74]), i);
      if (end < 0) end = pdf.indexOf(Buffer.from("endstream"), i);
      if (end < 0) break;
      found += 1;
      if (shotDir) fs.writeFileSync(`${shotDir}/pdf-page-${found}.jpg`, pdf.subarray(i, end + 2));
      i = end;
    }
  }
  assert.equal(found, layout.length, "one page image per PDF page");
  pass(`Download PDF produces a real A4 PDF with ${pageCount} pages, one image per proposal page`);
  await context.close();

  const mobile = await open({ width: 375, height: 800 });
  check(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll on a phone");
  check(await mobile.page.evaluate(() => [...document.querySelectorAll(".proposal-page")].every((el) => el.getBoundingClientRect().width <= window.innerWidth + 1)), "the scaled pages fit the phone width");
  if (shotDir) await mobile.page.locator(".proposal-page").nth(3).screenshot({ path: `${shotDir}/p-mobile-page-4.png` });
  pass("phone width: pages scale to fit with no horizontal scroll");
  await mobile.context.close();

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
  pass("server log is free of tenant violations");
  if (problems.length) console.log("\nSOFT layout problems:\n - " + problems.join("\n - "));
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1200));
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
