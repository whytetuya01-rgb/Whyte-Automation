import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { uploadImage } from "@/lib/cloudinary";
import { companyBrandingFolder } from "@/lib/uploadPaths";
import { logoUploadError } from "@/lib/companyRegistration";
import { deleteOwnBrandingAsset, readValidatedLogo } from "@/lib/companyLogoAssets";
import { LOGO_SETTING_FIELDS, normalizeLogoSettings, parseLogoSettings } from "@/lib/logoSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function flag(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  if (value === null) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError("VALIDATION_ERROR", `"${key}" must be true or false.`, { field: key });
}

function optionalFile(formData: FormData, key: string): FormDataEntryValue | null {
  const value = formData.get(key);
  // An empty file input (size 0) means "no file chosen", like on registration.
  if (value instanceof File && value.size === 0) return null;
  if (typeof value === "string" && value !== "") throw new ApiError("VALIDATION_ERROR", "The logo must be an image file.", { field: key });
  return value instanceof File ? value : null;
}

/**
 * POST /api/company/logo  (multipart/form-data)
 *
 * Saves the CALLER'S company logo and its presentation in one atomic update. The company comes from the session
 * (for a Super Admin, the company they are acting as) and never from the request: a `companyId` field, or any other
 * unknown field, is ignored. Optional parts:
 *   logo / compactLogo                         a replacement image
 *   removeLogo / removeCompactLogo = "true"    explicit removal
 *   logoFit, logoBackground, logoPadding, logoRadius   bounded presentation settings
 * Replaced or removed files are deleted only after the update has succeeded, and only if they sit in this company's
 * own branding folder; files uploaded for a save that then fails are deleted again.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("company:edit", async (actor) => {
      const companyId = actor.companyId;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required to change the company logo.");
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload.");
      }
      // Only the fields below are read; anything else (a stray `companyId`, `id`, …) is ignored, never trusted.
      const logoEntry = optionalFile(formData, "logo");
      const compactEntry = optionalFile(formData, "compactLogo");
      const removeLogo = flag(formData, "removeLogo");
      const removeCompact = flag(formData, "removeCompactLogo");
      if (logoEntry && removeLogo) throw new ApiError("VALIDATION_ERROR", "Choose either a new logo or removal, not both.", { field: "logo" });
      if (compactEntry && removeCompact) throw new ApiError("VALIDATION_ERROR", "Choose either a new compact logo or removal, not both.", { field: "compactLogo" });

      const providedSettings = Object.fromEntries(
        LOGO_SETTING_FIELDS.filter((key) => formData.has(key)).map((key) => [key, formData.get(key)])
      );
      const hasSettings = Object.keys(providedSettings).length > 0;
      if (!logoEntry && !compactEntry && !removeLogo && !removeCompact && !hasSettings) {
        throw new ApiError("VALIDATION_ERROR", "Nothing to save: choose a logo, a removal or a logo setting.");
      }

      await connectMongoDB();
      const existing = await Company.findById(companyId).select("logoPublicId compactLogoPublicId logoSettings").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");

      const parsed = parseLogoSettings(providedSettings, normalizeLogoSettings(existing.logoSettings));
      if (!parsed.ok) throw new ApiError("VALIDATION_ERROR", parsed.message, { field: parsed.field });

      // Validate every file before anything is uploaded, so a bad second file cannot leave a first upload behind.
      const logo = logoEntry ? await readValidatedLogo(logoEntry, "logo") : null;
      const compact = compactEntry ? await readValidatedLogo(compactEntry, "compactLogo") : null;

      const uploadedIds: string[] = [];
      const set: Record<string, unknown> = { updatedAt: new Date() };
      try {
        if (logo) {
          const uploaded = await uploadImage(logo.buffer, companyBrandingFolder(companyId));
          uploadedIds.push(uploaded.publicId);
          set.logoUrl = uploaded.url;
          set.logoPublicId = uploaded.publicId;
        } else if (removeLogo) {
          set.logoUrl = null;
          set.logoPublicId = null;
        }
        if (compact) {
          const uploaded = await uploadImage(compact.buffer, companyBrandingFolder(companyId));
          uploadedIds.push(uploaded.publicId);
          set.compactLogoUrl = uploaded.url;
          set.compactLogoPublicId = uploaded.publicId;
        } else if (removeCompact || removeLogo) {
          // A compact logo without a main logo is never shown, so removing the logo removes it too.
          set.compactLogoUrl = null;
          set.compactLogoPublicId = null;
        }
      } catch (error) {
        for (const publicId of uploadedIds) await deleteOwnBrandingAsset(publicId, companyId);
        throw logoUploadError(error);
      }
      if (hasSettings || logo || compact) set.logoSettings = parsed.value;

      let company;
      try {
        company = await Company.findByIdAndUpdate(companyId, { $set: set }, { new: true }).lean();
      } catch (error) {
        for (const publicId of uploadedIds) await deleteOwnBrandingAsset(publicId, companyId);
        throw error;
      }
      if (!company) {
        for (const publicId of uploadedIds) await deleteOwnBrandingAsset(publicId, companyId);
        throw new ApiError("NOT_FOUND", "Company record not found.");
      }

      // Only now, with the new state saved, are the replaced / removed files deleted.
      if ("logoPublicId" in set) await deleteOwnBrandingAsset(existing.logoPublicId, companyId);
      if ("compactLogoPublicId" in set) await deleteOwnBrandingAsset(existing.compactLogoPublicId, companyId);

      return apiSuccess({
        logoUrl: company.logoUrl ?? null,
        logoPublicId: company.logoPublicId ?? null,
        compactLogoUrl: company.compactLogoUrl ?? null,
        logoSettings: normalizeLogoSettings(company.logoSettings),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/logo" });
  }
}

/** DELETE /api/company/logo — removes the caller's company logo and compact logo (the default Whyte branding shows again). */
export async function DELETE() {
  try {
    return await withPermission("company:edit", async (actor) => {
      const companyId = actor.companyId;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required to change the company logo.");
      }
      await connectMongoDB();
      const existing = await Company.findById(companyId).select("logoPublicId compactLogoPublicId").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");

      await Company.findByIdAndUpdate(companyId, {
        $set: { logoUrl: null, logoPublicId: null, compactLogoUrl: null, compactLogoPublicId: null, updatedAt: new Date() },
      });
      await deleteOwnBrandingAsset(existing.logoPublicId, companyId);
      await deleteOwnBrandingAsset(existing.compactLogoPublicId, companyId);
      return apiSuccess({ logoUrl: null, logoPublicId: null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/company/logo" });
  }
}
