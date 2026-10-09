/**
 * Renders the dealer registration success email template with realistic
 * data (no live send) and asserts the required content/safety rules.
 *
 *   node scripts/run-script.js scripts/verify-dealer-registration-email.ts
 */
import assert from "node:assert/strict";
import { renderDealerRegistrationSuccessEmail } from "../src/lib/email/templates/dealer-registration-success";

const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`  ok - ${name}`); };

const full = renderDealerRegistrationSuccessEmail({
  firstName: "Bhavik",
  dealerName: "Bhavik Shah",
  dealerId: "42",
  email: "bhavik@example.com",
  phone: "+91 98765 11223",
  companyName: null,
  registrationDate: "8 October 2026",
  loginUrl: "https://whyte-automation-sandy.vercel.app/login",
  supportEmail: "support@whyte.co.in",
});

assert.match(full.html, /WHYTE<span/, "wordmark markup must be present");
assert.match(full.html, /Registration Confirmed/i);
assert.match(full.html, /Welcome to the <em[^>]*>art<\/em><br>of intelligent living/);
assert.match(full.html, /Bhavik Shah/);
assert.match(full.html, />42</);
assert.match(full.html, /8 October 2026/);
assert.match(full.html, /bhavik@example\.com/);
assert.match(full.html, /\+91 98765 11223/);
assert.match(full.html, /ENTER WHYTE AUTOMATION/i);
assert.match(full.html, /https:\/\/whyte-automation-sandy\.vercel\.app\/login/);
assert.match(full.html, /whyte\.co\.in/);
assert.match(full.html, /If you did not create this account/);
assert.match(full.html, /&copy; 2026 WHYTE/);
assert.doesNotMatch(full.html, /\bundefined\b/i);
assert.doesNotMatch(full.html, /\bnull\b/i);
assert.doesNotMatch(full.html, /\bN\/A\b/);
assert.doesNotMatch(full.html, /Unknown/);
assert.doesNotMatch(full.html, /Company/);
assert.doesNotMatch(full.html, /passwordHash|password|JWT|session.?token/i);
pass("full data: all required content present, no placeholders, no sensitive fields");

const noPhone = renderDealerRegistrationSuccessEmail({
  firstName: "Asha",
  dealerName: "Asha Patel",
  dealerId: "43",
  email: "asha@example.com",
  phone: null,
  companyName: null,
  registrationDate: "8 October 2026",
  loginUrl: "https://whyte-automation-sandy.vercel.app/login",
  supportEmail: "support@whyte.co.in",
});
assert.doesNotMatch(noPhone.html, /Phone/);
assert.doesNotMatch(noPhone.html, /\bnull\b/i);
pass("missing phone: field omitted entirely, no placeholder");

const withCompany = renderDealerRegistrationSuccessEmail({
  firstName: "Raj",
  dealerName: "Raj Mehta",
  dealerId: "44",
  email: "raj@example.com",
  phone: "+91 90000 00000",
  companyName: "Mehta Automation LLP",
  registrationDate: "8 October 2026",
  loginUrl: "https://whyte-automation-sandy.vercel.app/login",
  supportEmail: "support@whyte.co.in",
});
assert.match(withCompany.html, /Mehta Automation LLP/);
pass("company present: shown when actually available");

console.log(`\nDealer registration email template verification PASSED (${results.length} checks).`);
