import { NextResponse } from "next/server";
import { withSession } from "@/lib/api-auth";
import { googleCalendarConfig } from "@/lib/googleCalendar/config";
import { canConnectGoogle, completeConnect } from "@/lib/googleCalendar/connection";
import { kickCalendarSync } from "@/lib/googleCalendar/kick";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/google-calendar/callback?code=&state= — where Google sends the browser back. It only works for the
 * person who started the connection (the one-time state is bound to them) and always ends on the My account page with
 * ?google=connected or ?google=<reason>. The code and state are never shown or logged.
 */
export async function GET(req: Request) {
  const config = googleCalendarConfig();
  const base = config.redirectUri || req.url;
  const back = (outcome: string) => NextResponse.redirect(new URL(`/admin/account?google=${encodeURIComponent(outcome)}`, base), { status: 303 });
  try {
    const params = new URL(req.url).searchParams;
    return await withSession(async ({ role, permissions, companyId, userId }) => {
      if (!companyId || !canConnectGoogle(role, permissions)) return back("forbidden");
      const result = await completeConnect({ companyId, userId }, { code: params.get("code"), state: params.get("state"), error: params.get("error") });
      if (result.ok) kickCalendarSync();
      return back(result.ok ? "connected" : result.reason);
    });
  } catch {
    return back("session");
  }
}
