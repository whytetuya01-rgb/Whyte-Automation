import { ApiError } from "@/lib/api-response";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE } from "@/lib/validation/upload";

/**
 * Server-side validation shared by every image upload (product images, company logos): size, declared type and the
 * file's real magic bytes. The client's Content-Type is only a claim; the bytes decide.
 */

const SIGNATURES: Array<{ mime: (typeof ALLOWED_IMAGE_MIME_TYPES)[number]; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** The image type the bytes actually are (JPEG, PNG or WebP), or `null` for anything else. */
export function detectImageSignature(buffer: Buffer): string | null {
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

/**
 * Validates one uploaded form file and returns its bytes. Throws a field-level `ApiError` (`field` defaults to
 * "file") for a missing file, an oversize file, a disallowed declared type, or contents that are not that type.
 */
export async function readValidatedImage(
  value: FormDataEntryValue | null,
  field = "file",
  options: { maxBytes?: number } = {}
): Promise<{ buffer: Buffer; mime: string }> {
  // An upload type can set its own (smaller) limit; product images keep the shared default.
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_SIZE;
  if (!(value instanceof File) || value.size === 0) {
    throw new ApiError("FILE_REQUIRED", "An image file is required.", { field });
  }
  if (value.size > maxBytes) {
    throw new ApiError(
      "FILE_TOO_LARGE",
      `File size must be ${Math.round((maxBytes / (1024 * 1024)) * 10) / 10}MB or less.`,
      { field, details: { maxBytes, receivedBytes: value.size } }
    );
  }
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value.type)) {
    throw new ApiError("INVALID_FILE_TYPE", "Only JPEG, PNG and WEBP images are allowed.", {
      field,
      details: { allowed: ALLOWED_IMAGE_MIME_TYPES, received: value.type },
    });
  }

  const buffer = Buffer.from(await value.arrayBuffer());
  // An unrecognised signature is rejected as well (a renamed .exe, a GIF, an SVG): otherwise it would only be
  // refused upstream, where it surfaces as an opaque 500 instead of a clear 415.
  const detected = detectImageSignature(buffer);
  if (detected === null || detected !== value.type) {
    throw new ApiError("INVALID_FILE_TYPE", "The file contents do not match its declared type.", {
      field,
      details: detected === null ? { declared: value.type } : { declared: value.type, detected },
    });
  }
  return { buffer, mime: value.type };
}
