/**
 * Quotation delivery tracking: webhook signature verification, provider event mapping and the forward-only status
 * rules, safe error messages, input validation, email rendering, and static guards on the routes. The API is
 * exercised end to end in tests/quotation-delivery.test.mjs and the UI in tests/quotation-delivery.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-delivery.test.ts
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyProviderEvent,
  deliveryErrorFor,
  isPdf,
  providerEventKind,
  pushDeliveryEvent,
  renderQuotationEmail,
  sendDeliverySchema,
  verifyWebhookSignature,
} from "../src/lib/quotationDelivery";
import { toDeliveryDto } from "../src/lib/quotationDeliveryShared";
import type { IQuotationDeliveryDocument } from "../src/models/QuotationDelivery";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const secretBytes = randomBytes(24);
const SECRET = `whsec_${secretBytes.toString("base64")}`;
const sign = (id: string, ts: number, body: string, key = secretBytes) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

/** A plain object with the delivery fields the pure functions touch. */
function fakeDelivery(status: IQuotationDeliveryDocument["status"]): IQuotationDeliveryDocument {
  const delivery = {
    status,
    attempts: 1,
    sentAt: new Date(),
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    lastError: null,
    providerMessageId: "email_1",
    events: [],
    processedEventIds: [],
  };
  return delivery as unknown as IQuotationDeliveryDocument;
}

