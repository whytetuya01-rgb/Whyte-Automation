/**
 * Quotation delivery tracking through the real API (production-mode server + throwaway local MongoDB; the email
 * provider is a local fake): sending a quotation PDF by email, validation, failures and retries, provider
 * notifications (delivered / read / bounced) through the signed webhook, history, rate limiting, and isolation
 * between companies, dealers, a Super Admin on the platform and acting as a company.
 *
 *   node tests/quotation-delivery.test.mjs
 */
import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let fake;
let exitCode = 0;

// ── fake email provider ──
const emails = [];
let mode = "ok"; // ok | http500 | http422
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/emails") { res.statusCode = 404; res.end("{}"); return; }
      if (mode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ message: "boom internal provider detail" })); return; }
      if (mode === "http422") { res.statusCode = 422; res.end(JSON.stringify({ message: "invalid to" })); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      emails.push(body);
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const secretBytes = randomBytes(24);
const WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(4000), Buffer.from("\n%%EOF")]);

try {
  fake = await startFake();
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "Quotations <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
    RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    QUOTATION_DELIVERY_RATE_LIMIT_MAX: "40",
    SESSION_ACTOR_CACHE_TTL_MS: "0",
  });
  server = await startIsolatedServer("delivery", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "dealer.a1@example.com", role: "dealer", name: "Dealer A1", discountAllocationPercent: 10, companyId: 10 },
    { _id: 3, email: "dealer.a2@example.com", role: "dealer", name: "Dealer A2", discountAllocationPercent: 10, companyId: 10 },
    { _id: 4, email: "owner.a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 5, email: "dealer.b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 10, companyId: 20 },
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
    owner: await login("owner.a@example.com", "admin"),
    b: await login("dealer.b@example.com", "user"),
  };
  const makeQuotation = async (c, base, name, withItem = true) => {
    const created = await api(c, "POST", "/api/quotations", { clientName: name, houseTypeId: base + 1 });
    assert.equal(created.status, 201, created.text?.slice(0, 160));
    const id = created.data.id ?? created.data._id;
    if (withItem) {
      const room = (await api(c, "GET", `/api/quotations/${id}`)).data.rooms[0];
      assert.equal((await api(c, "POST", `/api/quotations/${id}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 2 })).status, 201);
    }
    return id;
  };
  const qA = await makeQuotation(cookie.a1, 100, "Ravi Client");
  const qA2 = await makeQuotation(cookie.a1, 100, "Second Client");
  const qEmpty = await makeQuotation(cookie.a1, 100, "Empty Client", false);
  const qB = await makeQuotation(cookie.b, 200, "Beta Client");

  const send = async (c, qid, fields = {}, pdf = PDF) => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ to: "client@example.com", subject: "Your quotation", ...fields })) if (v !== undefined) body.append(k, v);
    if (pdf) body.append("pdf", new Blob([pdf], { type: "application/pdf" }), "anything.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries`, { method: "POST", headers: c ? { Cookie: c } : {}, body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json, text };
  };
  const retry = async (c, qid, did) => {
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries/${did}/retry`, { method: "POST", headers: { Cookie: c } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const history = async (c, qid) => {
    const res = await fetch(`${baseUrl}/api/quotations/${qid}/deliveries`, { headers: c ? { Cookie: c } : {} });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const webhook = async (type, emailId, { id = `msg_${randomBytes(6).toString("hex")}`, ts = Math.floor(Date.now() / 1000), key = secretBytes, body } = {}) => {
    const payload = body ?? JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId } });
    const signature = `v1,${createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64")}`;
    const res = await fetch(`${baseUrl}/api/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": signature }, body: payload });
    return { status: res.status, json: await res.json().catch(() => null), id };
  };
  const deliveryDoc = (id) => db.collection("quotationdeliveries").findOne({ _id: id });
  const quotationDoc = (id) => db.collection("quotations").findOne({ _id: id });

  // ═══ 1. send ═══
  assert.equal((await quotationDoc(qA)).status, "draft");
  const sent = await send(cookie.a1, qA, { to: " Client@Example.com ", subject: "Quotation from Acme", message: "Hello <b>Ravi</b>\n\nThanks!", companyId: "20" });
  assert.equal(sent.status, 201, sent.text.slice(0, 200));
  assert.equal(sent.json.data.status, "sent");
  assert.equal(sent.json.data.recipient, "client@example.com");
  assert.equal(sent.json.data.attempts, 1);
  const email = emails.at(-1);
  assert.equal(email.to, "client@example.com");
  assert.equal(email.subject, "Quotation from Acme");
  assert.equal(email.reply_to, "dealer.a1@example.com", "replies go to the dealer who sent it");
  assert.equal(email.attachments.length, 1);
  assert.match(email.attachments[0].filename, /^QT-\d{4}-\d{3}\.pdf$/, "the attachment is named after the quotation, not the uploaded file");
  assert.ok(Buffer.from(email.attachments[0].content, "base64").equals(PDF), "the exact PDF is attached");
  assert.ok(email.html.includes("Hello &lt;b&gt;Ravi&lt;/b&gt;") && email.html.includes("Acme Homes"), "the message is escaped and the company is named");
  const stored = await deliveryDoc(sent.json.data.id);
  assert.equal(stored.companyId, 10, "stored under the sender's company, whatever the request said");
  assert.equal(stored.providerMessageId, "email_1");
  assert.equal(stored.attachmentSha256, createHash("sha256").update(PDF).digest("hex"));
  const file = await db.collection("quotationdeliveryfiles").findOne({ _id: sent.json.data.id });
  assert.ok(file && file.companyId === 10 && Buffer.from(file.data.buffer).equals(PDF), "the PDF is stored for retries");
  const qAfter = await quotationDoc(qA);
  assert.equal(qAfter.status, "sent", "the first accepted send moves a draft to sent");
  assert.equal(qAfter.sentBy, 2);
  assert.equal(await db.collection("quotationauditevents").countDocuments({ quotationId: qA, action: "status_changed", "metadata.via": "email" }), 1);
  pass("a dealer emails the quotation PDF: the provider gets the exact PDF, escaped message and reply-to; the delivery and PDF are stored under the dealer's company; the draft becomes sent");

  // ═══ 2. validation ═══
  const emailsBefore = emails.length;
  for (const [label, fields, pdf, field] of [
    ["bad email", { to: "nope" }, PDF, "to"],
    ["empty subject", { subject: "" }, PDF, "subject"],
    ["subject with a line break", { subject: "a\nBcc: x@y.z" }, PDF, "subject"],
    ["long message", { message: "x".repeat(2001) }, PDF, "message"],
    ["missing PDF", {}, null, "pdf"],
    ["not a PDF", {}, Buffer.from("<html>not a pdf</html>"), "pdf"],
    ["PDF over 8MB", {}, Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(8 * 1024 * 1024)]), "pdf"],
  ]) {
    const res = await send(cookie.a1, qA, fields, pdf);
    assert.ok(res.status >= 400 && res.status < 500, `${label}: ${res.status}`);
    assert.equal(res.json?.error?.field, field, `${label}: ${JSON.stringify(res.json?.error)}`);
  }
  assert.equal((await send(cookie.a1, qEmpty)).status, 409, "an empty quotation cannot be sent");
  assert.equal(emails.length, emailsBefore, "nothing was emailed for any rejected request");
  pass("bad addresses, header-injection subjects, oversize messages, missing / fake / oversized PDFs and empty quotations are rejected before anything is emailed");

  // ═══ 3. failure and retry ═══
  mode = "http500";
  const failed = await send(cookie.a1, qA2);
  mode = "ok";
  assert.equal(failed.status, 201);
  assert.equal(failed.json.data.status, "failed");
  assert.equal(failed.json.data.lastError.code, "PROVIDER_UNAVAILABLE");
  assert.ok(!JSON.stringify(failed.json).includes("boom"), "the provider's raw error never reaches the browser");
  assert.equal(failed.json.data.canRetry, true);
  assert.equal((await quotationDoc(qA2)).status, "draft", "a failed send does not mark the quotation sent");
  const retried = await retry(cookie.a1, qA2, failed.json.data.id);
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  assert.equal(retried.json.data.status, "sent");
  assert.equal(retried.json.data.attempts, 2);
  assert.ok(Buffer.from(emails.at(-1).attachments[0].content, "base64").equals(PDF), "the retry sends the identical stored PDF");
  assert.equal((await quotationDoc(qA2)).status, "sent");
  assert.deepEqual(retried.json.data.events.map((e) => e.type), ["queued", "failed", "retried", "sent"]);
  assert.equal((await retry(cookie.a1, qA2, failed.json.data.id)).status, 409, "a sent delivery cannot be retried");
  pass("a provider failure is recorded with a safe message; Retry re-sends the identical stored PDF and the full history is kept");

  mode = "http422";
  const rejected = await send(cookie.a1, qA2);
  assert.equal(rejected.json.data.lastError.code, "PROVIDER_REJECTED");
  mode = "ok";
  const before2 = emails.length;
  const [r1, r2] = await Promise.all([retry(cookie.a1, qA2, rejected.json.data.id), retry(cookie.a1, qA2, rejected.json.data.id)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409], "two simultaneous retries: exactly one runs");
  assert.equal(emails.length, before2 + 1, "and exactly one email goes out");
  pass("simultaneous retries are claimed atomically: one email, never two");

  mode = "http500";
  const stubborn = await send(cookie.a1, qA2);
  let last = stubborn.json.data;
  while (last.canRetry) last = (await retry(cookie.a1, qA2, last.id)).json.data;
  mode = "ok";
  assert.equal(last.attempts, 5);
  assert.equal(last.canRetry, false);
  assert.equal((await retry(cookie.a1, qA2, last.id)).status, 409, "no sixth attempt");
  assert.equal((await retry(cookie.a1, qA2, "qd_" + "0".repeat(32))).status, 404, "unknown delivery");
  assert.equal((await retry(cookie.a1, qA2, "not-a-delivery-id")).status, 400, "malformed delivery id");
  pass("retries stop after 5 attempts; unknown and malformed delivery ids are refused");

  // ═══ 4. provider notifications ═══
  const did = sent.json.data.id;
  const delivered = await webhook("email.delivered", "email_1");
  assert.equal(delivered.status, 200);
  assert.equal((await deliveryDoc(did)).status, "delivered");
  const opened = await webhook("email.opened", "email_1");
  assert.equal((await deliveryDoc(did)).status, "read");
  const eventsNow = (await deliveryDoc(did)).events.length;
  const replay = await webhook("email.opened", "email_1", { id: opened.id });
  assert.equal(replay.json.data.applied, false, "a replayed notification is ignored");
  assert.equal((await deliveryDoc(did)).events.length, eventsNow);
  await webhook("email.bounced", "email_1");
  assert.equal((await deliveryDoc(did)).status, "read", "a bounce after it was read does not mark it failed");
  pass("signed notifications move a delivery to delivered and read; replays are ignored; status never moves backwards");

  const toBounce = await send(cookie.a1, qA, { to: "typo@example.com" });
  await webhook("email.bounced", `email_${emails.length}`);
  const bounced = await deliveryDoc(toBounce.json.data.id);
  assert.equal(bounced.status, "failed");
  assert.equal(bounced.lastError.code, "BOUNCED");
  assert.equal((await history(cookie.a1, qA)).json.data.find((d) => d.id === toBounce.json.data.id).canRetry, true, "a bounced delivery can be retried");
  pass("a bounce on an undelivered message marks it failed (retryable)");

  const unsigned = await fetch(`${baseUrl}/api/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "email.opened", data: { email_id: "email_2" } }) });
  assert.equal(unsigned.status, 401);
  assert.equal((await webhook("email.delivered", "email_2", { key: randomBytes(24) })).status, 401, "wrong secret");
  assert.equal((await webhook("email.delivered", "email_2", { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, "stale timestamp");
  assert.equal((await webhook("email.delivered", "email_does_not_exist")).json.data.ignored, true, "unknown message: acknowledged, nothing changed");
  assert.equal((await webhook("email.clicked", "email_2")).json.data.ignored, true, "unknown event type: ignored");
  assert.equal((await webhook(null, null, { body: "not json" })).status, 400);
  pass("unsigned, wrongly signed and stale notifications are refused; unknown messages and types are ignored");

  // ═══ 5. history and isolation ═══
  const listA = await history(cookie.a1, qA);
  assert.equal(listA.status, 200);
  assert.ok(listA.json.data.length >= 2);
  assert.ok(new Date(listA.json.data[0].createdAt) >= new Date(listA.json.data.at(-1).createdAt), "newest first");
  const raw = JSON.stringify(listA.json);
  assert.ok(!raw.includes("processedEventIds") && !raw.includes('"data":{"type":"Buffer"') && !raw.includes("companyId"), "no internals or PDF bytes in the history");
  assert.equal((await history(cookie.owner, qA)).status, 200, "the company owner sees the history");
  assert.equal((await send(cookie.owner, qA)).status, 201, "and may send");
  assert.equal((await history(cookie.a2, qA)).status, 403, "another dealer of the same company cannot see it");
  assert.equal((await send(cookie.a2, qA)).status, 403, "or send it");
  assert.equal((await retry(cookie.a2, qA2, failed.json.data.id)).status, 403, "or retry it");
  assert.equal((await history(cookie.b, qA)).status, 404, "Company B cannot even find Company A's quotation");
  assert.equal((await send(cookie.b, qA)).status, 404);
  assert.equal((await history(cookie.super, qA)).status, 404, "a Super Admin on the platform sees no company's deliveries");
  assert.equal((await history(null, qA)).status, 401);
  assert.equal((await send(null, qA)).status, 401);
  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.super }, body: JSON.stringify({ companyId: 10, reason: "delivery test" }) });
  assert.equal(act.status, 200);
  const acting = [cookie.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  assert.equal((await history(acting, qA)).status, 200, "acting as Company A shows A's history");
  assert.equal((await history(acting, qB)).status, 404, "but not B's");
  pass("history is shown only to people who may see the quotation; other dealers, other companies, a company-less Super Admin and anonymous users get nothing");

  // B's delivery is untouched by A's notifications, and vice versa
  const sentB = await send(cookie.b, qB);
  assert.equal(sentB.status, 201);
  const bId = `email_${emails.length}`;
  await webhook("email.delivered", "email_1");
  assert.equal((await deliveryDoc(sentB.json.data.id)).status, "sent", "a notification for A's message never touches B's delivery");
  await webhook("email.delivered", bId);
  assert.equal((await deliveryDoc(sentB.json.data.id)).status, "delivered");
  assert.equal((await deliveryDoc(sentB.json.data.id)).companyId, 20);
  pass("each provider notification updates only the delivery its message id belongs to");

  // ═══ 6. rate limit ═══
  let limited = null;
  for (let i = 0; i < 45 && !limited; i++) {
    const res = await send(cookie.b, qB);
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, "sending is rate limited per user");
  assert.equal((await send(cookie.a1, qA)).status, 201, "other users are not affected");
  pass("sending is rate limited per user");

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
