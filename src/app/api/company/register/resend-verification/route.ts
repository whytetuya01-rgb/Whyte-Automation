import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { emailSchema } from "@/lib/validation/fields";
import { reissueVerificationForEmail } from "@/lib/ownerEmailVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/company/register/resend-verification  { email }
 * Public. Always answers the same way, so it cannot be used to learn which emails are registered.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const parsed = emailSchema.safeParse(((await readJsonBody(request)) as { email?: unknown } | null)?.email);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Enter a valid email address.", { field: "email" });
    const perIp = checkRateLimit(`company-verify-resend:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
    const perEmail = checkRateLimit(`company-verify-resend:${parsed.data}`, { max: 3, windowMs: 15 * 60 * 1000 });
    if (perIp.limited || perEmail.limited) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Please try again later.", { details: { retryAfterSeconds: Math.max(perIp.retryAfterSeconds, perEmail.retryAfterSeconds) } });
    }
    await reissueVerificationForEmail(parsed.data);
    return apiSuccess({ message: "If a registration is waiting for this email to be verified, a new link is on its way." });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/register/resend-verification" });
  }
}
