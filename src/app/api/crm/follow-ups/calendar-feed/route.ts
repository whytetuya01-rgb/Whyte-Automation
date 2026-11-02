import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rateLimit";
import { baseUrlFor, disableFeed, enableFeed, getFeedState } from "@/lib/calendarFeedService";

export const dynamic = "force-dynamic";

/**
 * The caller's own private follow-up calendar link (Google Calendar → "From URL"). Anyone who may view leads can have
 * one; it shows only the leads they can see in the CRM, and each person manages only their own.
 *   GET     the current state (and the link, if on)
 *   POST    turn it on, or generate a new link (the old link stops working at once)
 *   DELETE  turn it off (the link stops working)
 */
async function actorOf<T>(fn: (actor: { companyId: number; userId: number }) => Promise<T>): Promise<T> {
  return withSession(async ({ role, userId, permissions, companyId }) => {
    if (!hasPermission(role, permissions, "leads:read")) throw new ApiError("FORBIDDEN", "You do not have permission to use the follow-up calendar.");
    if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
    return fn({ companyId, userId });
  });
}

export async function GET(req: Request) {
  try {
    return await actorOf(async ({ companyId, userId }) => apiSuccess(await getFeedState(companyId, userId, baseUrlFor(req))));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/follow-ups/calendar-feed" });
  }
}

export async function POST(req: Request) {
  try {
    return await actorOf(async ({ companyId, userId }) => {
      const { limited } = checkRateLimit(`calendar-feed-create:${companyId}:${userId}`, { max: 10, windowMs: 10 * 60 * 1000 });
      if (limited) throw new ApiError("RATE_LIMITED", "Too many link changes. Please try again in a few minutes.");
      return apiSuccess(await enableFeed(companyId, userId, baseUrlFor(req)), { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/follow-ups/calendar-feed" });
  }
}

export async function DELETE(req: Request) {
  try {
    return await actorOf(async ({ companyId, userId }) => {
      await disableFeed(companyId, userId);
      return apiSuccess(await getFeedState(companyId, userId, baseUrlFor(req)));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/crm/follow-ups/calendar-feed" });
  }
}
