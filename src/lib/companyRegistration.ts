import bcrypt from "bcryptjs";
import { z } from "zod";
import type { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { getNextSequence } from "@/lib/counter";
import { AdminUser, Company } from "@/models";
import { runUnscoped } from "@/lib/tenant/context";
import { withTransaction } from "@/lib/transaction";
import { ApiError } from "@/lib/api-response";
import { emailSchema, optionalPhoneSchema, phoneSchema } from "@/lib/validation/fields";
import { CloudinaryAuthError, CloudinaryConfigError, deleteImage, uploadImage } from "@/lib/cloudinary";
import { companyBrandingFolder } from "@/lib/uploadPaths";

/**
 * Public company self-registration: one new tenant (Company) plus its first Company Owner account.
 *
 * Nothing in the request chooses the role, the company id, the status or any permission: the owner is always created
 * as `company_owner` of the company created in this same call, and the company starts `pending` (the platform's
 * existing self-registration state). Every untrusted field is validated by `companyRegistrationSchema`, which is
 * strict, so an unexpected key such as `role` or `companyId` is rejected rather than ignored.
 */

const noControlChars = (label: string) => (value: string) =>
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || `${label} contains invalid characters.`;

export const companyRegistrationSchema = z
  .object({
    companyName: z
      .string({ message: "Company name is required." })
      .trim()
      .min(2, "Company name must be at least 2 characters.")
      .max(120, "Company name must be 120 characters or fewer.")
      .refine((v) => noControlChars("Company name")(v) === true, "Company name contains invalid characters."),
    companyEmail: emailSchema,
    companyPhone: phoneSchema,
    companyAddress: z
      .string({ message: "Company address is required." })
      .trim()
      .min(5, "Company address must be at least 5 characters.")
      .max(500, "Company address must be 500 characters or fewer.")
      .refine((v) => noControlChars("Company address")(v) === true, "Company address contains invalid characters."),
    ownerName: z
      .string({ message: "Owner full name is required." })
      .trim()
      .min(2, "Owner full name must be at least 2 characters.")
      .max(100, "Owner full name must be 100 characters or fewer.")
      .refine((v) => noControlChars("Owner name")(v) === true, "Owner name contains invalid characters."),
    ownerEmail: emailSchema,
    ownerPhone: optionalPhoneSchema,
    password: z
      .string({ message: "Password is required." })
      .min(8, "Password must be at least 8 characters.")
      .refine((v) => new TextEncoder().encode(v).length <= 72, "Password must be 72 bytes or fewer."),
    confirmPassword: z.string({ message: "Confirm your password." }),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type CompanyRegistrationInput = z.infer<typeof companyRegistrationSchema>;

/** A form-data entry other than the logo must be plain text; anything else is refused up front. */
export function formDataToFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "logo") continue;
    if (typeof value !== "string") {
      throw new ApiError("VALIDATION_ERROR", `Unexpected file in field "${key}".`, { field: key });
    }
    fields[key] = value;
  }
  return fields;
}

/** URL-safe company slug derived from the name ("Acme Smart Homes Pvt. Ltd." -> "acme-smart-homes-pvt-ltd"). */
export function slugifyCompanyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitOwnerName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

interface LogoFile {
  buffer: Buffer;
  mime: string;
}

export interface RegisteredCompany {
  companyId: number;
  slug: string;
  name: string;
  status: string;
  ownerId: number;
  ownerEmail: string;
  logoUrl: string | null;
}

const LOGO_UNAVAILABLE = "Logo upload is not available right now. Please try again, or register without a logo and add it later.";
const LOGO_FAILED = "The logo could not be uploaded. Please try again, or register without a logo and add it later.";

/** Maps an uploader failure to a safe, field-level error. Vendor text is never forwarded (it can echo the API key). */
export function logoUploadError(error: unknown): ApiError {
  if (error instanceof CloudinaryConfigError) {
    console.error(`[company-registration] Cloudinary is not configured: ${error.missing.join(", ")}`);
    return new ApiError("INTERNAL_SERVER_ERROR", LOGO_UNAVAILABLE, { field: "logo" });
  }
  if (error instanceof CloudinaryAuthError) {
    console.error(`[company-registration] Cloudinary rejected the configured credentials (HTTP ${error.httpCode ?? "?"}).`);
    return new ApiError("INTERNAL_SERVER_ERROR", LOGO_UNAVAILABLE, { field: "logo" });
  }
  console.error("[company-registration] Logo upload failed:", error instanceof Error ? error.message : "unknown error");
  return new ApiError("INTERNAL_SERVER_ERROR", LOGO_FAILED, { field: "logo" });
}

