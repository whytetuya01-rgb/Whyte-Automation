import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { getNextSequence } from "@/lib/counter";
import { ApiError, handleApiError, readJsonBody } from "@/lib/api-response";
import { AdminUser, Company } from "@/models";
import { runUnscoped } from "@/lib/tenant/context";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";
import { emailSchema, mobileSchema, gstinSchema } from "@/lib/validation/fields";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email/service";
import { renderDealerRegistrationSuccessEmail } from "@/lib/email/templates/dealer-registration-success";
import { renderDealerRegistrationAdminNoticeEmail } from "@/lib/email/templates/dealer-registration-admin-notice";

export const runtime = "nodejs";

// Public, unauthenticated endpoint: throttle per-IP so it cannot be used to
// mass-create accounts or as a password/email enumeration oracle.
const REGISTER_RATE_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

const registrationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60, "First name must be 60 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "First name contains invalid characters."),
  lastName: z.string().trim().min(1, "Last name is required.").max(60, "Last name must be 60 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Last name contains invalid characters."),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters.")
    .refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be 72 bytes or fewer."),
  companyName: z.string().trim().min(1, "Company name is required.").max(120, "Company name must be 120 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Company name contains invalid characters."),
  gstNumber: gstinSchema,
  contactNumber: mobileSchema,
  address: z.string().trim().min(1, "Company address is required.").max(500, "Company address must be 500 characters or fewer.")
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Company address contains invalid characters."),
}).strict();

export async function POST(request: Request) {
  try {
    throw new ApiError(
      "FORBIDDEN",
      "Dealer self-registration is discontinued. Dealer accounts must be provisioned directly by an administrator from the Dealer Management screen.",
      { status: 403 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/register" });
  }
}
