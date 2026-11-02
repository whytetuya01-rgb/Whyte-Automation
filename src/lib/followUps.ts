/**
 * Lead follow-ups: which day a follow-up falls on, the "Add to Google Calendar" link, and the calendar file (iCalendar)
 * that Google Calendar, Apple Calendar and Outlook can subscribe to. Pure (no database, no server imports), so the
 * server and the screens use the same rules.
 *
 * "Today", "overdue" and "upcoming" are decided by the business day in India (Asia/Kolkata, which has no daylight
 * saving), not by the server's or the browser's clock.
 */

export const FOLLOW_UP_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** A calendar entry lasts this long (a follow-up is a short call or message). */
export const FOLLOW_UP_DURATION_MINUTES = 30;

export type FollowUpBucket = "overdue" | "today" | "upcoming";

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: FOLLOW_UP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** `YYYY-MM-DD` of an instant on the Indian business calendar. */
export function businessDayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

/** The start (inclusive) and end (exclusive) of the Indian business day that contains `now`, as exact instants. */
export function businessDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(`${businessDayKey(now)}T00:00:00${IST_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

/** Overdue = an earlier day; today = any time today (even if the time has passed); upcoming = a later day. */
export function followUpBucket(due: Date, now: Date = new Date()): FollowUpBucket {
  const dueDay = businessDayKey(due);
  const today = businessDayKey(now);
  if (dueDay < today) return "overdue";
  return dueDay === today ? "today" : "upcoming";
}

/** Whole business days between today and the due day (negative = days overdue). */
export function followUpDayOffset(due: Date, now: Date = new Date()): number {
  const dueStart = new Date(`${businessDayKey(due)}T00:00:00${IST_OFFSET}`).getTime();
  const todayStart = businessDayBounds(now).start.getTime();
  return Math.round((dueStart - todayStart) / (24 * 3600 * 1000));
}

export interface FollowUpLead {
  id: string;
  referenceNumber: string;
  customerName: string;
  phone?: string | null;
  projectType?: string | null;
  location?: string | null;
  priority?: string | null;
  status?: string | null;
  notes?: string | null;
}

/** What a calendar entry says, with the details a salesperson needs on the day. No budget or internal figures. */
export function followUpEventText(lead: FollowUpLead, openUrl?: string | null): { title: string; details: string; location: string } {
  const lines = [
    `Lead ${lead.referenceNumber}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.projectType ? `Project: ${lead.projectType}` : null,
    lead.priority ? `Priority: ${lead.priority}` : null,
    lead.notes ? `Notes: ${lead.notes.slice(0, 300)}` : null,
    openUrl ? `Open in the app: ${openUrl}` : null,
  ].filter((line): line is string => Boolean(line));
  return { title: `Follow up: ${lead.customerName}`, details: lines.join("\n"), location: lead.location?.trim() ?? "" };
}

function googleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** A link that opens Google Calendar with the event filled in; the user only presses Save. Needs no Google setup. */
export function googleCalendarUrl(lead: FollowUpLead, due: Date, openUrl?: string | null): string {
  const text = followUpEventText(lead, openUrl);
  const end = new Date(due.getTime() + FOLLOW_UP_DURATION_MINUTES * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: text.title,
    dates: `${googleDate(due)}/${googleDate(end)}`,
    details: text.details.slice(0, 1200),
    ctz: FOLLOW_UP_TIME_ZONE,
  });
  if (text.location) params.set("location", text.location.slice(0, 200));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ── iCalendar (RFC 5545) ─────────────────────────────────────────────────────────────────────────────────────────

/** Text values: backslash, semicolon, comma and line breaks are escaped; other control characters are dropped. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Lines are folded at 75 bytes (never inside a multi-byte character); continuation lines start with one space. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const icsDate = googleDate;

export interface FollowUpCalendarEvent {
  lead: FollowUpLead;
  due: Date;
  updatedAt: Date;
  openUrl?: string | null;
}

/**
 * The follow-ups as a calendar file. Each lead has one stable entry (the same UID every time), so a changed date moves
 * the existing entry instead of adding another. Entries do not block the person's time (they are reminders).
 */
export function buildFollowUpCalendar(events: FollowUpCalendarEvent[], options: { calendarName: string; now?: Date }): string {
  const now = options.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Whyte Automations//Lead follow-ups//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${FOLLOW_UP_TIME_ZONE}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    const text = followUpEventText(event.lead, event.openUrl);
    const end = new Date(event.due.getTime() + FOLLOW_UP_DURATION_MINUTES * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:followup-${event.lead.id.replace(/[^A-Za-z0-9_-]/g, "")}@whyte-quotation`,
      `DTSTAMP:${icsDate(now)}`,
      `LAST-MODIFIED:${icsDate(event.updatedAt)}`,
      `SEQUENCE:${Math.max(0, Math.floor(event.updatedAt.getTime() / 1000))}`,
      `DTSTART:${icsDate(event.due)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeIcsText(text.title)}`,
      `DESCRIPTION:${escapeIcsText(text.details)}`
    );
    if (text.location) lines.push(`LOCATION:${escapeIcsText(text.location)}`);
    if (event.openUrl) lines.push(`URL:${event.openUrl.replace(/[\r\n\s]/g, "")}`);
    lines.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
