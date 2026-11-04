/**
 * Quotation revision history, original-PDF viewer and comparison, through the real API and a real browser (isolated production
 * server, throwaway MongoDB). A quotation is issued three times (Rev 1, 2, 3) with real multi-page PDFs:
 *   - the comparison API reports added / removed / changed products, quantities, per-product discounts, rooms, the 18% Service &
 *     Integration charge and the final total, for consecutive and non-consecutive pairs; bad requests are clear errors;
 *   - another dealer, another company and signed-out visitors get nothing; the PDFs served are byte for byte the stored ones and stay
 *     unchanged after viewing and comparing;
 *   - the history lists each revision with View PDF, Download PDF and Compare; the viewer draws the original PDF pages with zoom
 *     and download; the comparison shows the changes summary and both PDFs side by side (tabs on a phone), with full screen;
 *   - a quotation with one issued revision can be viewed and downloaded, and comparison is disabled with an explanation.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/revision-compare.browser.mjs   (SCREENSHOT_DIR=<dir> for screenshots)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** A small, valid PDF with one line of text per page (so pdf.js can draw it). */
function makePdf(pageTexts) {
  const bodies = [];
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids = [];
  let next = 4;
  for (const text of pageTexts) {
    const pageId = next++;
    const contentId = next++;
    const stream = `BT /F1 28 Tf 60 700 Td (${text}) Tj ET`;
    bodies[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    bodies[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    kids.push(`${pageId} 0 R`);
  }
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < bodies.length; i += 1) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${bodies.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${bodies.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

try {
  server = await startIsolatedServer("rev-compare", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "dealera2@example.com", role: "dealer", name: "Dealer A2", discountAllocationPercent: 10, companyId: 20 },
    { _id: 4, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("roomtypes").insertMany([
    { _id: 201, companyId: 20, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 202, companyId: 20, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 201, companyId: 20, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 201, companyId: 20, houseTypeId: 201, roomTypeId: 201, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertMany([
    { _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2002, companyId: 20, name: "Switch Frame", code: "P-2002", type: "accessory", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2003, companyId: 20, name: "Curtain Motor", code: "P-2003", type: "curtain", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 3, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  const variant = (id, productId, code, price, pwt) => ({ _id: id, companyId: 20, productId, variantCode: code, name: code, config: {}, price: dec(price), priceWithoutTax: dec(pwt), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertMany([variant(1, 2001, "SW-1", "1180.00", "1000.00"), variant(2, 2002, "FR-1", "300.00", "254.24"), variant(3, 2003, "CM-1", "9440.00", "8000.00")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = { owner: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), dealer2: await login("dealera2@example.com", "user"), b: await login("ownerb@example.com", "admin") };

  const ok = (res, label) => assert.ok(res.status >= 200 && res.status < 300, `${label}: ${res.status} ${res.text?.slice(0, 200)}`);
  const quote = (id) => api(c.owner, "GET", `/api/quotations/${id}`).then((r) => r.data);
  const upload = async (id, buffer) => {
    const form = new FormData();
    form.append("pdf", new Blob([buffer], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/revisions/current/pdf`, { method: "POST", headers: { Cookie: c.dealer }, body: form });
    assert.equal(res.status, 200, await res.text());
  };
  const issue = async (id, pdf) => {
    ok(await api(c.dealer, "POST", `/api/quotations/${id}/mark-sent`), "mark sent");
    await upload(id, pdf);
  };
  const revise = async (id, reason) => ok(await api(c.dealer, "POST", `/api/quotations/${id}/revisions`, { reason }), "revise");

  // ═══ one quotation, three issued revisions ═══
  const created = await api(c.dealer, "POST", "/api/quotations", { clientName: "Mehta Residence", houseTypeId: 201 });
  ok(created, "create");
  const qid = created.data.id ?? created.data._id;
  const living = (await quote(qid)).rooms[0].id;
  ok(await api(c.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: living, productId: 2001, productVariantId: 1, quantity: 4 }), "switch");
  ok(await api(c.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: living, productId: 2002, productVariantId: 2, quantity: 1 }), "frame");
  const pdf1 = makePdf(["Revision 1 page 1", "Revision 1 page 2"]);
  await issue(qid, pdf1);

  await revise(qid, "Client wants six switches and a curtain motor, no frame");
  let items = (await quote(qid)).rooms[0].items;
  const switchItem = items.find((i) => Number(i.productId) === 2001);
  const frameItem = items.find((i) => Number(i.productId) === 2002);
  ok(await api(c.dealer, "PATCH", `/api/quotations/${qid}/items/${switchItem.id}`, { quantity: 6 }), "qty");
  ok(await api(c.dealer, "DELETE", `/api/quotations/${qid}/items/${frameItem.id}`), "remove frame");
  ok(await api(c.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: living, productId: 2003, productVariantId: 3, quantity: 1 }), "motor");
  const pdf2 = makePdf(["Revision 2 page 1", "Revision 2 page 2", "Revision 2 page 3"]);
  await issue(qid, pdf2);

  await revise(qid, "Owner gives 10% off the switches; bedroom added");
  ok(await api(c.owner, "PATCH", `/api/quotations/${qid}/items/${switchItem.id}`, { discountType: "percentage", discountValue: 10 }), "discount");
  const bedroom = await api(c.dealer, "POST", `/api/quotations/${qid}/rooms`, { roomTypeId: 202 });
  ok(bedroom, "room");
  const bedroomId = bedroom.data.id ?? bedroom.data._id;
  ok(await api(c.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: bedroomId, productId: 2001, productVariantId: 1, quantity: 2 }), "bedroom switch");
  const pdf3 = makePdf(["Revision 3 page 1"]);
  await issue(qid, pdf3);
  const records = await db.collection("quotationrevisions").find({ quotationId: qid }).sort({ revision: 1 }).toArray();
  assert.deepEqual(records.map((r) => r.revision), [1, 2, 3]);
  assert.ok(records.every((r) => r.pdf), "each revision has its PDF");

  // ═══ comparison API ═══
  const compare = (cookie, from, to) => api(cookie, "GET", `/api/quotations/${qid}/revisions/compare?from=${from}&to=${to}`);
  const one = await compare(c.dealer, 1, 2);
  assert.equal(one.status, 200, one.text?.slice(0, 300));
  const lines = one.data.comparison.lines;
  const find = (product, kind) => lines.find((l) => l.product === product && l.kind === kind);
  assert.deepEqual([find("Smart Switch", "modified")?.fields, find("Smart Switch", "modified")?.from.quantity, find("Smart Switch", "modified")?.to.quantity, find("Smart Switch", "modified")?.totalDelta], [["quantity"], 4, 6, 2360]);
  assert.equal(find("Curtain Motor", "added")?.to.lineTotal, 9440);
  assert.equal(find("Switch Frame", "removed")?.from.lineTotal, 300);
  const totals = Object.fromEntries(one.data.comparison.totals.map((t) => [t.key, t]));
  const [s1, s2, s3] = records.map((r) => r.snapshot.totals);
  assert.deepEqual([totals.grandTotal.from, totals.grandTotal.to], [s1.grandTotal, s2.grandTotal], "totals are the frozen ones");
  assert.equal(totals.grandTotal.delta, Math.round((s2.grandTotal - s1.grandTotal) * 100) / 100);
  for (const s of [s1, s2, s3]) {
    assert.equal(s.totalGstAmount, Math.round(s.netSubtotal * 0.18 * 100) / 100, "the Service & Integration charge is 18% of the net subtotal");
    assert.equal(s.grandTotal, Math.round((s.netSubtotal + s.totalGstAmount) * 100) / 100, "the total is the net subtotal plus that charge (prices already include GST)");
  }
  assert.deepEqual([s1.subtotal, s2.subtotal], [4 * 1180 + 300, 6 * 1180 + 9440]);
  assert.equal(totals.productGst.to, 6 * 180 + 1440, "GST within product prices, line by line");

  const twoThree = await compare(c.dealer, 2, 3);
  assert.equal(twoThree.status, 200);
  const discounted = twoThree.data.comparison.lines.find((l) => l.product === "Smart Switch" && l.kind === "modified");
  assert.deepEqual([discounted?.fields, discounted?.to.discount, discounted?.to.unitPrice], [["unitPrice", "discount", "gst"], "10% off", 1062], "the discount lowers the GST-inclusive price, and so the GST within it");
  assert.deepEqual([discounted.from.gst / discounted.from.quantity, Math.round((discounted.to.gst / discounted.to.quantity) * 100) / 100], [180, 162], "GST per unit ₹180 → ₹162 (18% inside ₹1,062)");
  assert.deepEqual(twoThree.data.comparison.rooms.map((r) => [r.kind, r.name]), [["added", "Master Bedroom"]]);
  assert.ok(twoThree.data.comparison.lines.some((l) => l.kind === "added" && l.room === "Master Bedroom"), "the bedroom's switch is added");
  assert.equal(Object.fromEntries(twoThree.data.comparison.totals.map((t) => [t.key, t])).productDiscounts.to, 6 * 118);
  const oneThree = await compare(c.dealer, 1, 3);
  assert.equal(oneThree.status, 200, "non-consecutive revisions compare too");
  assert.equal(oneThree.data.comparison.totals.find((t) => t.key === "grandTotal").delta, Math.round((s3.grandTotal - s1.grandTotal) * 100) / 100);
  assert.deepEqual([oneThree.data.from.revision, oneThree.data.to.revision, oneThree.data.from.quotationNumber === oneThree.data.to.quotationNumber], [1, 3, true], "the same quotation number on every revision");
  assert.equal((await compare(c.dealer, 2, 2)).status, 400, "the same revision twice");
  assert.equal((await compare(c.dealer, 1, 9)).status, 404, "a revision that was never issued");
  assert.equal((await api(c.dealer, "GET", `/api/quotations/${qid}/revisions/compare?from=one&to=2`)).status, 400);
  pass("the comparison API reports added, removed and changed products, quantities, per-product discounts, a new room, the 18% charge and the total difference, for consecutive and non-consecutive revisions");

  assert.equal((await compare(c.dealer2, 1, 2)).status, 403, "another dealer");
  assert.equal((await compare(c.b, 1, 2)).status, 404, "another company does not even see the quotation");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${qid}/revisions/compare?from=1&to=2`)).status, 401, "signed out");
  assert.equal((await compare(c.owner, 1, 2)).status, 200, "the Company Owner may");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${qid}/revisions/1/pdf`, { headers: { Cookie: c.dealer2 } })).status, 403, "another dealer cannot fetch a PDF");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${qid}/revisions/1/pdf`, { headers: { Cookie: c.b } })).status, 404, "nor another company");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${qid}/revisions/1/pdf`)).status, 401, "nor a signed-out visitor");
  pass("another dealer, another company and signed-out visitors can neither compare nor fetch the PDFs");

  // ═══ the PDFs are the originals, byte for byte ═══
  const storedBytes = async () => {
    const out = [];
    for (const record of await db.collection("quotationrevisions").find({ quotationId: qid }).sort({ revision: 1 }).toArray()) {
      const file = await db.collection(record.pdf.source === "delivery" ? "quotationdeliveryfiles" : "quotationrevisionfiles").findOne({ _id: record.pdf.fileId });
      out.push(sha(Buffer.from(file.data.buffer ?? file.data)));
    }
    return out;
  };
  const before = await storedBytes();
  assert.deepEqual(before, [sha(pdf1), sha(pdf2), sha(pdf3)], "what is stored is what was uploaded");
  for (const [index, original] of [pdf1, pdf2, pdf3].entries()) {
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/revisions/${index + 1}/pdf`, { headers: { Cookie: c.dealer } });
    assert.equal(sha(Buffer.from(await res.arrayBuffer())), sha(original), `Rev ${index + 1} is served byte for byte`);
  }

  // ═══ the screens ═══
  const shots = process.env.SCREENSHOT_DIR;
  browser = await chromium.launch({ headless: true });
  const open = async (cookie, viewport, path) => {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    return { context, page, failures };
  };
  const vis = (scope, id) => scope.locator(`[data-testid="${id}"]:visible`);
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const downloadSha = async (page, trigger) => {
    const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
    return { sha: sha(await readFile(await download.path())), name: download.suggestedFilename() };
  };
  const canvasesDrawn = (panel) => panel.locator('[data-testid="pdf-page"]').evaluateAll((canvases) => canvases.map((c) => c.width > 0 && c.height > 0));

  // history in the quotation builder
  const desk = await open(c.dealer, { width: 1280, height: 900 }, `/quotation/${qid}?step=3`);
  await vis(desk.page, "revision-bar").waitFor();
  await vis(desk.page, "revision-history-open").click();
  const history = vis(desk.page, "revision-history");
  await vis(history, "revision-row").first().waitFor();
  assert.equal(await vis(history, "revision-row").count(), 3);
  const newest = await vis(history, "revision-row").first().innerText();
  const number = records[0].quotationNumber;
  assert.match(newest, new RegExp(`Rev 3[\\s\\S]*${number}[\\s\\S]*Current[\\s\\S]*Dealer A[\\s\\S]*₹[\\s\\S]*Owner gives 10% off`, "i"), "Rev, quotation number, Current, who, amount and reason");
  assert.match(await vis(history, "revision-row").nth(1).innerText(), /Rev 2[\s\S]*Superseded by Rev 3/i);
  assert.equal(await vis(history, "revision-view").count(), 3);
  assert.equal(await vis(history, "revision-compare").count(), 3);
  const fromHistory = await downloadSha(desk.page, () => vis(history, "revision-pdf").nth(2).click());
  assert.deepEqual([fromHistory.sha, fromHistory.name], [sha(pdf1), `${number}-rev1.pdf`], "Download PDF in the history saves Rev 1's original file");
  if (shots) await desk.page.screenshot({ path: `${shots}/revision-history-1280.png` });
  await vis(history, "revision-view").nth(2).click();
  await desk.page.waitForURL(/\/revisions\?view=1/);
  const single = vis(desk.page, "revision-pdf-panel");
  await single.locator('[data-testid="pdf-page"]').first().waitFor();
  await desk.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="pdf-page"]')].every((c) => c.width > 0));
  assert.deepEqual(await canvasesDrawn(single), [true, true], "View PDF draws both pages of Rev 1");
  assert.match(await single.innerText(), /Rev 1 · Superseded[\s\S]*2 pages/);
  const widthBefore = await single.locator('[data-testid="pdf-page"]').first().evaluate((c) => c.getBoundingClientRect().width);
  await vis(single, "pdf-zoom-in").click();
  await desk.page.waitForFunction((w) => document.querySelector('[data-testid="pdf-page"]').getBoundingClientRect().width > w + 20, widthBefore);
  assert.equal(await vis(single, "pdf-zoom-level").innerText(), "125%");
  const viewerDownload = await downloadSha(desk.page, () => vis(single, "pdf-download").click());
  assert.deepEqual([viewerDownload.sha, viewerDownload.name], [sha(pdf1), `${number}-rev1.pdf`], "the viewer's Download saves the same original bytes");
  pass("the history lists each revision (Rev, number, Current / Superseded, date, issuer, amount, reason) with View PDF, Download PDF and Compare; the viewer draws the original pages, zooms and downloads the original file");

  // side-by-side comparison, Rev 1 vs Rev 2, then Rev 1 vs Rev 3
  await desk.page.goto(`${baseUrl}/quotation/${qid}/revisions?from=1&to=2`, { waitUntil: "domcontentloaded" });
  const changes = vis(desk.page, "revision-changes");
  await vis(changes, "change-line").first().waitFor();
  const kinds = await vis(changes, "change-line").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-kind")));
  assert.deepEqual(kinds.sort(), ["added", "modified", "removed"]);
  assert.match(await changes.innerText(), /Smart Switch[\s\S]*Quantity 4 → 6 \(\+2\)/);
  assert.match(await changes.innerText(), /Curtain Motor[\s\S]*Added/i);
  assert.match(await changes.innerText(), /Switch Frame[\s\S]*Removed/i);
  assert.match(await vis(changes, "changes-totals").innerText(), /Service & Integration \(18%\)[\s\S]*Final quotation total/);
  const left = vis(desk.page, "compare-left");
  const right = vis(desk.page, "compare-right");
  for (const panel of [left, right]) await panel.locator('[data-testid="pdf-page"]').first().waitFor();
  await desk.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="pdf-page"]')].length === 5 && [...document.querySelectorAll('[data-testid="pdf-page"]')].every((c) => c.width > 0));
  assert.deepEqual([(await canvasesDrawn(left)).length, (await canvasesDrawn(right)).length], [2, 3], "Rev 1 (2 pages) on the left, Rev 2 (3 pages) on the right");
  const rightWidth = await right.locator('[data-testid="pdf-page"]').first().evaluate((c) => c.getBoundingClientRect().width);
  await vis(left, "pdf-zoom-in").click();
  await vis(left, "pdf-zoom-in").click();
  await desk.page.waitForFunction(() => document.querySelector('[data-testid="compare-left"] [data-testid="pdf-zoom-level"]').textContent === "150%");
  await desk.page.waitForTimeout(400);
  assert.equal(Math.round(await right.locator('[data-testid="pdf-page"]').first().evaluate((c) => c.getBoundingClientRect().width)), Math.round(rightWidth), "zooming one side leaves the other alone");
  await left.locator('[data-testid="pdf-scroll"]').evaluate((el) => { el.scrollTop = 400; });
  assert.equal(await right.locator('[data-testid="pdf-scroll"]').evaluate((el) => el.scrollTop), 0, "and each side scrolls on its own");
  const leftDownload = await downloadSha(desk.page, () => vis(left, "pdf-download").click());
  const rightDownload = await downloadSha(desk.page, () => vis(right, "pdf-download").click());
  assert.deepEqual([leftDownload.sha, rightDownload.sha], [sha(pdf1), sha(pdf2)], "each side downloads its own original PDF");
  if (shots) await desk.page.screenshot({ path: `${shots}/revision-compare-1280.png`, fullPage: true });
  await vis(desk.page, "compare-fullscreen").click();
  await desk.page.waitForFunction(() => document.fullscreenElement?.getAttribute("data-testid") === "compare-stage");
  assert.match(await vis(desk.page, "compare-fullscreen").innerText(), /Exit full screen/);
  if (shots) await desk.page.screenshot({ path: `${shots}/revision-compare-fullscreen-1280.png` });
  await desk.page.evaluate(() => document.exitFullscreen());
  await desk.page.waitForFunction(() => !document.fullscreenElement);
  // pick Rev 3 on the right: a non-consecutive comparison
  await desk.page.getByRole("button", { name: "Second revision" }).click();
  await desk.page.getByRole("option", { name: /^Rev 3/ }).click();
  await desk.page.waitForURL(/from=1&to=3/);
  await desk.page.waitForFunction(() => document.querySelector('[data-testid="revision-changes"]')?.textContent?.includes("Master Bedroom"));
  assert.match(await vis(desk.page, "revision-changes").innerText(), /Room added: Master Bedroom/);
  assert.match(await vis(desk.page, "revision-changes").innerText(), /10% off/);
  assert.ok(await noScroll(desk.page), "no horizontal scroll at 1280px");
  assert.deepEqual(desk.failures, [], "no page errors");
  await desk.context.close();
  pass("Rev 1 vs Rev 2 side by side: the changes summary (added, removed, changed, totals with the 18% charge), each PDF drawn, zoomed, scrolled and downloaded on its own, full screen; then Rev 1 vs Rev 3 picked from the list");

  // phone: tabs instead of side by side
  const phone = await open(c.dealer, { width: 375, height: 800 }, `/quotation/${qid}/revisions?from=1&to=2`);
  await vis(phone.page, "change-line").first().waitFor();
  await vis(phone.page, "mobile-tab-from").waitFor();
  assert.equal(await vis(phone.page, "revision-pdf-panel").count(), 1, "one PDF at a time on a phone");
  await vis(phone.page, "revision-pdf-panel").locator('[data-testid="pdf-page"]').first().waitFor();
  assert.match(await vis(phone.page, "revision-pdf-panel").innerText(), /Rev 1/);
  await vis(phone.page, "mobile-tab-to").click();
  await phone.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="revision-pdf-panel"]')].filter((p) => p.offsetParent !== null).every((p) => p.getAttribute("data-revision") === "2"));
  assert.ok(await noScroll(phone.page), "no horizontal scroll at 375px (the change tables scroll inside themselves)");
  if (shots) await phone.page.screenshot({ path: `${shots}/revision-compare-375.png`, fullPage: true });
  assert.deepEqual(phone.failures, []);
  await phone.context.close();
  pass("on a phone the two PDFs are tabs (one at a time), with the changes summary above and no sideways scrolling");

  // a quotation with only one issued revision
  const lone = await api(c.dealer, "POST", "/api/quotations", { clientName: "Single Client", houseTypeId: 201 });
  const loneId = lone.data.id ?? lone.data._id;
  const loneRoom = (await quote(loneId)).rooms[0].id;
  ok(await api(c.dealer, "POST", `/api/quotations/${loneId}/items`, { quotationRoomId: loneRoom, productId: 2001, productVariantId: 1, quantity: 1 }), "lone item");
  const lonePdf = makePdf(["Only revision"]);
  await issue(loneId, lonePdf);
  const solo = await open(c.dealer, { width: 1280, height: 900 }, `/quotation/${loneId}?step=3`);
  await vis(solo.page, "revision-history-open").click();
  await vis(solo.page, "revision-row").first().waitFor();
  assert.equal(await vis(solo.page, "revision-compare-disabled").count(), 1, "Compare is disabled with one revision");
  assert.match(await vis(solo.page, "revision-compare-unavailable").innerText(), /needs at least two issued revisions/);
  await solo.page.goto(`${baseUrl}/quotation/${loneId}/revisions`, { waitUntil: "domcontentloaded" });
  await vis(solo.page, "compare-unavailable").waitFor();
  await vis(solo.page, "revision-pdf-panel").locator('[data-testid="pdf-page"]').first().waitFor();
  const soloDownload = await downloadSha(solo.page, () => vis(solo.page, "pdf-download").click());
  assert.equal(soloDownload.sha, sha(lonePdf));
  await solo.context.close();
  pass("with one issued revision: View and Download work, and comparison is disabled with an explanation");

  // another dealer opening the comparison page sees nothing of it
  const other = await open(c.dealer2, { width: 1280, height: 900 }, `/quotation/${qid}/revisions?from=1&to=2`);
  // (Next.js keeps an empty route announcer with role="alert" on every page; the refusal is the one with words in it.)
  await other.page.getByRole("alert").filter({ hasText: /permission/i }).first().waitFor();
  assert.equal(await other.page.locator('[data-testid="pdf-page"]').count(), 0);
  await other.context.close();
  pass("another dealer opening the comparison link is refused and sees no PDF");

  assert.deepEqual(await storedBytes(), before, "after all the viewing, downloading and comparing, every stored PDF is byte for byte unchanged");
  const after = await db.collection("quotationrevisions").find({ quotationId: qid }).sort({ revision: 1 }).toArray();
  assert.deepEqual(after.map((r) => JSON.stringify(r.snapshot)), records.map((r) => JSON.stringify(r.snapshot)), "and every frozen snapshot too");
  pass("the original PDFs and snapshots are byte for byte unchanged after everything above");

  console.log(`\nALL ${count} REVISION COMPARE TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
