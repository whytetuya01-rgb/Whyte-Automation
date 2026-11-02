import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { getUserNotifications } from "@/lib/notificationService";
import { parseIntQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications
 * Lists the authenticated user's notifications within their active company.
 * Automatically synchronizes due and overdue follow-up tasks lazily.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ userId, companyId }) => {
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      const { searchParams } = new URL(req.url);
      const unreadOnly = searchParams.get("unreadOnly") === "true";
      const limit = parseIntQueryParam(searchParams, "limit", { defaultValue: 20, min: 1, max: 50 });
      const skip = parseIntQueryParam(searchParams, "skip", { defaultValue: 0, min: 0 });

      const result = await getUserNotifications(companyId, userId, {
        unreadOnly,
        limit,
        skip,
      });

      return apiSuccess(result);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/notifications" });
  }
}

