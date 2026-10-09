import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { getNextSequence } from "@/lib/counter";
import { ApiError, handleApiError, readJsonBody } from "@/lib/api-response";
import { AdminUser } from "@/models";
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
    const rateLimitKey = `register:${clientIpFromRequest(request)}`;
    const { limited, retryAfterSeconds } = checkRateLimit(rateLimitKey, REGISTER_RATE_LIMIT);
    if (limited) {
      throw new ApiError("RATE_LIMITED", "Too many registration attempts. Please try again later.", {
        details: { retryAfterSeconds },
      });
    }

    const parsed = registrationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return handleApiError(parsed.error, { logPrefix: "POST /api/admin/register" });

    await connectMongoDB();
    const { firstName, lastName, email, password, companyName, gstNumber, contactNumber, address } = parsed.data;

    if (await AdminUser.exists({ email })) {
      throw new ApiError("DUPLICATE_RECORD", "An account with this email already exists.", { field: "email" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = await getNextSequence("adminUser", AdminUser);
    const name = `${firstName} ${lastName}`;
    const account = new AdminUser({
      _id: id,
      name,
      firstName,
      lastName,
      email,
      passwordHash,
      companyName,
      gstNumber,
      contactNumber,
      address,
      role: "dealer",
      isActive: true,
    });
    await account.save();

    // Fire only after the account is durably saved. Failures here must never
    // fail registration itself — email delivery is a side effect, not a
    // precondition of a successful account creation.
    try {
      const loginUrl = new URL("/login", process.env.NEXTAUTH_URL || "http://localhost:3000").toString();
      const email_ = renderDealerRegistrationSuccessEmail({
        firstName,
        dealerName: name,
        dealerId: String(account._id),
        email: account.email,
        phone: account.contactNumber,
        companyName: account.companyName,
        registrationDate: new Date(account.createdAt).toLocaleDateString("en-IN", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        loginUrl,
        supportEmail: process.env.EMAIL_SUPPORT_ADDRESS || "support@whyte.co.in",
      });
      await sendEmail({ to: account.email, subject: email_.subject, html: email_.html, text: email_.text });
    } catch (emailError) {
      console.error("POST /api/admin/register: failed to send dealer registration email", emailError);
    }

    // Notify super admins of the new dealer's login credentials. Separate
    // try/catch so a failure here never affects the dealer-facing email
    // above or the registration response. The raw `password` only ever
    // exists in-memory for this request and is never logged.
    try {
      const superAdmins = await AdminUser.find({ role: "super_admin", isActive: true })
        .select("email")
        .lean<{ email: string }[]>();
      if (superAdmins.length === 0) {
        console.warn("POST /api/admin/register: no active super_admin found to notify of new dealer registration");
      } else {
        const adminPanelUrl = new URL("/admin/dealers", process.env.NEXTAUTH_URL || "http://localhost:3000").toString();
        const notice = renderDealerRegistrationAdminNoticeEmail({
          dealerId: String(account._id),
          dealerName: name,
          username: account.email,
          password,
          contactNumber: account.contactNumber,
          registrationDate: new Date(account.createdAt).toLocaleDateString("en-IN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          adminPanelUrl,
        });
        await Promise.all(
          superAdmins.map((admin) =>
            sendEmail({ to: admin.email, subject: notice.subject, html: notice.html, text: notice.text })
          )
        );
      }
    } catch (adminNoticeError) {
      console.error("POST /api/admin/register: failed to send super admin notification email", adminNoticeError);
    }

    return NextResponse.json(
      { success: true, data: { id: account._id, name: account.name, email: account.email, role: account.role } },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/register" });
  }
}