/**
 * Registers a company and its Company Owner. Order matters for cleanup:
 *   1. duplicate checks (cheap, nothing created yet)
 *   2. reserve the company id
 *   3. upload the logo (a failure here leaves nothing behind but a skipped id)
 *   4. create company + owner (one transaction where the database supports it)
 * If step 4 fails the uploaded asset is deleted, and on a standalone database (no transactions) a company created
 * moments earlier is removed again, so a failed registration never leaves a half-registered tenant or an orphan file.
 */
export async function registerCompany(input: CompanyRegistrationInput, logo: LogoFile | null): Promise<RegisteredCompany> {
  await connectMongoDB();

  const slug = slugifyCompanyName(input.companyName);
  if (!slug) {
    throw new ApiError("VALIDATION_ERROR", "Company name must contain letters or numbers.", { field: "companyName" });
  }
  const { firstName, lastName } = splitOwnerName(input.ownerName);

  return runUnscoped("public-registration", async () => {
    // AdminUser.email is globally unique (login has no company field), so the owner check spans every company.
    if (await AdminUser.exists({ email: input.ownerEmail })) {
      throw new ApiError("DUPLICATE_RECORD", "An account with this email already exists.", { field: "ownerEmail" });
    }
    if (await Company.exists({ email: new RegExp(`^${escapeRegExp(input.companyEmail)}$`, "i") })) {
      throw new ApiError("DUPLICATE_RECORD", "A company with this email is already registered.", { field: "companyEmail" });
    }
    if (await Company.exists({ slug })) {
      throw new ApiError("DUPLICATE_RECORD", "A company with this name is already registered.", { field: "companyName" });
    }

    const companyId = await getNextSequence("company", Company);

    let logoUrl: string | null = null;
    let logoPublicId: string | null = null;
    if (logo) {
      try {
        const uploaded = await uploadImage(logo.buffer, companyBrandingFolder(companyId));
        logoUrl = uploaded.url;
        logoPublicId = uploaded.publicId;
      } catch (error) {
        throw logoUploadError(error);
      }
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const ownerId = await getNextSequence("adminUser", AdminUser);
    let companyCreated = false;

    try {
      await withTransaction(async (session?: ClientSession) => {
        await new Company({
          _id: companyId,
          name: input.companyName,
          slug,
          status: "pending",
          registrationStatus: "pending_review",
          registrationSubmittedAt: new Date(),
          phone: input.companyPhone,
          email: input.companyEmail,
          address: input.companyAddress,
          logoUrl,
          logoPublicId,
        }).save({ session });
        companyCreated = true;

        await new AdminUser({
          _id: ownerId,
          companyId,
          email: input.ownerEmail,
          passwordHash,
          name: input.ownerName,
          firstName,
          lastName,
          companyName: input.companyName,
          contactNumber: input.ownerPhone ?? null,
          address: input.companyAddress,
          role: "company_owner",
          isActive: true,
        }).save({ session });
      });
    } catch (error) {
      // Compensate: the asset first (it is the part nothing else would ever clean up), then a company that exists
      // without its owner. `Company` blocks hard deletes on purpose; this removes only the row created a moment ago
      // by this very call, through the native collection, and only when the owner row was not written.
      if (logoPublicId) {
        try {
          await deleteImage(logoPublicId);
        } catch (cleanupError) {
          console.error(
            "[company-registration] Could not delete the uploaded logo after a failed registration:",
            cleanupError instanceof Error ? cleanupError.message : "unknown error"
          );
        }
      }
      if (companyCreated && !(await AdminUser.exists({ _id: ownerId }))) {
        await Company.collection.deleteOne({ _id: companyId as unknown as never });
      }
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000) {
        const key = Object.keys((error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
        throw new ApiError(
          "DUPLICATE_RECORD",
          key === "slug" ? "A company with this name is already registered." : "An account with this email already exists.",
          { field: key === "slug" ? "companyName" : "ownerEmail" }
        );
      }
      throw error;
    }

    return { companyId, slug, name: input.companyName, status: "pending_review", ownerId, ownerEmail: input.ownerEmail, logoUrl };
  });
}
