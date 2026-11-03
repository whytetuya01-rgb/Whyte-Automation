import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { beginConnect, canConnectGoogle } from "@/lib/googleCalendar/connection";

export const dynamic = "force-dynamic";

/** POST /api/integrations/google-calendar/connect — { url }: where to send the person to approve access in Google. */
export async function POST() {
  try {
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      if (!canConnectGoogle(role, permissions)) throw new ApiError("FORBIDDEN", "Google Calendar is for people who manage leads.");
      return apiSuccess(await beginConnect({ companyId, userId }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/integrations/google-calendar/connect" });
  }
}
