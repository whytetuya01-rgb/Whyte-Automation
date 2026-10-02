import { requireSession } from "@/lib/api-auth";
import { uploadImage, deleteImage } from "@/lib/cloudinary";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE, deleteUploadSchema } from "@/lib/validation/upload";

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
    await requireSession();

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
    const detected = detectImageSignature(buffer);
    if (detected && detected !== file.type) {
      throw new ApiError("INVALID_FILE_TYPE", "The file contents do not match its declared type.", {
        field: "file",
        details: { declared: file.type, detected },
      });
    }

    const uploaded = await uploadImage(buffer, "whyte/products");

    return apiSuccess(uploaded, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/upload" });
  }
}

export async function DELETE(req: Request) {
  try {
    await requireSession();

    const { publicId } = deleteUploadSchema.parse(await readJsonBody(req));
    // A publicId is caller-controlled: keep deletes inside the folder this
    // endpoint is allowed to manage so it cannot be used to remove other assets.
    if (!publicId.startsWith("whyte/products/")) {
      throw new ApiError("VALIDATION_ERROR", "That image does not belong to this upload folder.", {
        field: "publicId",
      });
    }

    await deleteImage(publicId);

    return apiSuccess({ publicId, deleted: true });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/upload" });
  }
}
