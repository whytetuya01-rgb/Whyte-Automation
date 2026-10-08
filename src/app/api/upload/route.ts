import type { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
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
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE, deleteUploadSchema } from "@/lib/validation/upload";

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

/** Magic-number prefixes, so a renamed `.exe` cannot pass the MIME allowlist. */
const SIGNATURES: Array<{ mime: (typeof ALLOWED_IMAGE_MIME_TYPES)[number]; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function detectImageSignature(buffer: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (signature.bytes.every((byte, index) => buffer[index] === byte)) {
      return signature.mime;
    }
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function POST(req: Request) {
  try {
    // Only the admin product catalog uploads images; restrict to Super Admin / Admin.
    await requireRole("super_admin", "admin");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload.");
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError("FILE_REQUIRED", "An image file is required.", { field: "file" });
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new ApiError(
        "FILE_TOO_LARGE",
        `File size must be ${Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB or less.`,
        { field: "file", details: { maxBytes: MAX_UPLOAD_SIZE, receivedBytes: file.size } }
      );
    }
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw new ApiError(
        "INVALID_FILE_TYPE",
        "Only JPEG, PNG and WEBP images are allowed.",
        {
          field: "file",
          details: { allowed: ALLOWED_IMAGE_MIME_TYPES, received: file.type },
        }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // The client-supplied Content-Type is only a claim; confirm the bytes.
    // An *unrecognised* signature is rejected as well — otherwise anything that
    // is not one of the three allowed formats (a renamed .exe, a GIF, an SVG)
    // would slip past this allowlist and only be refused upstream, where the
    // failure surfaces as an opaque 500 instead of a 415.
    const detected = detectImageSignature(buffer);
    if (detected === null || detected !== file.type) {
      throw new ApiError("INVALID_FILE_TYPE", "The file contents do not match its declared type.", {
        field: "file",
        details: detected === null ? { declared: file.type } : { declared: file.type, detected },
      });
    }

    // Request is valid — now confirm the upload service can actually run.
    assertCloudinaryConfigured("POST /api/upload");

    let uploaded;
    try {
      uploaded = await uploadImage(buffer, "whyte/products");
    } catch (error) {
      return handleCloudinaryError(error, "POST /api/upload");
    }

    return apiSuccess(uploaded);
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/upload" });
  }
}

export async function DELETE(req: Request) {
  try {
    await requireRole("super_admin", "admin");

    const { publicId } = deleteUploadSchema.parse(await readJsonBody(req));
    // A publicId is caller-controlled: keep deletes inside the folder this
    // endpoint is allowed to manage so it cannot be used to remove other assets.
    if (!publicId.startsWith("whyte/products/")) {
      throw new ApiError("VALIDATION_ERROR", "That image does not belong to this upload folder.", {
        field: "publicId",
      });
    }

    assertCloudinaryConfigured("DELETE /api/upload");

    try {
      await deleteImage(publicId);
    } catch (error) {
      return handleCloudinaryError(error, "DELETE /api/upload");
    }

    return apiSuccess({ publicId, deleted: true });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/upload" });
  }
}
