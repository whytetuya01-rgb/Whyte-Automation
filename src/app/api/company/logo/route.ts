import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { readValidatedImage } from "@/lib/imageUpload";
import { deleteImage, uploadImage } from "@/lib/cloudinary";
import { companyBrandingFolder, isOwnBrandingAsset } from "@/lib/uploadPaths";
import { logoUploadError } from "@/lib/companyRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Removes an old logo file, but only one that sits in this company's own branding folder. Never throws. */
async function deleteOwnLogoAsset(publicId: string | null | undefined, companyId: number): Promise<void> {
  if (!publicId || !isOwnBrandingAsset(publicId, companyId)) return;
  try {
    await deleteImage(publicId);
  } catch (error) {
    console.error("[company-logo] Could not delete a replaced logo asset:", error instanceof Error ? error.message : "unknown error");
  }
}

/**
 * POST /api/company/logo  (multipart/form-data, field "logo")
 *
 * Replaces the logo of the CALLER'S company. The company comes from the session (for a Super Admin, the company
 * they are acting as) and never from the request, so one company can never write another's logo.
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
      const { buffer } = await readValidatedImage(formData.get("logo"), "logo");

      await connectMongoDB();
      const existing = await Company.findById(companyId).select("logoPublicId").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");

      let uploaded;
      try {
        uploaded = await uploadImage(buffer, companyBrandingFolder(companyId));
      } catch (error) {
        throw logoUploadError(error);
      }

      let company;
      try {
        company = await Company.findByIdAndUpdate(
          companyId,
          { $set: { logoUrl: uploaded.url, logoPublicId: uploaded.publicId, updatedAt: new Date() } },
          { new: true }
        ).lean();
      } catch (error) {
        await deleteOwnLogoAsset(uploaded.publicId, companyId);
        throw error;
      }
      if (!company) {
        await deleteOwnLogoAsset(uploaded.publicId, companyId);
        throw new ApiError("NOT_FOUND", "Company record not found.");
      }

      await deleteOwnLogoAsset(existing.logoPublicId, companyId);
      return apiSuccess({ logoUrl: company.logoUrl ?? null, logoPublicId: company.logoPublicId ?? null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/logo" });
  }
}

/** DELETE /api/company/logo — removes the caller's company logo (the platform default branding shows again). */
export async function DELETE() {
  try {
    return await withPermission("company:edit", async (actor) => {
      const companyId = actor.companyId;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required to change the company logo.");
      }
      await connectMongoDB();
      const existing = await Company.findById(companyId).select("logoPublicId").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");

      await Company.findByIdAndUpdate(companyId, { $set: { logoUrl: null, logoPublicId: null, updatedAt: new Date() } });
      await deleteOwnLogoAsset(existing.logoPublicId, companyId);
      return apiSuccess({ logoUrl: null, logoPublicId: null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/company/logo" });
  }
}
