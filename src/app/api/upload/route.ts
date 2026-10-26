import type { NextResponse } from "next/server";
import { withAnyPermission } from "@/lib/api-auth";
import { assertImageManageable } from "@/lib/imageOwnership";
import { companyProductFolder } from "@/lib/uploadPaths";
import {
  CloudinaryAuthError,
  CloudinaryConfigError,
  deleteImage,
  getMissingCloudinaryEnvVars,
  uploadImage,
} from "@/lib/cloudinary";
import {
  ApiError,
  type ApiErrorBody,
  apiErrorResponse,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { readValidatedImage } from "@/lib/imageUpload";
import { deleteUploadSchema } from "@/lib/validation/upload";

const NOT_CONFIGURED_MESSAGE = "Image upload service is not configured.";
const UPLOAD_FAILED_MESSAGE = "Image upload failed. Please try again.";
const UPLOAD_REJECTED_MESSAGE = "Image upload service rejected the request. Please contact an administrator.";

/**
 * Fails fast — and legibly — when the Cloudinary environment variables are
 * missing or still hold documentation placeholders, instead of letting a stub
 * credential reach Cloudinary and come back as `401 Unknown API key ...`.
 *
 * Only variable *names* are logged; no value or secret is ever written out.
 */
function assertCloudinaryConfigured(logPrefix: string): void {
  const missing = getMissingCloudinaryEnvVars();
  if (missing.length === 0) return;

  console.error(
    `${logPrefix} Cloudinary environment variables are not configured. Missing/invalid: ${missing.join(", ")}. ` +
      `Set real values in .env.local for local development and in the Vercel project environment variables ` +
      `(CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) for deployed environments.`
  );
  throw new ApiError("INTERNAL_SERVER_ERROR", NOT_CONFIGURED_MESSAGE, { status: 500 });
}

/**
 * Maps a Cloudinary failure onto the standard envelope.
 *
 * The Cloudinary SDK echoes the submitted API key in its authentication error,
 * so nothing from the vendor error is forwarded to the client — only a fixed,
 * safe message. The useful detail is logged server-side instead.
 */
function handleCloudinaryError(error: unknown, logPrefix: string): NextResponse<ApiErrorBody> {
  if (error instanceof CloudinaryAuthError) {
    console.error(
      `${logPrefix} ${error.message} (Cloudinary responded${
        error.httpCode ? ` with HTTP ${error.httpCode}` : ""
      }. The configured key/secret pair was rejected; verify CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET.)`
    );
    return apiErrorResponse(
      new ApiError("INTERNAL_SERVER_ERROR", UPLOAD_REJECTED_MESSAGE, { status: 500 })
    );
  }

  if (error instanceof CloudinaryConfigError) {
    console.error(`${logPrefix} ${error.message}`);
    return apiErrorResponse(
      new ApiError("INTERNAL_SERVER_ERROR", NOT_CONFIGURED_MESSAGE, { status: 500 })
    );
  }

  console.error(
    `${logPrefix} Cloudinary request failed:`,
    error instanceof Error ? error.message : error
  );
  return apiErrorResponse(new ApiError("INTERNAL_SERVER_ERROR", UPLOAD_FAILED_MESSAGE, { status: 500 }));
}

export async function POST(req: Request) {
  try {
    // Only administrators with catalog permissions may upload product images.
    return await withAnyPermission(["catalog:create", "catalog:edit"], async ({ companyId }) => {
      // Every upload lands in the caller's own company folder; the company is
      // taken from the session, never from the request.
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "A company context is required to upload images.");
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload.");
      }

      // Size, declared type and real magic bytes (shared with company logo uploads).
      const { buffer } = await readValidatedImage(formData.get("file"));

      // Request is valid — now confirm the upload service can actually run.
      assertCloudinaryConfigured("POST /api/upload");

      let uploaded;
      try {
        uploaded = await uploadImage(buffer, companyProductFolder(companyId));
      } catch (error) {
        return handleCloudinaryError(error, "POST /api/upload");
      }

      return apiSuccess(uploaded);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/upload" });
  }
}

export async function DELETE(req: Request) {
  try {
    return await withAnyPermission(["catalog:edit", "catalog:delete"], async ({ companyId }) => {
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "A company context is required to delete images.");
      }

      const { publicId } = deleteUploadSchema.parse(await readJsonBody(req));
      // A publicId is caller-controlled. A company may only delete assets it
      // owns: its own upload folder, or — for the default company only — the
      // legacy `whyte/products/` assets that predate companies. Another
      // company's asset, a path outside the product folders and malformed or
      // traversal paths are all refused, before Cloudinary is contacted.
      await assertImageManageable(publicId, companyId);

      assertCloudinaryConfigured("DELETE /api/upload");

      try {
        await deleteImage(publicId);
      } catch (error) {
        return handleCloudinaryError(error, "DELETE /api/upload");
      }

      return apiSuccess({ publicId, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/upload" });
  }
}
