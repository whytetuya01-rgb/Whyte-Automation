import { z } from "zod";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { strictObject } from "@/lib/validation/common";
import { canConnectGoogle, disconnect } from "@/lib/googleCalendar/connection";

export const dynamic = "force-dynamic";

const schema = strictObject({ deleteCalendar: z.boolean().optional() });

/**
 * POST /api/integrations/google-calendar/disconnect { deleteCalendar? } — ends the connection: Google is told to forget the
 * access, the stored tokens are erased and the queue is cleared. The "Whyte CRM Follow-ups" calendar is deleted only when
 * asked. CRM follow-ups are not touched.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      if (!canConnectGoogle(role, permissions)) throw new ApiError("FORBIDDEN", "Google Calendar is for people who manage leads.");
      const input = schema.parse(await readJsonBody(req));
      return apiSuccess(await disconnect({ companyId, userId }, { deleteCalendar: input.deleteCalendar === true }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/integrations/google-calendar/disconnect" });
  }
}
