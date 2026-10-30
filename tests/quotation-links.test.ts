/**
 * Secure quotation view links and WhatsApp sharing: token issue / hashing / sealing, link states, preview-bot
 * detection, view recording ("Viewed"), WhatsApp number normalisation and click-to-chat addresses, status labels,
 * and static guards on the public routes. The API is exercised in tests/quotation-links.test.mjs and the UI in
 * tests/quotation-links.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-links.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.NEXTAUTH_SECRET = "unit-test-secret-not-real";
process.env.NEXTAUTH_URL = "https://quotes.example.test";

import { deliveryDto, hashLinkToken, isLinkTokenShape, isPreviewBot, issueLink, LINK_TTL_DAYS, linkState, linkUrlFor, openToken, recordLinkView, sealToken } from "../src/lib/quotationLinks";
import { renderQuotationEmail, shareWhatsAppSchema } from "../src/lib/quotationDelivery";
import { defaultWhatsAppMessage, deliveryStatusLabel, normalizeWhatsAppNumber, whatsappShareUrl } from "../src/lib/quotationDeliveryShared";
import type { IQuotationDeliveryDocument } from "../src/models/QuotationDelivery";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

function fakeDelivery(status: IQuotationDeliveryDocument["status"], channel: "email" | "whatsapp" = "whatsapp"): IQuotationDeliveryDocument {
  return {
    channel,
    status,
    attempts: 1,
    sentAt: new Date("2026-10-30T09:00:00Z"),
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    lastError: null,
    events: [],
    viewCount: 0,
    lastViewedAt: null,
  } as unknown as IQuotationDeliveryDocument;
}

function main() {
  // ── tokens ──
  const now = new Date("2026-10-30T10:00:00Z");
  const link = issueLink(now);
  assert.ok(isLinkTokenShape(link.token), "the token is URL-safe and long");
  assert.equal(Buffer.from(link.token, "base64url").length, 32, "32 random bytes");
  assert.equal(link.tokenHash, createHash("sha256").update(link.token).digest("hex"));
  assert.equal(hashLinkToken(link.token), link.tokenHash);
  assert.equal(link.expiresAt.getTime() - now.getTime(), LINK_TTL_DAYS * 24 * 3600 * 1000, "expires after 90 days");
  assert.notEqual(issueLink(now).token, link.token, "every link is different");
  assert.ok(!link.sealed?.includes(link.token), "the sealed copy does not contain the token in clear");
  for (const bad of ["", "short", "x".repeat(70), `${"a".repeat(42)}/`, `${"a".repeat(42)}.`, 42, null]) assert.equal(isLinkTokenShape(bad), false, String(bad));
  pass("links are 32 random bytes (base64url), stored as a SHA-256 hash, expire after 90 days, and malformed tokens are refused early");

  // ── sealing ──
  assert.equal(openToken(link.sealed), link.token, "the sender's copy opens back to the same link");
  const [iv, tag, data] = (link.sealed as string).split(".");
  const flipped = Buffer.from(data, "base64url");
  flipped[0] ^= 1;
  assert.equal(openToken([iv, tag, flipped.toString("base64url")].join(".")), null, "tampered data does not open");
  assert.equal(openToken("not.a.seal"), null);
  assert.equal(openToken(null), null);
  process.env.NEXTAUTH_SECRET = "another-secret";
  assert.equal(openToken(link.sealed), null, "another server secret cannot open it");
  delete process.env.NEXTAUTH_SECRET;
  assert.equal(sealToken("abc"), null, "no secret: no sealed copy");
  assert.equal(openToken(link.sealed), null);
  process.env.NEXTAUTH_SECRET = "unit-test-secret-not-real";
  pass("the sealed copy (AES-256-GCM, key from the server secret) opens only with the same secret and untampered data");

  // ── states and URLs ──
  const future = new Date(Date.now() + 3600_000);
  const past = new Date(Date.now() - 1000);
  assert.equal(linkState({}), "none");
  assert.equal(linkState({ viewTokenHash: "h", viewExpiresAt: future }), "active");
  assert.equal(linkState({ viewTokenHash: "h", viewExpiresAt: past }), "expired");
  assert.equal(linkState({ viewTokenHash: "h", viewExpiresAt: null }), "expired", "no expiry recorded counts as expired");
  assert.equal(linkState({ viewTokenHash: "h", viewExpiresAt: future, viewRevokedAt: past }), "revoked");
  assert.equal(linkUrlFor({ viewTokenSealed: link.sealed }), `https://quotes.example.test/q/${link.token}`);
  assert.equal(linkUrlFor({ viewTokenSealed: link.sealed, viewRevokedAt: past }), null, "a switched-off link is never shown again");
  pass("a link is active, expired or switched off; its URL uses the public app address and disappears once switched off");

  // ── the DTO ──
  const base = { _id: "qd_1", recipient: "919876543210", subject: "Quotation Q1", attachmentName: "Q1.pdf", attachmentSize: 10, status: "sent" as const, attempts: 1, createdAt: now, channel: "whatsapp" };
  const active = deliveryDto({ ...base, viewTokenHash: link.tokenHash, viewTokenSealed: link.sealed, viewExpiresAt: future, viewCount: 2 });
  assert.equal(active.link.state, "active");
  assert.equal(active.link.url, `https://quotes.example.test/q/${link.token}`);
  assert.equal(active.link.viewCount, 2);
  assert.equal(active.canRetry, false, "a WhatsApp share is never retried");
  const json = JSON.stringify(active);
  assert.ok(!json.includes(link.tokenHash) && !json.includes(link.sealed as string), "neither the hash nor the sealed copy reaches the browser");
  assert.equal(deliveryDto({ ...base, viewTokenHash: link.tokenHash, viewTokenSealed: link.sealed, viewExpiresAt: past }).link.url, null, "no URL for an expired link");
  assert.equal(deliveryDto({ ...base, viewTokenHash: link.tokenHash, viewTokenSealed: link.sealed, viewExpiresAt: future, viewRevokedAt: past }).link.state, "revoked");
  assert.equal(deliveryDto(base).link.state, "none", "older deliveries without a link");
  pass("the browser gets the link state, view count and (only while active) the URL; never the hash or sealed copy");

  // ── preview bots ──
  for (const ua of [
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "undici",
    "",
    null,
  ]) {
    assert.equal(isPreviewBot(ua), true, String(ua));
  }
  for (const ua of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  ]) {
    assert.equal(isPreviewBot(ua), false, ua);
  }
  pass("link-preview fetchers, crawlers, scripts and headless browsers are not counted as the client viewing; real browsers are");

  // ── recording views ──
  const shared = fakeDelivery("sent");
  const first = new Date("2026-10-30T10:00:00Z");
  recordLinkView(shared, first);
  assert.equal(shared.status, "read");
  assert.equal(shared.viewCount, 1);
  assert.equal(shared.readAt?.getTime(), first.getTime());
  assert.equal(shared.deliveredAt?.getTime(), first.getTime(), "viewing implies it arrived");
  assert.deepEqual(shared.events.map((event) => event.type), ["viewed"]);
  recordLinkView(shared, new Date(first.getTime() + 10 * 60_000));
  assert.equal(shared.viewCount, 2);
  assert.equal(shared.readAt?.getTime(), first.getTime(), "first viewed time is kept");
  assert.equal(shared.events.length, 1, "repeat opens within the hour add no history entry");
  recordLinkView(shared, new Date(first.getTime() + 2 * 3600_000));
  assert.equal(shared.viewCount, 3);
  assert.equal(shared.events.length, 2);
  assert.match(shared.events[1].detail ?? "", /3 views/);
  assert.equal(shared.lastViewedAt?.getTime(), first.getTime() + 2 * 3600_000);
  const failed = fakeDelivery("failed", "email");
  recordLinkView(failed, first);
  assert.equal(failed.status, "failed", "a failed email stays failed (it still needs a retry)");
  assert.equal(failed.viewCount, 1);
  const delivered = fakeDelivery("delivered", "email");
  recordLinkView(delivered, first);
  assert.equal(delivered.status, "read");
  pass("opening the link marks the delivery Viewed, counts every open, keeps the first time, and adds at most one history entry an hour");

  // ── labels ──
  const dtoFor = (status: "sent" | "read" | "delivered", channel: "email" | "whatsapp", viewCount: number) =>
    ({ status, channel, link: { state: "active" as const, url: null, expiresAt: null, viewCount, lastViewedAt: null } });
  assert.equal(deliveryStatusLabel(dtoFor("sent", "whatsapp", 0)), "Shared");
  assert.equal(deliveryStatusLabel(dtoFor("read", "whatsapp", 1)), "Viewed");
  assert.equal(deliveryStatusLabel(dtoFor("read", "email", 1)), "Viewed");
  assert.equal(deliveryStatusLabel(dtoFor("read", "email", 0)), "Read", "an email opened in a mail app is Read");
  assert.equal(deliveryStatusLabel(dtoFor("sent", "email", 0)), "Sent");
  pass("status labels: WhatsApp shares show Shared, link opens show Viewed, mail-app opens show Read");

  // ── WhatsApp numbers and addresses ──
  for (const [input, expected] of [
    ["98765 43210", "919876543210"],
    ["+91 98765-43210", "919876543210"],
    ["09876543210", "919876543210"],
    ["(987) 654-3210", "919876543210"],
    ["+1 415 555 0100", "14155550100"],
    ["0044 20 7946 0958", "442079460958"],
    ["971501234567", "971501234567"],
  ] as const) {
    assert.equal(normalizeWhatsAppNumber(input), expected, input);
  }
  for (const bad of ["", "12345", "abc", "+0 123 456 789", "1".repeat(16)]) assert.equal(normalizeWhatsAppNumber(bad), null, bad);
  const url = whatsappShareUrl("919876543210", "Dear Ravi & Co,\nquote #1 ✓");
  assert.equal(url, `https://wa.me/919876543210?text=${encodeURIComponent("Dear Ravi & Co,\nquote #1 ✓")}`);
  assert.ok(!url.includes(" ") && !url.includes("\n") && !/[&]quote/.test(url), "the message is fully encoded");
  assert.equal(defaultWhatsAppMessage({ clientName: "Ravi", quotationNumber: "QT-1", companyName: "Acme" }), "Dear Ravi, please find quotation QT-1 from Acme.");
  assert.deepEqual(shareWhatsAppSchema.parse({ to: " 98765 43210 ", message: "  " }), { to: "919876543210", message: null });
  for (const bad of [{ to: "12" }, { to: "" }, { to: "9876543210", message: "x".repeat(1501) }, { to: "9876543210", message: "bad\u0007" }, { to: "9876543210", companyId: 2 }]) {
    assert.equal(shareWhatsAppSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
  pass("WhatsApp numbers: 10-digit Indian mobiles get +91, others need a country code; the click-to-chat message is fully encoded; input is validated");

  // ── email carries the link ──
  const email = renderQuotationEmail({ companyName: "Acme", quotationNumber: "Q1", clientName: "Ravi", senderName: null, message: null, viewUrl: `https://quotes.example.test/q/${link.token}"><script>` });
  assert.ok(email.text.includes(`View it online: https://quotes.example.test/q/${link.token}`));
  assert.ok(email.html.includes("View Quotation Online") && !email.html.includes('"><script>'), "the link is escaped in the HTML");
  assert.ok(!renderQuotationEmail({ companyName: "Acme", quotationNumber: "Q1", clientName: "Ravi", senderName: null, message: null }).html.includes("View Quotation Online"), "no button without a link");
  pass("emails include the secure view link (escaped) as text and as a button");

  // ── static guards ──
  const links = read("src", "lib", "quotationLinks.ts");
  assert.ok(/runUnscoped\("public-quotation-link"/.test(links) && /findOne\(\{ viewTokenHash: tokenHash \}\)/.test(links), "public lookups are an exact hash match, logged as unscoped");
  assert.ok(/runWithTenantContext\(\{ companyId: target\.companyId, userId: 0/.test(links), "further reads run inside the link's company");
  const pdfRoute = read("src", "app", "api", "public", "quotation-links", "[token]", "pdf", "route.ts");
  assert.ok(/target\.state !== "active"/.test(pdfRoute) && /checkRateLimit\(/.test(pdfRoute) && /noindex/.test(pdfRoute) && /sha256Hex\(result\.data\) !== result\.sha/.test(pdfRoute), "the PDF route needs an active link, is rate limited, not indexed, and checks the stored file");
  const viewRoute = read("src", "app", "api", "public", "quotation-links", "view", "route.ts");
  assert.ok(/isPreviewBot\(/.test(viewRoute) && /checkRateLimit\(/.test(viewRoute) && /target\.state !== "active"/.test(viewRoute), "views ignore bots, are rate limited and need an active link");
  const page = read("src", "app", "q", "[token]", "page.tsx");
  assert.ok(/index: false/.test(page) && /referrer: "no-referrer"/.test(page), "the view page is not indexed and never leaks its address");
  const proxy = read("src", "proxy.ts");
  assert.ok(/"\/offline\.html", "\/q"\]/.test(proxy), "/q pages are public");
  assert.ok(/PUBLIC_QUOTATION_LINK_PDF\.test\(pathname\) && \(request\.method === "GET" \|\| request\.method === "HEAD"\)/.test(proxy) && /pathname === PUBLIC_QUOTATION_LINK_VIEW_API && request\.method === "POST"/.test(proxy), "only GET of a PDF and POST of a view bypass sign-in");
  const revoke = read("src", "app", "api", "quotations", "[id]", "deliveries", "[deliveryId]", "link", "route.ts");
  assert.ok(/withSession/.test(revoke) && /canModifyQuotation\(/.test(revoke), "switching a link off needs permission to modify the quotation");
  const log = read("src", "app", "api", "deliveries", "route.ts");
  assert.ok(/withPermission\("quotations:read_all"/.test(log) && /requireActiveCompany\(/.test(log), "the delivery log is company-wide and needs read-all permission");
  pass("static guards: hashed lookup inside the link's company, narrow public routes, bots ignored, rate limits, no indexing, permission checks");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
