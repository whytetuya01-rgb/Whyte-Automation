/**
 * Follow-up rules (src/lib/followUps.ts): which business day a follow-up falls on, the "Add to Google Calendar" link, and
 * the calendar file. The API and the screens are tested in tests/follow-ups.test.mjs and tests/follow-ups.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/follow-ups.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildFollowUpCalendar,
  businessDayBounds,
  businessDayKey,
  escapeIcsText,
  foldIcsLine,
  followUpBucket,
  followUpDayOffset,
  followUpEventText,
  googleCalendarUrl,
  type FollowUpLead,
} from "../src/lib/followUps";
import { FEED_TOKEN_PATTERN, hashFeedToken, openFeedToken, sealFeedToken, feedUrl, isPubliclyReachable } from "../src/lib/calendarFeedService";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const lead = (extra: Partial<FollowUpLead> = {}): FollowUpLead => ({ id: "ld_abc123", referenceNumber: "LD-2026-0007", customerName: "Ravi Patel", phone: "+91 98765 43210", projectType: "3 BHK Villa", location: "Satellite, Ahmedabad", priority: "high", status: "contacted", notes: "Wants matte black switches.", ...extra });
const ist = (iso: string) => new Date(`${iso}+05:30`);

function main() {
  // ── business day, in India ──
  // 2026-11-05 23:30 IST is still the 5th, although it is already the 5th 18:00 in UTC and the 6th in Tokyo.
  assert.equal(businessDayKey(ist("2026-11-05T23:30:00")), "2026-11-05");
  assert.equal(businessDayKey(ist("2026-11-06T00:10:00")), "2026-11-06");
  assert.equal(businessDayKey(new Date("2026-11-05T18:40:00Z")), "2026-11-06", "18:40 UTC is already tomorrow in India");
  const bounds = businessDayBounds(ist("2026-11-05T15:00:00"));
  assert.equal(bounds.start.toISOString(), "2026-11-04T18:30:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-11-05T18:30:00.000Z");
  const now = ist("2026-11-05T15:00:00");
  assert.equal(followUpBucket(ist("2026-11-04T23:59:00"), now), "overdue", "late yesterday is overdue");
  assert.equal(followUpBucket(ist("2026-11-05T00:00:00"), now), "today", "the start of today is today");
  assert.equal(followUpBucket(ist("2026-11-05T09:00:00"), now), "today", "earlier today (time passed) is still today, not overdue");
  assert.equal(followUpBucket(ist("2026-11-05T23:59:00"), now), "today");
  assert.equal(followUpBucket(ist("2026-11-06T00:00:00"), now), "upcoming");
  assert.equal(followUpDayOffset(ist("2026-11-02T10:00:00"), now), -3);
  assert.equal(followUpDayOffset(ist("2026-11-05T01:00:00"), now), 0);
  assert.equal(followUpDayOffset(ist("2026-11-08T22:00:00"), now), 3);
  pass("today, overdue and upcoming follow the Indian business day (a follow-up earlier today is not overdue)");

  // ── Add to Google Calendar ──
  const due = new Date("2026-11-05T04:30:00Z"); // 10:00 IST
  const url = new URL(googleCalendarUrl(lead(), due, "https://app.example.com/admin/crm/follow-ups"));
  assert.equal(`${url.origin}${url.pathname}`, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Follow up: Ravi Patel");
  assert.equal(url.searchParams.get("dates"), "20261105T043000Z/20261105T050000Z", "30 minutes, in UTC");
  assert.equal(url.searchParams.get("ctz"), "Asia/Kolkata");
  assert.equal(url.searchParams.get("location"), "Satellite, Ahmedabad");
  const details = url.searchParams.get("details") ?? "";
  for (const expected of ["Lead LD-2026-0007", "Phone: +91 98765 43210", "Project: 3 BHK Villa", "Priority: high", "Wants matte black switches.", "https://app.example.com/admin/crm/follow-ups"]) assert.ok(details.includes(expected), expected);
  assert.ok(!/budget|estimated|₹/i.test(details), "no budget or internal figures in the event");
  const tricky = new URL(googleCalendarUrl(lead({ customerName: "A&B <Interiors> \"Pvt\" 100% #1", notes: "x".repeat(5000) }), due));
  assert.equal(tricky.searchParams.get("text"), "Follow up: A&B <Interiors> \"Pvt\" 100% #1", "special characters survive the link intact");
  assert.ok((tricky.searchParams.get("details") ?? "").length <= 1200, "the details are kept short enough for a link");
  assert.equal(new URL(googleCalendarUrl(lead({ location: null }), due)).searchParams.has("location"), false, "no empty location");
  pass("the Add to Google Calendar link has the title, a 30-minute time in UTC, the lead's details and no internal figures, and survives special characters");

  // ── calendar file ──
  assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(escapeIcsText("tab\there\u0007bell\r\nnext"), "tab\there" + "bell\\nnext", "control characters are dropped, line breaks become \\n");
  const long = "x".repeat(300);
  const folded = foldIcsLine(`DESCRIPTION:${long}`);
  for (const physical of folded.split("\r\n")) assert.ok(Buffer.byteLength(physical) <= 75, `line of ${Buffer.byteLength(physical)} bytes`);
  assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), `DESCRIPTION:${long}`, "unfolding restores the line exactly");
  const hindi = foldIcsLine(`SUMMARY:${"नमस्ते ".repeat(30)}`);
  for (const physical of hindi.split("\r\n")) assert.ok(Buffer.byteLength(physical) <= 75, "multi-byte text is never cut inside a character");
  assert.equal(hindi.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), `SUMMARY:${"नमस्ते ".repeat(30)}`);

  const updatedAt = new Date("2026-11-03T08:00:00Z");
  const file = buildFollowUpCalendar([{ lead: lead(), due, updatedAt, openUrl: "https://app.example.com/admin/crm/follow-ups" }, { lead: lead({ id: "ld_two", referenceNumber: "LD-2026-0008", customerName: "Meera" }), due: new Date("2026-11-06T06:00:00Z"), updatedAt }], { calendarName: "Lead follow-ups", now: new Date("2026-11-04T00:00:00Z") });
  assert.ok(file.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && file.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(file), "every line break is CRLF");
  assert.equal((file.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((file.match(/END:VEVENT/g) ?? []).length, 2);
  for (const line of ["UID:followup-ld_abc123@whyte-quotation", "DTSTART:20261105T043000Z", "DTEND:20261105T050000Z", "DTSTAMP:20261104T000000Z", "SUMMARY:Follow up: Ravi Patel", "TRANSP:TRANSPARENT", "STATUS:CONFIRMED", "X-WR-TIMEZONE:Asia/Kolkata"]) assert.ok(file.split("\r\n").includes(line), line);
  assert.equal(new Set(file.match(/UID:[^\r]+/g)).size, 2, "one stable, distinct UID per lead");
  assert.equal(file, buildFollowUpCalendar([{ lead: lead(), due, updatedAt, openUrl: "https://app.example.com/admin/crm/follow-ups" }, { lead: lead({ id: "ld_two", referenceNumber: "LD-2026-0008", customerName: "Meera" }), due: new Date("2026-11-06T06:00:00Z"), updatedAt }], { calendarName: "Lead follow-ups", now: new Date("2026-11-04T00:00:00Z") }), "the same input gives the same file");
  assert.ok(buildFollowUpCalendar([], { calendarName: "Lead follow-ups" }).includes("BEGIN:VCALENDAR") && !buildFollowUpCalendar([], { calendarName: "x" }).includes("VEVENT"), "an empty calendar is still a valid calendar");
  pass("the calendar file is valid: CRLF lines, folded at 75 bytes without cutting characters, a stable UID per lead, times in UTC, reminders that do not block time");

  // ── a hostile lead cannot add calendar entries or properties ──
  const hostile = buildFollowUpCalendar([{ lead: lead({ customerName: "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Pwned", notes: "x\r\nATTENDEE:mailto:attacker@example.com", location: "Hall;\r\nURL:https://evil.example", id: "ld_x\r\nUID:forged" }), due, updatedAt, openUrl: "https://app.example.com/a\r\nX-EVIL:1" }], { calendarName: "Cal\r\nX-EVIL:2" });
  const lines = hostile.split("\r\n");
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1, "still exactly one event (the words inside the name are just text)");
  assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
  assert.ok(!lines.some((l) => /^(ATTENDEE|X-EVIL|SUMMARY:Pwned)/.test(l)), "no injected property starts a line");
  assert.ok(!lines.some((l) => l === "URL:https://evil.example"), "nor an injected URL");
  assert.equal(lines.filter((l) => l.startsWith("UID:")).length, 1, "and no forged UID");
  assert.ok(hostile.includes("Evil\\nEND:VEVENT"), "the text is kept, escaped, inside the summary");
  pass("a lead name, notes, location or id cannot inject calendar entries or properties");

  // ── the secret link ──
  process.env.NEXTAUTH_SECRET = "unit-test-secret-not-real";
  const token = "T".repeat(43);
  assert.match(token, FEED_TOKEN_PATTERN);
  for (const bad of ["", "short", "a".repeat(70), `${"a".repeat(42)}.`, `${"a".repeat(41)}/x`]) assert.doesNotMatch(bad, FEED_TOKEN_PATTERN, bad);
  assert.equal(hashFeedToken(token), createHash("sha256").update(token).digest("hex"));
  const sealed = sealFeedToken(token);
  assert.ok(sealed && !sealed.includes(token));
  assert.equal(openFeedToken(sealed), token, "the person's own link can be shown again");
  const flipped = (sealed as string).split(".");
  flipped[2] = Buffer.from(Buffer.from(flipped[2], "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url");
  assert.equal(openFeedToken(flipped.join(".")), null, "tampered data does not open");
  process.env.NEXTAUTH_SECRET = "a-different-secret";
  assert.equal(openFeedToken(sealed), null, "another server secret cannot open it");
  assert.equal(feedUrl(token, "https://app.example.com"), `https://app.example.com/api/calendar/follow-ups/${token}.ics`);
  assert.equal(isPubliclyReachable("https://app.example.com"), true);
  for (const local of ["http://app.example.com", "https://localhost:3000", "http://127.0.0.1:3000", "https://my-pc.local", "not a url"]) assert.equal(isPubliclyReachable(local), false, local);
  assert.equal(followUpEventText(lead()).title, "Follow up: Ravi Patel");
  pass("the private link: only a hash and an encrypted copy are kept; wrong secrets and tampering do not open it; local or http addresses are flagged as unreachable for Google");

  console.log(`\nALL ${count} FOLLOW-UP TESTS PASSED!`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
