import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canConnectGoogle, getStatus } from "@/lib/googleCalendar/connection";

export const dynamic = "force-dynamic";

/** GET /api/integrations/google-calendar/status — the signed-in person's own Google connection and sync state. */
export async function GET() {
  try {
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      if (!canConnectGoogle(role, permissions)) throw new ApiError("FORBIDDEN", "Google Calendar is for people who manage leads.");
      return apiSuccess(await getStatus({ companyId, userId }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/integrations/google-calendar/status" });
  }
}
