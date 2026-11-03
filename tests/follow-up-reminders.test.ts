/**
 * The morning follow-up email's text (pure, nothing is sent).
 *
 *   npx tsx tests/follow-up-reminders.test.ts
 */
import assert from "node:assert/strict";
import { buildFollowUpDigestEmail, type DigestItem } from "../src/lib/followUpReminders";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const at = (iso: string) => new Date(iso);
const item = (over: Partial<DigestItem>): DigestItem => ({ leadId: "ld_1", referenceNumber: "LD-2026-0001", customerName: "Ravi", projectType: null, dueAt: at("2026-11-03T05:30:00Z"), overdue: false, ...over });

{
  const email = buildFollowUpDigestEmail({
    personName: "Adam",
    companyName: "Acme Homes",
    timeZone: "Asia/Kolkata",
    appUrl: "https://crm.example.com",
    items: [
      item({ customerName: "Later", dueAt: at("2026-11-03T09:30:00Z") }),
      item({ customerName: "Earlier", dueAt: at("2026-11-03T05:30:00Z"), projectType: "Villa" }),
      item({ customerName: "Late one", dueAt: at("2026-11-01T04:30:00Z"), overdue: true }),
    ],
  });
  assert.equal(email.subject, "Acme Homes: Follow-ups for today (2 due today, 1 overdue)");
  assert.match(email.text, /OVERDUE \(1\)\n- 01 Nov, 10:00 am · Late one \(LD-2026-0001\)/);
  assert.match(email.text, /DUE TODAY \(2\)\n- 11:00 am · Earlier \(LD-2026-0001\) · Villa\n- 03:00 pm · Later/);
  assert.match(email.text, /Open follow-ups: https:\/\/crm\.example\.com\/admin\/crm\/follow-ups/);
  assert.match(email.text, /Times are in Asia\/Kolkata\./);
  assert.ok(email.html.includes('href="https://crm.example.com/admin/account"'), "says where to turn it off");
  pass("lists overdue first (with the date), then today's in time order (time only), in the person's zone, with links");
}

{
  const email = buildFollowUpDigestEmail({
    personName: "<b>Eve</b>",
    companyName: null,
    timeZone: "UTC",
    appUrl: null,
    items: [item({ customerName: '<script>alert("x")</script>', overdue: true })],
  });
  assert.equal(email.subject, "Follow-ups for today (1 overdue)");
  assert.ok(!email.html.includes("<script>") && email.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"), "names are escaped in the HTML");
  assert.ok(email.html.includes("Hello &lt;b&gt;Eve&lt;/b&gt;"));
  assert.ok(!email.html.includes("Open follow-ups"), "no button without a known address");
  assert.ok(!email.text.includes("DUE TODAY"), "no empty section");
  pass("escapes names in the HTML, leaves out empty sections, and has no links when the app address is unknown");
}

console.log(`\nALL ${count} FOLLOW-UP REMINDER EMAIL TESTS PASSED!`);
