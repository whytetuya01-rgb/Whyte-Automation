/**
 * Follow-up rules (src/lib/followUps.ts): when a follow-up is overdue, today or upcoming (by the clock, in any time zone,
 * including days when the clocks change), the "Add to Google Calendar" link, and the calendar file. The API and the
 * screens are tested in tests/follow-ups.test.mjs and tests/follow-ups.browser.mjs; the task logic in
 * tests/follow-up-service.test.ts.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/follow-ups.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FOLLOW_UP_TIME_ZONE,
  buildFollowUpCalendar,
  businessDayBounds,
  businessDayKey,
  escapeIcsText,
  foldIcsLine,
  followUpBucket,
  followUpDayOffset,
  followUpEventText,
  followUpStatus,
  googleCalendarUrl,
  isFollowUpOverdue,
  isValidTimeZone,
  type FollowUpLead,
} from "../src/lib/followUps";
import { FEED_TOKEN_PATTERN, hashFeedToken, openFeedToken, sealFeedToken, feedUrl, isPubliclyReachable } from "../src/lib/calendarFeedService";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const lead = (extra: Partial<FollowUpLead> = {}): FollowUpLead => ({ id: "ld_abc123", referenceNumber: "LD-2026-0007", customerName: "Ravi Patel", phone: "+91 98765 43210", projectType: "3 BHK Villa", location: "Satellite, Ahmedabad", priority: "high", status: "contacted", ...extra });
const ist = (iso: string) => new Date(`${iso}+05:30`);
const utc = (iso: string) => new Date(iso);

function main() {
  // ── overdue by the clock, today and upcoming by the business day ──
  assert.equal(FOLLOW_UP_TIME_ZONE, "Asia/Kolkata", "India is the default");
  // 2026-11-05 23:30 IST is still the 5th, although it is already the 5th 18:00 in UTC and the 6th in Tokyo.
  assert.equal(businessDayKey(ist("2026-11-05T23:30:00")), "2026-11-05");
  assert.equal(businessDayKey(ist("2026-11-06T00:10:00")), "2026-11-06");
  assert.equal(businessDayKey(new Date("2026-11-05T18:40:00Z")), "2026-11-06", "18:40 UTC is already tomorrow in India");
  const bounds = businessDayBounds(ist("2026-11-05T15:00:00"));
  assert.equal(bounds.start.toISOString(), "2026-11-04T18:30:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-11-05T18:30:00.000Z");
  const now = ist("2026-11-05T15:00:00");
  assert.equal(followUpBucket(ist("2026-11-04T23:59:00"), now), "overdue", "late yesterday is overdue");
  assert.equal(followUpBucket(ist("2026-11-05T00:00:00"), now), "overdue", "the start of today has already passed");
  assert.equal(followUpBucket(ist("2026-11-05T09:00:00"), now), "overdue", "earlier today: the time has passed, so it is overdue");
  assert.equal(followUpBucket(ist("2026-11-05T14:59:59"), now), "overdue", "a second ago");
  assert.equal(followUpBucket(ist("2026-11-05T15:00:00"), now), "today", "due exactly now is not overdue yet");
  assert.equal(followUpBucket(ist("2026-11-05T15:00:01"), now), "today", "later today");
  assert.equal(followUpBucket(ist("2026-11-05T23:59:00"), now), "today", "late tonight is still today");
  assert.equal(followUpBucket(ist("2026-11-06T00:00:00"), now), "upcoming");
  assert.equal(followUpDayOffset(ist("2026-11-02T10:00:00"), now), -3);
  assert.equal(followUpDayOffset(ist("2026-11-05T01:00:00"), now), 0, "earlier today is day 0 (and overdue)");
  assert.equal(followUpDayOffset(ist("2026-11-08T22:00:00"), now), 3);
  assert.equal(isFollowUpOverdue(ist("2026-11-05T14:59:59"), now), true);
  assert.equal(isFollowUpOverdue(ist("2026-11-05T15:00:00"), now), false, "due exactly now");
  assert.equal(isFollowUpOverdue(new Date(now.getTime() - 1), now), true, "a millisecond late");
  assert.equal(isFollowUpOverdue("not a date", now), false);
  assert.equal(isFollowUpOverdue(ist("2026-11-05T14:00:00").toISOString(), now.getTime()), true, "ISO strings and numbers work too");
  pass("overdue = the due time has passed; today = still ahead before the Indian day ends; upcoming = a later day");

  assert.deepEqual(followUpStatus(ist("2026-11-03T10:00:00").toISOString(), now), { bucket: "overdue", dayOffset: -2 });
  assert.deepEqual(followUpStatus(ist("2026-11-05T09:00:00"), now), { bucket: "overdue", dayOffset: 0 });
  assert.deepEqual(followUpStatus(ist("2026-11-05T18:00:00"), now), { bucket: "today", dayOffset: 0 });
  assert.deepEqual(followUpStatus(ist("2026-11-06T09:00:00"), now), { bucket: "upcoming", dayOffset: 1 });
  assert.equal(followUpStatus("nope", now), null);
  assert.equal(followUpStatus(now, Number.NaN), null);
  pass("followUpStatus gives every screen the same answer (bucket and day offset), or null for a bad date");

  // ── other time zones, including days when the clocks change ──
  for (const good of ["Asia/Kolkata", "America/New_York", "Australia/Lord_Howe", "UTC"]) assert.equal(isValidTimeZone(good), true, good);
  for (const bad of ["Mars/Olympus", "", "  ", "IST+5", null, undefined, 5]) assert.equal(isValidTimeZone(bad), false, String(bad));

  // New York: the clocks go forward on 2026-03-08 (a 23-hour day) and back on 2026-11-01 (a 25-hour day).
  const springDay = businessDayBounds(utc("2026-03-08T18:00:00Z"), "America/New_York");
  assert.equal(springDay.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(springDay.end.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal((springDay.end.getTime() - springDay.start.getTime()) / 3_600_000, 23, "the day the clocks go forward has 23 hours");
  const fallDay = businessDayBounds(utc("2026-11-01T18:00:00Z"), "America/New_York");
  assert.equal(fallDay.start.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(fallDay.end.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal((fallDay.end.getTime() - fallDay.start.getTime()) / 3_600_000, 25, "the day the clocks go back has 25 hours");
  const ordinaryDay = businessDayBounds(utc("2026-07-10T12:00:00Z"), "America/New_York");
  assert.equal((ordinaryDay.end.getTime() - ordinaryDay.start.getTime()) / 3_600_000, 24);

  // A half-hour clock change (Lord Howe Island) and a quarter-hour zone (Nepal).
  const lordHowe = businessDayBounds(utc("2026-04-05T00:00:00Z"), "Australia/Lord_Howe");
  assert.equal((lordHowe.end.getTime() - lordHowe.start.getTime()) / 60_000, 24 * 60 + 30, "a 24.5-hour day");
  assert.equal(businessDayKey(utc("2026-11-05T18:14:00Z"), "Asia/Kathmandu"), "2026-11-05");
  assert.equal(businessDayKey(utc("2026-11-05T18:15:00Z"), "Asia/Kathmandu"), "2026-11-06", "Nepal is UTC+5:45");
  const nepal = businessDayBounds(utc("2026-11-05T10:00:00Z"), "Asia/Kathmandu");
  assert.deepEqual([nepal.start.toISOString(), nepal.end.toISOString()], ["2026-11-04T18:15:00.000Z", "2026-11-05T18:15:00.000Z"]);

  // The same instant is a different day in different places, so today / upcoming depends on the zone; overdue does not.
  const nyNow = utc("2026-11-01T15:00:00Z"); // 10:00 on the 1st in New York
  const lateNight = utc("2026-11-02T04:30:00Z"); // 23:30 on the 1st in New York, 10:00 on the 2nd in India
  assert.equal(followUpBucket(lateNight, nyNow, "America/New_York"), "today");
  assert.equal(followUpBucket(lateNight, nyNow, "Asia/Kolkata"), "upcoming");
  assert.equal(followUpDayOffset(utc("2026-11-02T14:00:00Z"), nyNow, "America/New_York"), 1, "tomorrow, even across the 25-hour day");
  assert.equal(followUpBucket(utc("2026-11-01T14:00:00Z"), nyNow, "America/New_York"), "overdue");
  assert.equal(followUpBucket(utc("2026-11-01T14:00:00Z"), nyNow, "Asia/Kolkata"), "overdue", "overdue is the same everywhere");
  pass("other time zones: 23- and 25-hour days, half-hour and quarter-hour zones, and the same instant landing on different days");

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
  for (const expected of ["Lead LD-2026-0007", "Phone: +91 98765 43210", "Project: 3 BHK Villa", "Priority: high", "https://app.example.com/admin/crm/follow-ups"]) assert.ok(details.includes(expected), expected);
  assert.ok(!/budget|estimated|₹/i.test(details), "no budget or internal figures in the event");
  const tricky = new URL(googleCalendarUrl(lead({ customerName: "A&B <Interiors> \"Pvt\" 100% #1", projectType: "x".repeat(5000) }), due));
  assert.equal(tricky.searchParams.get("text"), "Follow up: A&B <Interiors> \"Pvt\" 100% #1", "special characters survive the link intact");
  assert.ok((tricky.searchParams.get("details") ?? "").length <= 1200, "the details are kept short enough for a link");
  assert.equal(new URL(googleCalendarUrl(lead({ location: null }), due)).searchParams.has("location"), false, "no empty location");
  pass("the Add to Google Calendar link has the title, a 30-minute time in UTC, the lead's details and no internal figures, and survives special characters");

  // ── lead notes never reach a calendar ──
  const withNotes = { ...lead(), notes: "Customer will pay 4,50,000 if we give 12% off. Budget is tight." } as unknown as FollowUpLead;
  const text = followUpEventText(withNotes, "https://app.example.com/admin/crm/follow-ups");
  assert.ok(!/notes|4,50,000|12% off|budget/i.test(`${text.title}\n${text.details}\n${text.location}`), "free-text notes (prices, private remarks) are never put in calendar text");
  assert.ok(!(new URL(googleCalendarUrl(withNotes, due)).searchParams.get("details") ?? "").includes("4,50,000"), "not in the Add to Google Calendar link");
  const noteFile = buildFollowUpCalendar([{ lead: withNotes, due, updatedAt: due }], { calendarName: "Lead follow-ups", now: due });
  assert.ok(!noteFile.includes("4,50,000") && !noteFile.includes("12% off"), "and not in the calendar file");
  pass("lead notes (which can hold prices or private remarks) are never put in a calendar entry, the link or the calendar file");

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
  const hostile = buildFollowUpCalendar([{ lead: lead({ customerName: "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Pwned", phone: "1\r\nATTENDEE:mailto:attacker@example.com", projectType: "p\r\nX-EVIL:3", location: "Hall;\r\nURL:https://evil.example", id: "ld_x\r\nUID:forged" }), due, updatedAt, openUrl: "https://app.example.com/a\r\nX-EVIL:1" }], { calendarName: "Cal\r\nX-EVIL:2" });
  const lines = hostile.split("\r\n");
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1, "still exactly one event (the words inside the name are just text)");
  assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
  assert.ok(!lines.some((l) => /^(ATTENDEE|X-EVIL|SUMMARY:Pwned)/.test(l)), "no injected property starts a line");
  assert.ok(!lines.some((l) => l === "URL:https://evil.example"), "nor an injected URL");
  assert.equal(lines.filter((l) => l.startsWith("UID:")).length, 1, "and no forged UID");
  assert.ok(hostile.includes("Evil\\nEND:VEVENT"), "the text is kept, escaped, inside the summary");
  pass("a lead name, phone, project, location or id cannot inject calendar entries or properties");

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
