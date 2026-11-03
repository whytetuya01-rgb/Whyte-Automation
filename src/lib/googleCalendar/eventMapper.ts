import { createHash } from "node:crypto";
import type { GoogleEventBody } from "./client";

/**
 * What a follow-up looks like in Google Calendar. Pure: no database, no network.
 *
 * Privacy rule: an event carries ONLY the customer's name, the lead's reference number and priority, and the time. Never a
 * phone number, notes, address, project details or any money figure. Google events can be shared, synced to phones and read
 * by calendar apps, so they get the minimum needed to recognise the follow-up; the CRM link leads to the rest.
 */

export const DEFAULT_EVENT_MINUTES = 30;
export const EVENT_MINUTES_CHOICES = [15, 30, 45, 60, 90, 120] as const;

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * The event's id is derived from the connection and the task, never random: the same follow-up always maps to the same
 * Google event id (so a retried insert cannot create a second event: Google answers 409, and we adopt the existing one).
 * Google allows ids of 5-1024 characters from a-v and 0-9 (base32hex, lower case).
 */
export function eventIdFor(connectionId: string, taskId: string): string {
  const digest = createHash("sha256").update(`whyte-crm:${connectionId}:${taskId}`).digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 26) break;
  }
  return out;
}

export interface FollowUpEventInput {
  taskId: string;
  referenceNumber: string;
  customerName: string;
  priority: string;
  dueAt: Date;
  completed: boolean;
  minutes: number;
  timeZone: string;
  appBaseUrl: string | null;
}

const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export function chooseEventMinutes(value: unknown): number {
  return typeof value === "number" && (EVENT_MINUTES_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_EVENT_MINUTES;
}

export function buildEventBody(id: string, input: FollowUpEventInput): GoogleEventBody {
  const end = new Date(input.dueAt.getTime() + chooseEventMinutes(input.minutes) * 60_000);
  const lines = [`Lead ${input.referenceNumber} · Priority: ${PRIORITY_LABEL[input.priority] ?? input.priority}`];
  if (input.completed) lines.push("Marked done in the CRM.");
  if (input.appBaseUrl) lines.push(`Open in the CRM: ${input.appBaseUrl}/admin/crm/follow-ups`);
  lines.push("", "Kept up to date by Whyte CRM. Changes made here are not saved back to the CRM.");
  return {
    id,
    summary: `${input.completed ? "✓ " : ""}Follow-up: ${input.customerName}`.slice(0, 200),
    description: lines.join("\n"),
    start: { dateTime: input.dueAt.toISOString() },
    end: { dateTime: end.toISOString() },
    status: "confirmed",
    transparency: input.completed ? "transparent" : "opaque",
    reminders: { useDefault: true },
    extendedProperties: { private: { whyteTaskId: input.taskId } },
  };
}
