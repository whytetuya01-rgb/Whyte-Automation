/**
 * Renders the super-admin "new dealer registered" credential notice email
 * with realistic data and asserts the required content/safety rules.
 *
 *   node scripts/run-script.js scripts/verify-dealer-registration-admin-notice-email.ts
 */
import assert from "node:assert/strict";
import { renderDealerRegistrationAdminNoticeEmail } from "../src/lib/email/templates/dealer-registration-admin-notice";

const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`  ok - ${name}`); };

const full = renderDealerRegistrationAdminNoticeEmail({
  dealerId: "42",
  dealerName: "Bhavik Shah",
  username: "bhavik@example.com",
  password: "Sup3rSecret!",
  contactNumber: "+91 98765 11223",
  registrationDate: "8 October 2026",
  adminPanelUrl: "https://whyte-automation-sandy.vercel.app/admin/dealers",
});

assert.match(full.html, /WHYTE<span/, "wordmark markup must be present");
assert.match(full.html, /New Dealer Registered/i);
assert.match(full.html, /Bhavik Shah/);
assert.match(full.html, />42</);
assert.match(full.html, /8 October 2026/);
assert.match(full.html, /bhavik@example\.com/);
assert.match(full.html, /\+91 98765 11223/);
assert.match(full.html, /Sup3rSecret!/, "password must actually be present (intentional, admin-only email)");
assert.match(full.html, /Open Admin Panel/i);
assert.match(full.html, /https:\/\/whyte-automation-sandy\.vercel\.app\/admin\/dealers/);
assert.match(full.html, /plaintext password/i, "must carry a handling warning");
assert.doesNotMatch(full.html, /\bundefined\b/i);
assert.doesNotMatch(full.html, /\bnull\b/i);
assert.doesNotMatch(full.html, /\bN\/A\b/);
pass("full data: dealer credentials, logo wordmark, security note all present");

const noPhone = renderDealerRegistrationAdminNoticeEmail({
  dealerId: "43",
  dealerName: "Asha Patel",
  username: "asha@example.com",
  password: "AnotherPass1",
  contactNumber: null,
  registrationDate: "8 October 2026",
  adminPanelUrl: "https://whyte-automation-sandy.vercel.app/admin/dealers",
});
assert.doesNotMatch(noPhone.html, /Phone/);
assert.doesNotMatch(noPhone.html, /\bnull\b/i);
pass("missing phone: field omitted entirely, no placeholder");

console.log(`\nAdmin notice email template verification PASSED (${results.length} checks).`);