function main() {
  // ── signatures ──
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email_1" } });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body, now), true);
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now), signature: `v1,bogus ${sign("msg_1", now, body)}` }, body, now), true, "any listed v1 signature may match");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body, randomBytes(24)) }, body, now), false, "wrong secret");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body.replace("delivered", "opened"), now), false, "tampered body");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_2", timestamp: String(now), signature: sign("msg_1", now, body) }, body, now), false, "different id");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now - 600), signature: sign("msg_1", now - 600, body) }, body, now), false, "older than 5 minutes");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now + 600), signature: sign("msg_1", now + 600, body) }, body, now), false, "too far in the future");
  assert.equal(verifyWebhookSignature(SECRET, { id: null, timestamp: String(now), signature: sign("msg_1", now, body) }, body, now), false, "missing id");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: "abc", signature: sign("msg_1", now, body) }, body, now), false, "bad timestamp");
  assert.equal(verifyWebhookSignature("", { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body, now), false, "no secret configured");
  assert.equal(verifyWebhookSignature(SECRET, { id: "msg_1", timestamp: String(now), signature: "v0,abc" }, body, now), false, "unknown version");
  pass("webhook signatures: only a fresh, untampered notification signed with the configured secret is accepted");

  // ── event mapping ──
  assert.equal(providerEventKind("email.delivered"), "delivered");
  assert.equal(providerEventKind("email.opened"), "opened");
  assert.equal(providerEventKind("email.bounced"), "bounced");
  assert.equal(providerEventKind("email.failed"), "bounced");
  assert.equal(providerEventKind("email.complained"), "complained");
  assert.equal(providerEventKind("email.delivery_delayed"), "delayed");
  assert.equal(providerEventKind("email.clicked"), null);
  assert.equal(providerEventKind(42), null);
  pass("provider notification types map to delivered / read / failed / complained / delayed; others are ignored");

  // ── forward-only status ──
  const at = new Date("2026-10-28T10:00:00Z");
  let d = fakeDelivery("sent");
  assert.equal(applyProviderEvent(d, "e1", "delivered", at), true);
  assert.equal(d.status, "delivered");
  assert.equal(applyProviderEvent(d, "e1", "delivered", at), false, "the same notification twice is applied once");
  assert.equal(d.events.length, 1);
  applyProviderEvent(d, "e2", "opened", at);
  assert.equal(d.status, "read");
  assert.ok(d.readAt);
  applyProviderEvent(d, "e3", "delivered", at);
  assert.equal(d.status, "read", "a late 'delivered' never undoes 'read'");
  applyProviderEvent(d, "e4", "bounced", at);
  assert.equal(d.status, "read", "a bounce after delivery is recorded but does not mark it failed");
  assert.equal(d.events.at(-1)?.type, "failed");
  d = fakeDelivery("sent");
  applyProviderEvent(d, "e5", "opened", at);
  assert.equal(d.status, "read");
  assert.ok(d.deliveredAt, "opened implies delivered");
  d = fakeDelivery("sent");
  applyProviderEvent(d, "e6", "bounced", at);
  assert.equal(d.status, "failed");
  assert.equal(d.lastError?.code, "BOUNCED");
  applyProviderEvent(d, "e7", "delivered", at);
  assert.equal(d.status, "failed", "a failed delivery is only revived by a retry, not by a stray notification");
  d = fakeDelivery("sent");
  applyProviderEvent(d, "e8", "complained", at);
  applyProviderEvent(d, "e9", "delayed", at);
  assert.equal(d.status, "sent");
  assert.deepEqual(d.events.map((e) => e.type), ["complained", "delayed"]);
  d = fakeDelivery("sent");
  for (let i = 0; i < 100; i++) pushDeliveryEvent(d, "delayed", `#${i}`, at);
  assert.equal(d.events.length, 60, "history is capped");
  assert.equal(d.events.at(-1)?.detail, "#99", "keeping the newest events");
  pass("statuses only move forward (sent → delivered → read), bounces fail undelivered mail, duplicates are ignored, history is capped");

  // ── errors are safe ──
  assert.equal(deliveryErrorFor("EMAIL_NOT_CONFIGURED").code, "EMAIL_NOT_CONFIGURED");
  assert.equal(deliveryErrorFor("NETWORK_ERROR").code, "NETWORK_ERROR");
  assert.equal(deliveryErrorFor("PROVIDER_ERROR_503").code, "PROVIDER_UNAVAILABLE");
  assert.equal(deliveryErrorFor("PROVIDER_ERROR_429").code, "PROVIDER_RATE_LIMITED");
  assert.equal(deliveryErrorFor("PROVIDER_ERROR_422").code, "PROVIDER_REJECTED");
  assert.equal(deliveryErrorFor(undefined).code, "PROVIDER_REJECTED");
  pass("send failures map to safe, actionable messages (never the provider's raw text)");

  // ── input ──
  assert.deepEqual(sendDeliverySchema.parse({ to: " Client@Example.com ", subject: " Quote ", message: "" }), { to: "client@example.com", subject: "Quote", message: null });
  for (const bad of [
    { to: "not-an-email", subject: "x" },
    { to: "a@b.co", subject: "" },
    { to: "a@b.co", subject: "line\nbreak" },
    { to: "a@b.co", subject: "x".repeat(201) },
    { to: "a@b.co", subject: "x", message: "y".repeat(2001) },
    { to: "a@b.co", subject: "x", companyId: 2 },
  ]) {
    assert.equal(sendDeliverySchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(isPdf(Buffer.from("%PDF-1.7\n...")), true);
  assert.equal(isPdf(Buffer.from("<html>")), false);
  assert.equal(isPdf(Buffer.from("%PDF")), false);
  pass("recipient, subject and message are validated; only real PDF bytes are accepted");

  // ── email content ──
  const email = renderQuotationEmail({ companyName: "Acme <Homes>", quotationNumber: "QT-2026-001", clientName: "Ravi & Co", senderName: "Dealer A", message: "Hello <script>alert(1)</script>\n\nSecond paragraph" });
  assert.ok(email.html.includes("&lt;script&gt;") && !email.html.includes("<script>"), "the message is escaped");
  assert.ok(email.html.includes("Acme &lt;Homes&gt;") && email.html.includes("Ravi &amp; Co"));
  assert.ok(email.text.includes("QT-2026-001") && email.text.includes("Dear Ravi & Co,"));
  assert.ok(renderQuotationEmail({ companyName: "Acme", quotationNumber: "Q1", clientName: "C", senderName: null, message: null }).text.includes("Please find attached quotation Q1 from Acme."), "a default message when none is written");
  pass("the email is escaped, names the quotation and company, and has a default message");

  // ── DTO never exposes internals ──
  const dto = toDeliveryDto({ _id: "qd_1", recipient: "a@b.co", subject: "s", attachmentName: "Q.pdf", attachmentSize: 10, status: "failed", attempts: 5, createdAt: at, events: [] }, 5);
  assert.equal(dto.canRetry, false, "no retry once all attempts are used");
  assert.ok(!("processedEventIds" in dto) && !("data" in dto) && !("companyId" in dto));
  assert.equal(toDeliveryDto({ _id: "qd_2", recipient: "a@b.co", subject: "s", attachmentName: "Q.pdf", attachmentSize: 10, status: "failed", attempts: 2, createdAt: at }, 5).canRetry, true);
  pass("the browser sees no PDF bytes, company id or internal ids; retry is offered only while attempts remain");

  // ── static guards ──
  const send = read("src", "app", "api", "quotations", "[id]", "deliveries", "route.ts");
  assert.ok(/withSession/.test(send) && /canModifyQuotation\(/.test(send) && /canViewQuotation\(/.test(send) && /checkRateLimit\(/.test(send), "send/list check access and rate-limit");
  assert.ok(!/formData\.get\("companyId"\)|attachmentName: file\.name/.test(send), "no company id or file name is taken from the request");
  const retryRoute = read("src", "app", "api", "quotations", "[id]", "deliveries", "[deliveryId]", "retry", "route.ts");
  assert.ok(/status: "failed", attempts: \{ \$lt: DELIVERY_MAX_ATTEMPTS \}/.test(retryRoute), "retries are claimed atomically");
  const webhook = read("src", "app", "api", "webhooks", "resend", "route.ts");
  assert.ok(/verifyWebhookSignature\(/.test(webhook) && /runUnscoped\("provider-webhook"/.test(webhook) && /runWithTenantContext\(\{ companyId: owner\.companyId/.test(webhook), "the webhook is signature-checked and updates inside the delivery's own company");
  const proxy = read("src", "proxy.ts");
  assert.ok(/PUBLIC_WEBHOOK_APIS: ReadonlySet<string> = new Set\(\["\/api\/webhooks\/resend"\]\)/.test(proxy) && /PUBLIC_WEBHOOK_APIS\.has\(pathname\)\) && request\.method === "POST"/.test(proxy), "only POST to the webhook bypasses sign-in");
  pass("static guards: access checks, rate limit, atomic retry, signed webhook scoped to the delivery's company, narrow public route");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
