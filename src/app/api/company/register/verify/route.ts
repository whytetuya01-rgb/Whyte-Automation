import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { verifyOwnerEmail } from "@/lib/ownerEmailVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/company/register/verify  { token }
 * Public: the company owner opens the emailed link. Only a token whose hash is stored on a registration works.
 */
export async function POST(request: Request) {
  try {
    const { limited, retryAfterSeconds } = checkRateLimit(`company-verify:${clientIpFromRequest(request)}`, { max: 30, windowMs: 15 * 60 * 1000 });
    if (limited) throw new ApiError("RATE_LIMITED", "Too many attempts. Please try again later.", { details: { retryAfterSeconds } });
    const body = (await readJsonBody(request)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    return apiSuccess(await verifyOwnerEmail(token));
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/register/verify" });
  }
}
