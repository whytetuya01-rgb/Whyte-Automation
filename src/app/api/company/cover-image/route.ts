import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { uploadImage } from "@/lib/cloudinary";
import { companyBrandingFolder } from "@/lib/uploadPaths";
import { logoUploadError } from "@/lib/companyRegistration";
import { deleteOwnBrandingAsset } from "@/lib/companyLogoAssets";
import { readValidatedImage } from "@/lib/imageUpload";
import { readImageDimensions } from "@/lib/imageDimensions";
import { COVER_IMAGE_SPEC, coverImageProblem } from "@/lib/coverImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/company/cover-image (multipart/form-data, field "coverImage") — the cover picture of the CALLER'S
 * company's quotation documents. The company comes from the session (for a Super Admin, the company being acted as),
 * never from the request. The file is validated (type, real bytes, size, pixel size, proportions), stored in the
 * company's own branding folder, and the previous picture is deleted only after the new one is saved.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("company:edit", async (actor) => {
      const companyId = actor.companyId;
      if (!companyId) throw new ApiError("FORBIDDEN", "An active company context is required to change the cover image.");

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload.");
      }
      const image = await readValidatedImage(formData.get("coverImage"), "coverImage", { maxBytes: COVER_IMAGE_SPEC.maxBytes });
      const size = readImageDimensions(image.buffer, image.mime);
      if (!size) throw new ApiError("VALIDATION_ERROR", "The image could not be read. Please upload a different file.", { field: "coverImage" });
      const problem = coverImageProblem(size);
      if (problem) throw new ApiError("VALIDATION_ERROR", problem, { field: "coverImage", details: size });

      await connectMongoDB();
      const existing = await Company.findById(companyId).select("coverImagePublicId").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");

      let uploaded;
      try {
        uploaded = await uploadImage(image.buffer, companyBrandingFolder(companyId));
      } catch (error) {
        throw logoUploadError(error);
      }
      const company = await Company.findByIdAndUpdate(
        companyId,
        { $set: { coverImageUrl: uploaded.url, coverImagePublicId: uploaded.publicId, updatedAt: new Date() } },
        { returnDocument: "after" }
      )
        .select("coverImageUrl")
        .lean()
        .catch(async (error) => {
          await deleteOwnBrandingAsset(uploaded.publicId, companyId);
          throw error;
        });
      if (!company) {
        await deleteOwnBrandingAsset(uploaded.publicId, companyId);
        throw new ApiError("NOT_FOUND", "Company record not found.");
      }
      await deleteOwnBrandingAsset(existing.coverImagePublicId, companyId);
      return apiSuccess({ coverImageUrl: company.coverImageUrl ?? null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/company/cover-image" });
  }
}

/** DELETE /api/company/cover-image — removes the caller's company cover picture. */
export async function DELETE() {
  try {
    return await withPermission("company:edit", async (actor) => {
      const companyId = actor.companyId;
      if (!companyId) throw new ApiError("FORBIDDEN", "An active company context is required to change the cover image.");
      await connectMongoDB();
      const existing = await Company.findById(companyId).select("coverImagePublicId").lean();
      if (!existing) throw new ApiError("NOT_FOUND", "Company record not found.");
      await Company.findByIdAndUpdate(companyId, { $set: { coverImageUrl: null, coverImagePublicId: null, updatedAt: new Date() } });
      await deleteOwnBrandingAsset(existing.coverImagePublicId, companyId);
      return apiSuccess({ coverImageUrl: null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/company/cover-image" });
  }
}
