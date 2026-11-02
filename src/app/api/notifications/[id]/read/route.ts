import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { markNotificationRead } from "@/lib/notificationService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/notifications/[id]/read
 * Marks a single notification as read. Enforces strict user and company ownership.
 */
export async function PATCH(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ userId, companyId }) => {
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      const { id } = await context.params;
      const success = await markNotificationRead(companyId, userId, id);
      if (!success) {
        throw new ApiError("NOT_FOUND", "Notification not found or already read.");
      }

      return apiSuccess({ read: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/notifications/[id]/read" });
  }
}

