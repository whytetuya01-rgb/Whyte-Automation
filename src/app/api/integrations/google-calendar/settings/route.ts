import { z } from "zod";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { strictObject } from "@/lib/validation/common";
import { canConnectGoogle, updateSettings } from "@/lib/googleCalendar/connection";
import { kickCalendarSync } from "@/lib/googleCalendar/kick";

export const dynamic = "force-dynamic";

const schema = strictObject({ eventMinutes: z.number().int() });

/** PATCH /api/integrations/google-calendar/settings { eventMinutes } — how long each follow-up event lasts in Google. */
export async function PATCH(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      if (!canConnectGoogle(role, permissions)) throw new ApiError("FORBIDDEN", "Google Calendar is for people who manage leads.");
      const input = schema.parse(await readJsonBody(req));
      const saved = await updateSettings({ companyId, userId }, input);
      kickCalendarSync();
      return apiSuccess(saved);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/integrations/google-calendar/settings" });
  }
}
