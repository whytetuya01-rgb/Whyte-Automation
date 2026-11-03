import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { strictObject } from "@/lib/validation/common";
import { z } from "zod";
import { canConnectGoogle } from "@/lib/googleCalendar/connection";
import { kickCalendarSync } from "@/lib/googleCalendar/kick";
import { retryLinks } from "@/lib/googleCalendar/sync";

export const dynamic = "force-dynamic";

const schema = strictObject({ linkId: z.string().trim().min(1).max(200).optional() });

/**
 * POST /api/integrations/google-calendar/retry { linkId? } — puts the person's failed events, and events deleted in Google
 * that they want back, into the queue again. Only their own. Deleting an event in Google never changes the CRM follow-up;
 * this is the one way it comes back.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      if (!canConnectGoogle(role, permissions)) throw new ApiError("FORBIDDEN", "Google Calendar is for people who manage leads.");
      const input = schema.parse(await readJsonBody(req));
      const queued = await retryLinks(companyId, userId, { linkId: input.linkId });
      kickCalendarSync();
      return apiSuccess({ queued });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/integrations/google-calendar/retry" });
  }
}
