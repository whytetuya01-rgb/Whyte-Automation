import { writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import {
  uploadImage,
  deleteImage,
  getMissingCloudinaryEnvVars,
} from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/templates/upload
 * Multi-tenant secure upload for template assets and workflow field attachments.
 * Validates tenant ownership, MIME types, size limits, and sanitizes filenames.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload.");
      }

      const file = formData.get("file");
      if (!file || typeof file === "string" || !(file instanceof Blob)) {
        throw new ApiError("VALIDATION_ERROR", "A valid file is required.");
      }

      // 1. Validate File Size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `File size exceeds maximum allowed limit of 10MB (file is ${(file.size / (1024 * 1024)).toFixed(2)}MB).`
        );
      }

      // 2. Validate MIME Type
      const mimeType = (file.type || "").toLowerCase().trim();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Unsupported file type "${mimeType || "unknown"}". Allowed types: JPG, PNG, WEBP, SVG, PDF.`
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const rawName = (file as any).name || "upload";
      const sanitizedBase = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const timestamp = Date.now();
      const uniqueName = `${timestamp}_${sanitizedBase}`;

      // 3. Persistent Storage Resolution
      const missingCloudinary = getMissingCloudinaryEnvVars();
      if (missingCloudinary.length === 0) {
        // Cloudinary is configured -> upload to tenant folder
        const folder = `whyte/companies/${companyId}/templates`;
        const uploaded = await uploadImage(buffer, folder);
        return apiSuccess({
          url: uploaded.url,
          publicId: uploaded.publicId,
          fileName: sanitizedBase,
          fileSize: file.size,
          mimeType,
          provider: "cloudinary",
        });
      }

      // Local Persistent Storage fallback (ensures tests & offline/local dev always succeed)
      const uploadDir = join(process.cwd(), "public", "uploads", "tenants", String(companyId));
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      const filePath = join(uploadDir, uniqueName);
      await writeFile(filePath, buffer);

      const localUrl = `/uploads/tenants/${companyId}/${uniqueName}`;
      return apiSuccess({
        url: localUrl,
        publicId: `local_${companyId}_${uniqueName}`,
        fileName: sanitizedBase,
        fileSize: file.size,
        mimeType,
        provider: "local",
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/templates/upload" });
  }
}

/**
 * DELETE /api/templates/upload
 * Deletes an uploaded asset ensuring tenant isolation.
 */
export async function DELETE(req: Request) {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const body = (await readJsonBody(req)) as { publicId?: string; url?: string };
      const publicId = body?.publicId?.trim();
      const url = body?.url?.trim();

      if (!publicId && !url) {
        throw new ApiError("VALIDATION_ERROR", "A publicId or url is required for deletion.");
      }

      // If local storage file
      if (publicId?.startsWith(`local_${companyId}_`) || url?.startsWith(`/uploads/tenants/${companyId}/`)) {
        const fileName = (url || publicId || "").split("/").pop()?.replace(`local_${companyId}_`, "");
        if (fileName) {
          const filePath = join(process.cwd(), "public", "uploads", "tenants", String(companyId), fileName);
          if (existsSync(filePath)) {
            await unlink(filePath).catch(() => {});
          }
        }
        return apiSuccess({ deleted: true, provider: "local" });
      }

      // Cloudinary deletion: verify publicId belongs to caller's company folder
      if (publicId) {
        const expectedPrefix = `whyte/companies/${companyId}/`;
        if (!publicId.startsWith(expectedPrefix)) {
          throw new ApiError("FORBIDDEN", "You are not authorized to delete assets from other tenants.");
        }
        await deleteImage(publicId).catch(() => {});
        return apiSuccess({ deleted: true, provider: "cloudinary" });
      }

      return apiSuccess({ deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/templates/upload" });
  }
}
