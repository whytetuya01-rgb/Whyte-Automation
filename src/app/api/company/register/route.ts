import { NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/api-response";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { readValidatedLogo } from "@/lib/companyLogoAssets";
import { LOGO_SETTING_FIELDS, parseLogoSettings } from "@/lib/logoSettings";
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

    // Both logos are optional: an absent field or an empty file input means "none". Files must be real, validated
    // uploads (never a URL), and the presentation settings are strictly parsed.
    const readOptionalLogo = async (key: "logo" | "compactLogo") => {
      const entry = formData.get(key);
      if (entry instanceof File) return entry.size > 0 ? await readValidatedLogo(entry, key) : null;
      if (typeof entry === "string" && entry !== "") {
        throw new ApiError("VALIDATION_ERROR", "The logo must be an image file.", { field: key });
      }
      return null;
    };
    const logo = await readOptionalLogo("logo");
    const compactLogo = await readOptionalLogo("compactLogo");
    const settings = parseLogoSettings(Object.fromEntries(LOGO_SETTING_FIELDS.filter((key) => formData.has(key)).map((key) => [key, formData.get(key)])));
    if (!settings.ok) throw new ApiError("VALIDATION_ERROR", settings.message, { field: settings.field });
    if (compactLogo && !logo) {
      throw new ApiError("VALIDATION_ERROR", "Add the main company logo before a compact sidebar logo.", { field: "compactLogo" });
    }

    const company = await registerCompany(parsed.data, logo, { compactLogo, settings: settings.value });

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
