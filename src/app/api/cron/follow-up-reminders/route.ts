import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runFollowUpReminderDigest } from "@/lib/followUpReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * GET or POST /api/cron/follow-up-reminders — sends the morning follow-up email (follow-ups due today and overdue) to each
 * person who owns some, once per day per person. Called by a scheduler, never by a person: it answers only to
 * `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends when CRON_SECRET is set). With no CRON_SECRET configured it
 * refuses everything, so it can never run open.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "The reminder job is not configured." } }, { status: 503 });
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Not allowed." } }, { status: 401 });
  }
  const result = await runFollowUpReminderDigest({ budgetMs: 50_000 });
  return NextResponse.json({ success: true, data: result });
}

export const GET = handle;
export const POST = handle;
