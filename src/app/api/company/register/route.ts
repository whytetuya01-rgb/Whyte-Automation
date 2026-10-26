import { NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/api-response";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { readValidatedImage } from "@/lib/imageUpload";
import { companyRegistrationSchema, formDataToFields, registerCompany } from "@/lib/companyRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint that creates a tenant: throttled per IP like dealer self-registration.
// The cap is tunable per deployment (COMPANY_REGISTER_RATE_LIMIT_MAX); the default is deliberately strict.
function registerRateLimit(): { max: number; windowMs: number } {
  const configured = Number(process.env.COMPANY_REGISTER_RATE_LIMIT_MAX);
  return { max: Number.isInteger(configured) && configured > 0 ? configured : 20, windowMs: 15 * 60 * 1000 };
}

/**
 * POST /api/company/register  (multipart/form-data)
 *
 * Creates a new company and its first Company Owner. The body can never choose the role, company id, status or
 * permissions: the schema is strict (unknown keys are refused) and the service assigns `company_owner` of the
 * company it creates in the same call. The optional `logo` file is validated here (size, type, real bytes) and
 * stored under the new company's own Cloudinary folder.
 */
export async function POST(request: Request) {
  try {
    const { limited, retryAfterSeconds } = checkRateLimit(`company-register:${clientIpFromRequest(request)}`, registerRateLimit());
    if (limited) {
      throw new ApiError("RATE_LIMITED", "Too many registration attempts. Please try again later.", {
        details: { retryAfterSeconds },
      });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data submission.");
    }

    const parsed = companyRegistrationSchema.safeParse(formDataToFields(formData));
    if (!parsed.success) return handleApiError(parsed.error, { logPrefix: "POST /api/company/register" });

    // The logo is optional: an absent field or an empty file input means "no logo".
    const logoEntry = formData.get("logo");
    let logo: { buffer: Buffer; mime: string } | null = null;
    if (logoEntry instanceof File) {
      if (logoEntry.size > 0) logo = await readValidatedImage(logoEntry, "logo");
    } else if (typeof logoEntry === "string" && logoEntry !== "") {
      throw new ApiError("VALIDATION_ERROR", "The logo must be an image file.", { field: "logo" });
    }

    const company = await registerCompany(parsed.data, logo);

    return NextResponse.json(
      {
        success: true,
        data: {
          companyId: company.companyId,
          name: company.name,
          status: company.status,
          ownerEmail: company.ownerEmail,
          logoUrl: company.logoUrl,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/register" });
  }
}
