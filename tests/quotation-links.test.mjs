/**
 * Secure quotation view links and WhatsApp sharing through the real API (production-mode server + throwaway local
 * MongoDB; the email provider is a local fake): sharing on WhatsApp, the public view page and PDF, "Viewed" tracking
 * (bots ignored), the link in emails, switching links off, expiry, the company-wide delivery log with filters, the
 * setup check, and isolation between companies, dealers and a Super Admin.
 *
 *   node tests/quotation-links.test.mjs
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let fake;
let exitCode = 0;

const emails = [];
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/emails") { res.statusCode = 404; res.end("{}"); return; }
      emails.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(3000), Buffer.from("\n%%EOF")]);
const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const RESEND_KEY = "re_links_test_key_not_real";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const sha = (value) => createHash("sha256").update(value).digest("hex");

try {
  fake = await startFake();
  Object.assign(process.env, {
    RESEND_API_KEY: RESEND_KEY,
    EMAIL_FROM: "Quotations <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
    RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    QUOTATION_DELIVERY_RATE_LIMIT_MAX: "60",
    SESSION_ACTOR_CACHE_TTL_MS: "0",
  });
  server = await startIsolatedServer("links", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "dealer.a1@example.com", role: "dealer", name: "Dealer A1", discountAllocationPercent: 10, companyId: 10 },
    { _id: 3, email: "dealer.a2@example.com", role: "dealer", name: "Dealer A2", discountAllocationPercent: 10, companyId: 10 },
    { _id: 4, email: "owner.a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 5, email: "dealer.b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 10, companyId: 20 },
    { _id: 6, email: "owner.b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [cid, base, name] of [[10, 100, "Acme Homes"], [20, 200, "Beta Builders"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = {
    super: await login("super@example.com", "admin"),
    a1: await login("dealer.a1@example.com", "user"),
    a2: await login("dealer.a2@example.com", "user"),
    ownerA: await login("owner.a@example.com", "admin"),
    b: await login("dealer.b@example.com", "user"),
    ownerB: await login("owner.b@example.com", "admin"),
  };
  const makeQuotation = async (c, base, name) => {
    const created = await api(c, "POST", "/api/quotations", { clientName: name, houseTypeId: base + 1 });
    assert.equal(created.status, 201, created.text?.slice(0, 160));
    const id = created.data.id ?? created.data._id;
    const room = (await api(c, "GET", `/api/quotations/${id}`)).data.rooms[0];
    assert.equal((await api(c, "POST", `/api/quotations/${id}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 2 })).status, 201);
    return id;
  };
  const qA = await makeQuotation(cookie.a1, 100, "Ravi Client");
  const qA2 = await makeQuotation(cookie.a1, 100, "Meera Client");
  const qB = await makeQuotation(cookie.b, 200, "Beta Client");
  const numberOf = async (id) => (await db.collection("quotations").findOne({ _id: id })).quotationNumber;

  const send = async (c, qid, fields, pdf = PDF) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.append(k, v);
    if (pdf) body.append("pdf", new Blob([pdf], { type: "application/pdf" }), "anything.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries`, { method: "POST", headers: c ? { Cookie: c } : {}, body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json, text };
  };
  const share = (c, qid, fields = {}) => send(c, qid, { channel: "whatsapp", to: "98765 43210", ...fields });
  const email = (c, qid, fields = {}) => send(c, qid, { to: "client@example.com", subject: "Your quotation", ...fields });
  const tokenOf = (url) => new URL(url).pathname.split("/").pop();
  const page = async (token) => {
    const res = await fetch(`${baseUrl}/q/${token}`, { headers: { "User-Agent": CHROME } });
    return { status: res.status, html: await res.text() };
  };
  const pdf = (token, query = "", method = "GET") => fetch(`${baseUrl}/api/public/quotation-links/${token}/pdf${query}`, { method, headers: { "User-Agent": CHROME } });
  const view = async (token, ua = CHROME) => {
    const headers = { "Content-Type": "application/json" };
    if (ua !== null) headers["User-Agent"] = ua;
    const res = await fetch(`${baseUrl}/api/public/quotation-links/view`, { method: "POST", headers, body: JSON.stringify({ token }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const revoke = async (c, qid, did, action = "revoke") => {
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries/${did}/link`, { method: "POST", headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}) }, body: JSON.stringify({ action }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const doc = (id) => db.collection("quotationdeliveries").findOne({ _id: id });

  // ═══ 1. share on WhatsApp ═══
  const numberA = await numberOf(qA);
  const emailsBefore = emails.length;
  const shared = await share(cookie.a1, qA, { message: "Hello Ravi", companyId: "20" });
  assert.equal(shared.status, 201, shared.text.slice(0, 200));
  const s = shared.json.data;
  assert.equal(s.channel, "whatsapp");
  assert.equal(s.status, "sent");
  assert.equal(s.recipient, "919876543210", "a 10-digit Indian mobile gets +91");
  assert.equal(s.canRetry, false);
  assert.equal(emails.length, emailsBefore, "nothing is emailed for a WhatsApp share");
  const wa = new URL(s.whatsappUrl);
  assert.equal(`${wa.origin}${wa.pathname}`, "https://wa.me/919876543210");
  const text = wa.searchParams.get("text");
  assert.equal(text, `Hello Ravi\n\nView your quotation: ${s.link.url}`, "the message and the secure link are typed in for the sender");
  assert.equal(s.link.state, "active");
  assert.ok(s.link.url.startsWith(`${baseUrl}/q/`));
  assert.equal(s.link.viewCount, 0);
  const tokenA = tokenOf(s.link.url);
  const storedA = await doc(s.id);
  assert.equal(storedA.companyId, 10, "stored under the sender's company, whatever the request said");
  assert.equal(storedA.viewTokenHash, sha(tokenA), "only the token's hash is used for lookups");
  assert.ok(storedA.viewTokenSealed && !storedA.viewTokenSealed.includes(tokenA), "the stored copy is encrypted");
  assert.deepEqual(storedA.events.map((e) => e.type), ["shared"]);
  assert.equal((await db.collection("quotations").findOne({ _id: qA })).status, "sent", "sharing moves a draft to sent");
  assert.equal(await db.collection("quotationauditevents").countDocuments({ quotationId: qA, action: "status_changed", "metadata.via": "whatsapp" }), 1);
  const defaultShare = await share(cookie.a1, qA2);
  assert.match(new URL(defaultShare.json.data.whatsappUrl).searchParams.get("text"), new RegExp(`^Dear Meera Client, please find quotation ${await numberOf(qA2)} from Acme Homes\\.\\n\\nView your quotation: `), "a default message names the client, quotation and company");
  pass("sharing on WhatsApp records the share, issues a secure link, and returns the click-to-chat address with the message and link filled in");

  for (const [label, fields, pdfBody, field] of [
    ["short number", { to: "12345" }, PDF, "to"],
    ["letters", { to: "call me" }, PDF, "to"],
    ["unknown channel", { channel: "sms" }, PDF, "channel"],
    ["long message", { message: "x".repeat(1501) }, PDF, "message"],
    ["missing PDF", {}, null, "pdf"],
    ["not a PDF", {}, Buffer.from("<html>"), "pdf"],
  ]) {
    const res = await send(cookie.a1, qA, { channel: "whatsapp", to: "9876543210", ...fields }, pdfBody);
    assert.ok(res.status >= 400 && res.status < 500, `${label}: ${res.status}`);
    assert.equal(res.json?.error?.field, field, `${label}: ${JSON.stringify(res.json?.error)}`);
  }
  assert.equal((await share(cookie.a2, qA)).status, 403, "another dealer cannot share it");
  assert.equal((await share(cookie.b, qA)).status, 404, "another company cannot find it");
  assert.equal((await share(null, qA)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/quotations/${qA}/deliveries/${s.id}/retry`, { method: "POST", headers: { Cookie: cookie.a1 } })).status, 409, "a WhatsApp share is never retried");
  pass("bad numbers, unknown channels, long messages and missing / fake PDFs are refused; only people who may modify the quotation can share; shares are not retried");

  // ═══ 2. the public view page and PDF ═══
  const viewPage = await page(tokenA);
  assert.equal(viewPage.status, 200);
  assert.ok(viewPage.html.includes(`Quotation ${numberA}`) && viewPage.html.includes("Acme Homes") && viewPage.html.includes("Ravi Client"), "the page names the quotation, company and client");
  assert.match(viewPage.html, /<meta name="robots" content="noindex, nofollow[^"]*"/);
  assert.match(viewPage.html, /<meta name="referrer" content="no-referrer"/);
  assert.equal((await doc(s.id)).viewCount, 0, "loading the page HTML alone (as a link preview does) is not a view");
  const inline = await pdf(tokenA);
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get("content-type"), "application/pdf");
  assert.match(inline.headers.get("content-disposition"), /^inline; filename="QT-\d{4}-\d{3}\.pdf"$/);
  assert.match(inline.headers.get("x-robots-tag"), /noindex/);
  assert.match(inline.headers.get("cache-control"), /no-store/);
  assert.ok(Buffer.from(await inline.arrayBuffer()).equals(PDF), "the exact PDF that was shared");
  assert.match((await pdf(tokenA, "?download=1")).headers.get("content-disposition"), /^attachment;/);
  assert.equal((await pdf(tokenA, "", "HEAD")).status, 200);
  assert.equal((await doc(s.id)).viewCount, 0, "fetching the PDF is not counted on its own");
  pass("without signing in, the link shows the quotation page (not indexed, no referrer) and serves the exact PDF inline or as a download");

  // ═══ 3. viewed ═══
  const v1 = await view(tokenA);
  assert.deepEqual([v1.status, v1.json.data.recorded], [200, true]);
  let after = await doc(s.id);
  assert.equal(after.status, "read");
  assert.equal(after.viewCount, 1);
  assert.ok(after.readAt && after.lastViewedAt);
  assert.equal(after.events.filter((e) => e.type === "viewed").length, 1);
  await view(tokenA);
  after = await doc(s.id);
  assert.equal(after.viewCount, 2, "every open is counted");
  assert.equal(after.events.filter((e) => e.type === "viewed").length, 1, "repeat opens within the hour add no history entry");
  for (const ua of ["WhatsApp/2.23.20.0 A", "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; Googlebot/2.1)", null]) {
    assert.equal((await view(tokenA, ua)).json.data.recorded, false, String(ua));
  }
  assert.equal((await doc(s.id)).viewCount, 2, "previews and bots are not counted");
  assert.equal((await view("x".repeat(43))).json.data.recorded, false, "unknown token");
  assert.equal((await view("not a token")).json.data.recorded, false, "malformed token");
  const historyA = (await api(cookie.a1, "GET", `/api/quotations/${qA}/deliveries`)).data;
  const rowA = historyA.find((d) => d.id === s.id);
  assert.equal(rowA.status, "read");
  assert.equal(rowA.link.viewCount, 2);
  assert.equal(rowA.link.url, s.link.url, "the sender can copy the same link again");
  const raw = JSON.stringify(historyA);
  assert.ok(!raw.includes("viewTokenHash") && !raw.includes("viewTokenSealed") && !raw.includes(sha(tokenA)), "no hash or sealed copy in the history");
  pass("the page's script reports a view: the delivery becomes Viewed with a view count; previews, bots and bad tokens are ignored");

  // ═══ 4. the link in emails ═══
  const mailed = await email(cookie.a1, qA2);
  assert.equal(mailed.status, 201, mailed.text.slice(0, 200));
  const lastEmail = emails.at(-1);
  const emailUrl = mailed.json.data.link.url;
  assert.ok(emailUrl && lastEmail.text.includes(`View it online: ${emailUrl}`) && lastEmail.html.includes("View Quotation Online") && lastEmail.html.includes(emailUrl));
  const tokenEmail = tokenOf(emailUrl);
  assert.notEqual(tokenEmail, tokenA, "every delivery has its own link");
  await view(tokenEmail);
  assert.equal((await doc(mailed.json.data.id)).status, "read", "opening the emailed link marks the email Viewed even without a mail-app read report");
  pass("emails carry their own secure link (text and button); opening it marks the email Viewed");

  // ═══ 5. switching a link off ═══
  assert.equal((await revoke(cookie.a2, qA, s.id)).status, 403, "another dealer cannot switch it off");
  assert.equal((await revoke(cookie.b, qA, s.id)).status, 404, "another company cannot find it");
  assert.equal((await revoke(null, qA, s.id)).status, 401);
  assert.equal((await revoke(cookie.a1, qA, s.id, "extend")).status, 400, "unknown action");
  assert.equal((await revoke(cookie.a1, qA, "qd_" + "0".repeat(32))).status, 404);
  assert.equal((await revoke(cookie.a1, qA, "bad-id")).status, 400);
  const revoked = await revoke(cookie.a1, qA, s.id);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
  assert.equal(revoked.json.data.link.state, "revoked");
  assert.equal(revoked.json.data.link.url, null);
  assert.equal(revoked.json.data.link.viewCount, 2, "past views are kept");
  assert.equal((await revoke(cookie.a1, qA, s.id)).status, 200, "switching off twice is harmless");
  assert.equal((await doc(s.id)).events.filter((e) => e.type === "link_revoked").length, 1);
  const revokedPage = await page(tokenA);
  assert.equal(revokedPage.status, 200);
  assert.ok(revokedPage.html.includes("This link has been switched off") && !revokedPage.html.includes(`Quotation ${numberA}`), "the quotation is no longer shown");
  assert.equal((await pdf(tokenA)).status, 410);
  assert.equal((await view(tokenA)).json.data.recorded, false);
  assert.equal((await doc(s.id)).viewCount, 2);
  pass("the sender can switch a link off: the page and PDF stop working at once, views stop counting, the history keeps what happened");

  // ═══ 6. expiry, bad links, damaged files ═══
  await db.collection("quotationdeliveries").updateOne({ _id: mailed.json.data.id }, { $set: { viewExpiresAt: new Date(Date.now() - 1000) } });
  assert.ok((await page(tokenEmail)).html.includes("This link has expired"));
  assert.equal((await pdf(tokenEmail)).status, 410);
  assert.equal((await view(tokenEmail)).json.data.recorded, false);
  const expiredRow = (await api(cookie.a1, "GET", `/api/quotations/${qA2}/deliveries`)).data.find((d) => d.id === mailed.json.data.id);
  assert.deepEqual([expiredRow.link.state, expiredRow.link.url], ["expired", null]);
  assert.ok((await page("x".repeat(43))).html.includes("This link is not valid"));
  assert.equal((await pdf("x".repeat(43))).status, 404);
  assert.equal((await pdf("short")).status, 404);
  const damaged = await share(cookie.a1, qA2);
  await db.collection("quotationdeliveryfiles").updateOne({ _id: damaged.json.data.id }, { $set: { data: Buffer.from("%PDF-1.7 tampered") } });
  assert.equal((await pdf(tokenOf(damaged.json.data.link.url))).status, 410, "a stored file that no longer matches is not served");
  pass("expired, unknown and malformed links show a friendly message and serve nothing; a damaged stored file is never served");

  // ═══ 7. company isolation on public links ═══
  const sharedB = await share(cookie.b, qB, { to: "+44 20 7946 0958" });
  assert.equal(sharedB.json.data.recipient, "442079460958");
  const tokenB = tokenOf(sharedB.json.data.link.url);
  const pageB = await page(tokenB);
  assert.ok(pageB.html.includes("Beta Builders") && !pageB.html.includes("Acme Homes"), "each link shows its own company");
  await view(tokenB);
  assert.equal((await doc(sharedB.json.data.id)).viewCount, 1);
  assert.equal((await doc(s.id)).viewCount, 2, "a view of B's link never touches A's delivery");
  pass("each link shows and updates only its own company's delivery");

  // ═══ 8. the delivery log ═══
  const log = async (c, query = "") => {
    const res = await fetch(`${baseUrl}/api/deliveries${query}`, { headers: { Cookie: c } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const all = await log(cookie.ownerA);
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const countA = await db.collection("quotationdeliveries").countDocuments({ companyId: 10 });
  assert.equal(all.json.data.pagination.total, countA);
  assert.equal(all.json.data.summary.total, countA);
  assert.ok(!all.json.data.data.some((row) => row.id === sharedB.json.data.id), "no other company's deliveries");
  assert.ok(all.json.data.data.every((row) => row.quotation && /^QT-/.test(row.quotation.quotationNumber)), "each row names its quotation");
  assert.equal(all.json.data.summary.viewed, await db.collection("quotationdeliveries").countDocuments({ companyId: 10, viewCount: { $gt: 0 } }));
  const whatsappOnly = await log(cookie.ownerA, "?channel=whatsapp");
  assert.ok(whatsappOnly.json.data.data.length > 0 && whatsappOnly.json.data.data.every((row) => row.channel === "whatsapp"));
  const readOnly = await log(cookie.ownerA, "?status=read");
  assert.ok(readOnly.json.data.data.length > 0 && readOnly.json.data.data.every((row) => row.status === "read"));
  const viewedOnly = await log(cookie.ownerA, "?viewed=1");
  assert.ok(viewedOnly.json.data.data.every((row) => row.link.viewCount > 0));
  const byNumber = await log(cookie.ownerA, `?search=${encodeURIComponent(numberA)}`);
  assert.ok(byNumber.json.data.data.length > 0 && byNumber.json.data.data.every((row) => row.quotation.quotationNumber === numberA));
  const byClient = await log(cookie.ownerA, "?search=meera");
  assert.ok(byClient.json.data.data.length > 0 && byClient.json.data.data.every((row) => row.quotation.clientName === "Meera Client"));
  const byRecipient = await log(cookie.ownerA, "?search=client%40example.com");
  assert.ok(byRecipient.json.data.data.length > 0 && byRecipient.json.data.data.every((row) => row.recipient === "client@example.com"));
  assert.equal((await log(cookie.ownerA, "?search=Beta")).json.data.data.length, 0, "searching never reaches another company");
  const paged = await log(cookie.ownerA, "?pageSize=2&page=2");
  assert.equal(paged.json.data.data.length, 2);
  assert.equal(paged.json.data.pagination.page, 2);
  assert.equal((await log(cookie.ownerA, "?status=lost")).status, 400);
  assert.equal((await log(cookie.ownerA, "?channel=sms")).status, 400);
  const logB = await log(cookie.ownerB);
  assert.deepEqual(logB.json.data.data.map((row) => row.id), [sharedB.json.data.id], "Company B sees only its own");
  assert.equal((await log(cookie.a1)).status, 403, "dealers do not see the company-wide log");
  const superLog = await log(cookie.super);
  assert.equal(superLog.status, 403);
  assert.equal(superLog.json.error.details?.reason, "COMPANY_CONTEXT_REQUIRED", "a Super Admin must choose a company first");
  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.super }, body: JSON.stringify({ companyId: 20, reason: "links test" }) });
  assert.equal(act.status, 200);
  const acting = [cookie.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  assert.deepEqual((await log(acting)).json.data.data.map((row) => row.id), [sharedB.json.data.id], "acting as Company B shows B's deliveries only");
  const anonymous = await fetch(`${baseUrl}/api/deliveries`);
  assert.equal(anonymous.status, 401);
  pass("the delivery log shows the company's sends with quotation, status and views; filters and search work; other companies, dealers and a company-less Super Admin see nothing");

  // ═══ 9. setup check ═══
  const setup = await fetch(`${baseUrl}/api/deliveries/setup`, { headers: { Cookie: cookie.ownerA } });
  assert.equal(setup.status, 200);
  const setupText = await setup.text();
  const setupData = JSON.parse(setupText).data;
  assert.equal(setupData.email.configured, true);
  assert.equal(setupData.webhook.configured, true);
  assert.equal(setupData.webhook.url, `${baseUrl}/api/webhooks/resend`);
  assert.equal(setupData.webhook.waitingOverAnHour, 0);
  assert.equal(setupData.links.publicAppUrl, false, "a plain-http local address is flagged: clients could not open it");
  assert.equal(setupData.links.canCopyAgain, true);
  assert.ok(!setupText.includes(WEBHOOK_SECRET) && !setupText.includes(RESEND_KEY) && !setupText.includes("no-reply@example.test"), "no secret or sender address is revealed");
  await db.collection("quotationdeliveries").updateOne({ _id: mailed.json.data.id }, { $set: { status: "sent", sentAt: new Date(Date.now() - 2 * 3600_000) } });
  assert.equal((await (await fetch(`${baseUrl}/api/deliveries/setup`, { headers: { Cookie: cookie.ownerA } })).json()).data.webhook.waitingOverAnHour, 1, "emails with no delivery report for over an hour are flagged");
  assert.equal((await fetch(`${baseUrl}/api/deliveries/setup`, { headers: { Cookie: cookie.a1 } })).status, 403);
  pass("the setup check reports email, delivery reports and link address status without revealing any secret");

  // ═══ 10. only the two public link routes bypass sign-in ═══
  assert.equal((await pdf(tokenB, "", "POST")).status, 401, "POST to the PDF needs a session");
  assert.equal((await fetch(`${baseUrl}/api/public/quotation-links/view`)).status, 401, "GET of the view report needs a session");
  assert.equal((await fetch(`${baseUrl}/api/public/quotation-links/${tokenB}`)).status, 401, "nothing else under the public prefix is open");
  pass("only GET of a link's PDF and POST of a view report are reachable without signing in");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-3000));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  fake?.close();
  process.exit(exitCode);
}
