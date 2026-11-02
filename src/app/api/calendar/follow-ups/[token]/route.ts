import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, CalendarFeed } from "@/models";
import { getSessionActor } from "@/lib/sessionGuard";
import { hasPermission } from "@/lib/permissions";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { baseUrlFor, FEED_TOKEN_PATTERN, hashFeedToken, loadFollowUpEvents } from "@/lib/calendarFeedService";
import { buildFollowUpCalendar } from "@/lib/followUps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

/** Every failure looks the same, so nobody can tell a wrong link from a switched-off one. */
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/**
 * GET /api/calendar/follow-ups/<secret>.ics — a person's private follow-up calendar, opened by a calendar app without a
 * login. The secret in the link is the only credential. The calendar contains what that person may see in the CRM right
 * now: if they were deactivated, their company suspended, or they lost the permission, the link stops working.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { limited } = checkRateLimit(`calendar-feed:${clientIpFromRequest(req)}`, { max: 120, windowMs: 10 * 60 * 1000 });
    if (limited) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "600" } });

    const raw = (await context.params).token;
    if (!raw.endsWith(".ics")) return notFound();
    const token = raw.slice(0, -4);
    if (!FEED_TOKEN_PATTERN.test(token)) return notFound();

    await connectMongoDB();
    const feed = await runUnscoped("public-calendar-feed", async () =>
      await CalendarFeed.findOne({ tokenHash: hashFeedToken(token) }).select("_id companyId userId lastFetchedAt").lean()
    );
    if (!feed) return notFound();

    const user = await runUnscoped("public-calendar-feed", async () =>
      await AdminUser.findOne({ _id: feed.userId, companyId: feed.companyId }).select("role isActive name").lean()
    );
    if (!user || user.isActive === false) return notFound();

    // The same current-permissions check every signed-in request goes through (also covers a suspended company).
    const actor = await getSessionActor(feed.userId, user.role);
    if (!actor?.valid) return notFound();
    if (actor.companyId !== null && actor.companyId !== feed.companyId) return notFound();
    if (!hasPermission(user.role, actor.permissions, "leads:read")) return notFound();

    const baseUrl = baseUrlFor(req);
    const events = await runWithTenantContext(
      { companyId: feed.companyId, userId: feed.userId, role: user.role, actingAsCompany: user.role === "super_admin" },
      async () => {
        const found = await loadFollowUpEvents({ companyId: feed.companyId, userId: feed.userId, role: user.role, baseUrl });
        // Remember when it was last used (at most every 10 minutes) so the person can see that it works.
        if (!feed.lastFetchedAt || Date.now() - new Date(feed.lastFetchedAt).getTime() > 10 * 60 * 1000) {
          await CalendarFeed.updateOne({ _id: feed._id }, { $set: { lastFetchedAt: new Date() }, $inc: { fetchCount: 1 } }).catch(() => undefined);
        }
        return found;
      }
    );

    const body = buildFollowUpCalendar(events, { calendarName: "Lead follow-ups" });
    return new NextResponse(req.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="follow-ups.ics"',
        // Calendar apps poll; a short private cache is enough, and the page must never be indexed or shared.
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[calendar-feed] Could not build the calendar:", error instanceof Error ? error.message : "unknown error");
    return new NextResponse("Something went wrong", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const HEAD = GET;
