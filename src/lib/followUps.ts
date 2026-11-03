/**
 * Lead follow-ups: when a follow-up counts as overdue, today or upcoming, the "Add to Google Calendar" link, and the
 * calendar file (iCalendar) that Google Calendar, Apple Calendar and Outlook can subscribe to. Pure (no database, no
 * server imports), so the server and every screen use the same rules.
 *
 * Overdue is decided by the clock: a follow-up is overdue the moment its due time has passed. From now until the end of
 * today it is "today"; after that it is "upcoming". Where a day ends depends on a time zone, which is always passed in
 * (default: India, Asia/Kolkata, which has no daylight saving). Zones that do change their clocks are handled too, so a
 * business day can be 23 or 25 hours long.
 */

export const FOLLOW_UP_TIME_ZONE = "Asia/Kolkata";

/** A calendar entry lasts this long (a follow-up is a short call or message). */
export const FOLLOW_UP_DURATION_MINUTES = 30;

export type FollowUpBucket = "overdue" | "today" | "upcoming";

/**
 * True for a name the runtime knows as an IANA time zone written "Area/Location" (e.g. "Asia/Kolkata",
 * "America/New_York") or "UTC". Fixed offsets ("+05:30") and abbreviations ("IST", "EST") are refused: they do not follow
 * daylight saving, "IST" alone means three different places, and Google Calendar wants a real zone name.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string") return false;
  if (timeZone !== "UTC" && !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Old names some runtimes still report (Node reports "Asia/Calcutta"), written the way the current IANA database writes them. */
const PREFERRED_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Macao": "Asia/Macau",
  "Asia/Ujung_Pandang": "Asia/Makassar",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Godthab": "America/Nuuk",
  "Europe/Kiev": "Europe/Kyiv",
};

/**
 * The zone to use for a person: the one they chose, written the standard way (the same zone always gets the same name:
 * "Asia/Calcutta" becomes "Asia/Kolkata"), or India when they have not chosen one or it is not valid.
 */
export function resolveFollowUpTimeZone(chosen: unknown): string {
  if (!isValidTimeZone(chosen)) return FOLLOW_UP_TIME_ZONE;
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: chosen }).resolvedOptions().timeZone;
    const preferred = PREFERRED_ZONE_NAMES[canonical];
    return preferred && isValidTimeZone(preferred) ? preferred : canonical;
  } catch {
    return FOLLOW_UP_TIME_ZONE;
  }
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormats = new Map<string, Intl.DateTimeFormat>();

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  return format;
}

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = clockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    clockFormats.set(timeZone, format);
  }
  return format;
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds (positive = ahead). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const wholeSeconds = Math.floor(instant / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const part of clockFormat(timeZone).formatToParts(new Date(wholeSeconds))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second) - wholeSeconds;
}

/** The instant a calendar day (`YYYY-MM-DD`) begins in the zone. */
function dayStart(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  let instant = midnightAsUtc - zoneOffsetMs(midnightAsUtc, timeZone);
  // The zone's offset can differ at the instant we landed on (a clock change in between): settle on the right one.
  const settled = midnightAsUtc - zoneOffsetMs(instant, timeZone);
  if (settled !== instant) instant = settled;
  return new Date(instant);
}

function nextDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

const dayNumber = (key: string): number => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

/** `YYYY-MM-DD` of an instant on the zone's business calendar. */
export function businessDayKey(date: Date, timeZone: string = FOLLOW_UP_TIME_ZONE): string {
  return dayFormat(timeZone).format(date);
}

/** The start (inclusive) and end (exclusive) of the business day that contains `now`, as exact instants. */
export function businessDayBounds(now: Date, timeZone: string = FOLLOW_UP_TIME_ZONE): { start: Date; end: Date } {
  const key = businessDayKey(now, timeZone);
  return { start: dayStart(key, timeZone), end: dayStart(nextDayKey(key), timeZone) };
}

/**
 * Overdue = the due time has passed; today = still ahead of us before the day ends; upcoming = a later day.
 * A follow-up due exactly now is not yet overdue.
 */
export function followUpBucket(due: Date, now: Date = new Date(), timeZone: string = FOLLOW_UP_TIME_ZONE): FollowUpBucket {
  if (due.getTime() < now.getTime()) return "overdue";
  return businessDayKey(due, timeZone) === businessDayKey(now, timeZone) ? "today" : "upcoming";
}

/** True once the due time has passed. The zone does not matter for this question, only for "today" vs "upcoming". */
export function isFollowUpOverdue(due: Date | string | number, now: Date | number = new Date()): boolean {
  const dueAt = new Date(due).getTime();
  return !Number.isNaN(dueAt) && dueAt < new Date(now).getTime();
}

/** Whole business days between today and the due day (negative = the due day is already behind us). */
export function followUpDayOffset(due: Date, now: Date = new Date(), timeZone: string = FOLLOW_UP_TIME_ZONE): number {
  return dayNumber(businessDayKey(due, timeZone)) - dayNumber(businessDayKey(now, timeZone));
}

export interface FollowUpStatus {
  bucket: FollowUpBucket;
  /** Business days from today to the due day: 0 = today, 1 = tomorrow, -2 = two days ago. */
  dayOffset: number;
}

/**
 * The one answer every screen uses for a follow-up date (customer profile, pipeline cards, lead tab, follow-ups list).
 * `null` when the date or the clock is not a valid date.
 */
export function followUpStatus(due: Date | string | number, now: Date | number = new Date(), timeZone: string = FOLLOW_UP_TIME_ZONE): FollowUpStatus | null {
  const dueAt = new Date(due);
  const nowAt = new Date(now);
  if (Number.isNaN(dueAt.getTime()) || Number.isNaN(nowAt.getTime())) return null;
  return { bucket: followUpBucket(dueAt, nowAt, timeZone), dayOffset: followUpDayOffset(dueAt, nowAt, timeZone) };
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
}

/**
 * What a calendar entry says, with the details a salesperson needs on the day. No budget or internal figures, and never
 * the lead's notes: they are free text and can hold prices or private remarks, which must not end up in someone's calendar.
 */
export function followUpEventText(lead: FollowUpLead, openUrl?: string | null): { title: string; details: string; location: string } {
  const lines = [
    `Lead ${lead.referenceNumber}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.projectType ? `Project: ${lead.projectType}` : null,
    lead.priority ? `Priority: ${lead.priority}` : null,
    openUrl ? `Open in the app: ${openUrl}` : null,
  ].filter((line): line is string => Boolean(line));
  return { title: `Follow up: ${lead.customerName}`, details: lines.join("\n"), location: lead.location?.trim() ?? "" };
}

function googleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** A link that opens Google Calendar with the event filled in; the user only presses Save. Needs no Google setup. */
export function googleCalendarUrl(lead: FollowUpLead, due: Date, openUrl?: string | null, timeZone: string = FOLLOW_UP_TIME_ZONE): string {
  const text = followUpEventText(lead, openUrl);
  const end = new Date(due.getTime() + FOLLOW_UP_DURATION_MINUTES * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: text.title,
    dates: `${googleDate(due)}/${googleDate(end)}`,
    details: text.details.slice(0, 1200),
    ctz: timeZone,
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
export function buildFollowUpCalendar(events: FollowUpCalendarEvent[], options: { calendarName: string; now?: Date; timeZone?: string }): string {
  const now = options.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Whyte Automations//Lead follow-ups//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${options.timeZone ?? FOLLOW_UP_TIME_ZONE}`,
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
