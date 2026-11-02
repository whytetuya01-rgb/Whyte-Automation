import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { markAllNotificationsRead } from "@/lib/notificationService";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/mark-all-read
 * Marks all unread notifications as read for the current authenticated user in their company.
 */
export async function POST() {
  try {
    return await withSession(async ({ userId, companyId }) => {
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      const markedCount = await markAllNotificationsRead(companyId, userId);
      return apiSuccess({ markedCount });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/notifications/mark-all-read" });
  }
}

