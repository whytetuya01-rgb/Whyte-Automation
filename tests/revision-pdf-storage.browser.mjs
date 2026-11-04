/**
 * Every issued revision keeps its PDF, through the real API and a real browser (isolated production server, throwaway MongoDB,
 * a fake email provider):
 *   - an email that fails first and goes through on Retry: the quotation is sent AND Revision 1 keeps the PDF that was sent
 *     (before this fix the retry issued the revision without its PDF);
 *   - a failed send of an older revision cannot be retried once the quotation has moved to a newer revision;
 *   - a revision that was issued without its PDF but WAS sent (email / WhatsApp) gets the sent PDF back by itself when its
 *     history is read, and through "Store PDF now"; never the PDF of another revision;
 *   - "Store PDF now" with no sent copy explains what to do; other dealers and companies cannot use it;
 *   - Print on the Proposal Preview keeps a PDF with the revision; the admin list warns before marking sent without a PDF.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/revision-pdf-storage.browser.mjs
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
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
let fake;
let exitCode = 0;
const dec = (v) => Decimal128.fromString(v);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const pdfOf = (label) => Buffer.concat([Buffer.from(`%PDF-1.7\n% ${label}\n`), randomBytes(2000), Buffer.from("\n%%EOF")]);

const emails = [];
let mode = "ok"; // ok | http500
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/emails") { res.statusCode = 404; res.end("{}"); return; }
      if (mode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ message: "temporary provider problem" })); return; }
      emails.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

try {
  fake = await startFake();
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "Quotations <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
    QUOTATION_DELIVERY_RATE_LIMIT_MAX: "60",
    SESSION_ACTOR_CACHE_TTL_MS: "0",
  });
  server = await startIsolatedServer("rev-pdf-store", [
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
  await db.collection("roomtypes").insertOne({ _id: 201, companyId: 20, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 201, companyId: 20, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 201, companyId: 20, houseTypeId: 201, roomTypeId: 201, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertOne({ _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 1, companyId: 20, productId: 2001, variantCode: "SW-1", name: "SW-1", config: {}, price: dec("1180.00"), priceWithoutTax: dec("1000.00"), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = { owner: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), dealer2: await login("dealera2@example.com", "user"), b: await login("ownerb@example.com", "admin") };

  const ok = (res, label) => assert.ok(res.status >= 200 && res.status < 300, `${label}: ${res.status} ${res.text?.slice(0, 200)}`);
  const newQuotation = async (client) => {
    const created = await api(c.dealer, "POST", "/api/quotations", { clientName: client, houseTypeId: 201, clientAddress: "Ahmedabad" });
    ok(created, "create");
    const id = created.data.id ?? created.data._id;
    const roomId = (await api(c.dealer, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    ok(await api(c.dealer, "POST", `/api/quotations/${id}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 1, quantity: 2 }), "item");
    return id;
  };
  const sendEmail = async (id, pdf) => {
    const body = new FormData();
    body.append("to", "client@example.com");
    body.append("subject", "Your quotation");
    body.append("pdf", new Blob([pdf], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/deliveries`, { method: "POST", headers: { Cookie: c.dealer }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const shareWhatsApp = async (id, pdf) => {
    const body = new FormData();
    body.append("channel", "whatsapp");
    body.append("to", "9876543210");
    body.append("pdf", new Blob([pdf], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/deliveries`, { method: "POST", headers: { Cookie: c.dealer }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const retry = (id, deliveryId) => api(c.dealer, "POST", `/api/quotations/${id}/deliveries/${deliveryId}/retry`);
  const record = (id, revision) => db.collection("quotationrevisions").findOne({ quotationId: id, revision });
  const quotationRow = (id) => db.collection("quotations").findOne({ _id: id });
  const recover = (cookie, id) => api(cookie, "POST", `/api/quotations/${id}/revisions/current/pdf/recover`);
  const markSent = async (id, pdf) => {
    const form = new FormData();
    form.append("pdf", new Blob([pdf], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/mark-sent`, { method: "POST", headers: { Cookie: c.dealer }, body: form });
    return { status: res.status, text: await res.text() };
  };
  /** The state older quotations are in: issued, but no PDF was kept (before a PDF was required). */
  const forgetPdf = (id, revision) => db.collection("quotationrevisions").updateOne({ quotationId: id, revision }, { $set: { pdf: null } });

  // ═══ the bug: a failed email that goes through on Retry ═══
  const q1 = await newQuotation("Retry Client");
  const pdf1 = pdfOf("retry rev 1");
  mode = "http500";
  const first = await sendEmail(q1, pdf1);
  assert.equal(first.status, 201);
  assert.equal(first.json.data.status, "failed");
  assert.equal((await quotationRow(q1)).status, "draft", "a failed email leaves the quotation a draft");
  mode = "ok";
  const retried = await retry(q1, first.json.data.id);
  assert.equal(retried.status, 200, retried.text?.slice(0, 200));
  assert.equal((await quotationRow(q1)).status, "sent");
  const r1 = await record(q1, 1);
  assert.ok(r1?.pdf, "Revision 1 keeps a PDF after the retry");
  assert.deepEqual([r1.pdf.source, r1.pdf.sha256], ["delivery", sha(pdf1)], "the very PDF that was emailed");
  pass("an email that fails and then goes through on Retry sends the quotation AND keeps the emailed PDF as Revision 1's PDF");

  // ═══ a failed send of an older revision cannot be retried on a newer revision ═══
  const q2 = await newQuotation("Stale Client");
  const pdf2 = pdfOf("stale rev 1");
  ok({ status: (await shareWhatsApp(q2, pdf2)).status }, "whatsapp");
  mode = "http500";
  const failedOld = await sendEmail(q2, pdfOf("stale rev 1 email"));
  mode = "ok";
  assert.equal(failedOld.json.data.status, "failed");
  ok(await api(c.dealer, "POST", `/api/quotations/${q2}/revisions`, { reason: "Change the switches" }), "revise");
  const stale = await retry(q2, failedOld.json.data.id);
  assert.equal(stale.status, 409);
  assert.match(stale.json?.error?.message ?? stale.text, /was for Revision 1; the quotation is now Revision 2/);
  assert.equal((await quotationRow(q2)).status, "draft", "Revision 2 stays a draft; nothing was sent");
  pass("a failed send of Revision 1 cannot be retried once the quotation is on Revision 2 (it would send, and keep, the wrong document)");

  // ═══ issued without its PDF, but sent: it heals by itself; never from another revision ═══
  const q3 = await newQuotation("Heal Client");
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q3}/mark-sent`)).status, 400, "a draft is never marked sent without its PDF");
  ok(await markSent(q3, pdfOf("heal issued")), "mark sent with its PDF");
  await forgetPdf(q3, 1);
  assert.equal((await record(q3, 1)).pdf, null, "issued without a PDF (as quotations sent before this change can be)");
  const noCopy = await recover(c.dealer, q3);
  assert.equal(noCopy.status, 404);
  assert.match(noCopy.json?.error?.message ?? noCopy.text, /Download PDF/);
  assert.equal(noCopy.json?.error?.details?.reason, "NO_SENT_PDF");
  // the state the old retry left behind: a successful send of revision 1 whose PDF was never adopted
  const healPdf = pdfOf("heal rev 1");
  const deliveryId = `qd_${randomBytes(16).toString("hex")}`;
  await db.collection("quotationdeliveryfiles").insertOne({ _id: deliveryId, companyId: 20, mime: "application/pdf", size: healPdf.length, sha256: sha(healPdf), data: healPdf, createdAt: now });
  await db.collection("quotationdeliveries").insertOne({ _id: deliveryId, companyId: 20, quotationId: q3, revision: 1, channel: "email", recipient: "client@example.com", subject: "Q", message: null, attachmentName: "q.pdf", attachmentSize: healPdf.length, attachmentSha256: sha(healPdf), status: "sent", attempts: 2, events: [], createdBy: 2, createdByName: "Dealer A", createdAt: now, updatedAt: now });
  assert.equal((await recover(c.dealer2, q3)).status, 403, "another dealer cannot");
  assert.equal((await recover(c.b, q3)).status, 404, "another company does not see it");
  const list = await api(c.dealer, "GET", `/api/quotations/${q3}/revisions`);
  assert.equal(list.status, 200);
  assert.equal(list.data.revisions[0].hasPdf, true, "reading the history repaired it");
  assert.deepEqual([(await record(q3, 1)).pdf.source, (await record(q3, 1)).pdf.sha256], ["delivery", sha(healPdf)]);
  const again = await recover(c.dealer, q3);
  assert.deepEqual([again.status, again.data.stored], [200, false], "Store PDF now: already stored, nothing changes");
  // Revision 2 issued without a PDF must not take Revision 1's sent PDF
  ok(await api(c.dealer, "POST", `/api/quotations/${q3}/revisions`, { reason: "Second issue" }), "revise q3");
  ok(await markSent(q3, pdfOf("heal rev 2")), "issue rev 2");
  await forgetPdf(q3, 2);
  assert.equal((await recover(c.dealer, q3)).status, 404, "no send of Revision 2 exists, so nothing is adopted");
  assert.equal((await api(c.dealer, "GET", `/api/quotations/${q3}/revisions`)).data.revisions.find((r) => r.revision === 2).hasPdf, false);
  assert.equal((await record(q3, 2)).pdf, null, "Revision 2 never takes Revision 1's PDF");
  pass("a revision issued without its PDF but sent by email gets the sent PDF back (on reading the history or Store PDF now); never another revision's; other dealers and companies cannot");

  // ═══ screens ═══
  browser = await chromium.launch({ headless: true });
  const open = async (cookie, viewport, path, init) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    return { context, page };
  };
  const vis = (scope, id) => scope.locator(`[data-testid="${id}"]:visible`);

  // Store PDF now, with no sent copy: explains what to do (Revision 2 of q3)
  const desk = await open(c.dealer, { width: 1280, height: 900 }, `/quotation/${q3}?step=3`);
  await vis(desk.page, "revision-history-open").click();
  await vis(desk.page, "revision-store-pdf").waitFor();
  await vis(desk.page, "revision-store-pdf").click();
  await vis(desk.page, "revision-store-pdf-help").waitFor();
  assert.match(await vis(desk.page, "revision-store-pdf-help").innerText(), /Open the Proposal Preview and click Download PDF/);
  await desk.context.close();
  pass("in Revision history, Store PDF now on a revision with no sent copy explains how to store it (Proposal Preview → Download PDF)");

  // Share, Send, Print / Save as PDF and Download PDF: each marks the quotation sent and keeps its PDF
  const waitIssued = async (page, id) => {
    for (let i = 0; i < 90 && !((await quotationRow(id)).status === "sent" && (await record(id, 1))?.pdf); i += 1) await page.waitForTimeout(1000);
    const issued = await record(id, 1);
    return { status: (await quotationRow(id)).status, pdf: issued?.pdf ?? null };
  };
  for (const [label, name] of [["Share", /^Share$/], ["Send", /^Send$/], ["Print / Save as PDF", /^Print( \/ Save as PDF)?$/], ["Download PDF", /^Download PDF$/]]) {
    const id = await newQuotation(`${label} Client`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
    await context.addCookies(c.dealer.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    await context.addInitScript(() => { window.print = () => {}; });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${baseUrl}/quotation/${id}?step=5`, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name }).locator("visible=true").first();
    await button.waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".proposal-page").length > 0 || document.querySelector("[data-testid='document-quotation-number']"));
    await page.waitForTimeout(1500);
    await button.click();
    const result = await waitIssued(page, id);
    assert.equal(result.status, "sent", `${label}: the quotation is sent`);
    assert.ok(result.pdf, `${label}: its PDF is kept with Revision 1`);
    assert.equal(result.pdf.source, "revision_file");
    if (label === "Send") assert.ok(await page.getByRole("dialog").locator("visible=true").count() > 0, "Send also opens the send window");
    await context.close();
  }
  pass("Share, Send, Print / Save as PDF and Download PDF on the Proposal Preview each mark the quotation sent and keep its PDF with Revision 1");

  // the admin list asks before marking sent without a PDF
  const q5 = await newQuotation("Admin List Client");
  const admin = await open(c.owner, { width: 1280, height: 900 }, "/admin/quotations");
  const number = (await quotationRow(q5)).quotationNumber;
  const statusButton = () => admin.page.locator("tr").filter({ hasText: number }).getByRole("button", { name: "Change quotation status" }).locator("visible=true").first();
  const chooseSent = async () => {
    await statusButton().click();
    await admin.page.getByRole("option", { name: "Sent", exact: true }).locator("visible=true").first().click();
  };
  await statusButton().waitFor();
  await chooseSent();
  const dialog = admin.page.getByRole("dialog").filter({ hasText: "its PDF is created and kept with the revision" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await quotationRow(q5)).status, "draft", "cancel changes nothing");
  await chooseSent();
  await admin.page.getByRole("button", { name: "Open and mark sent" }).click();
  await admin.page.waitForURL(new RegExp(`/quotation/${q5}\\?step=5`));
  const viaList = await waitIssued(admin.page, q5);
  assert.deepEqual([viaList.status, viaList.pdf?.source], ["sent", "revision_file"], "marked sent from the list, with its PDF kept");
  await admin.context.close();
  pass("choosing Sent in the admin Quotations list opens the Proposal Preview, which creates the PDF, keeps it with the revision and marks the quotation sent (Cancel changes nothing)");

  console.log(`\nALL ${count} REVISION PDF STORAGE TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  fake?.close();
  process.exit(exitCode);
}
