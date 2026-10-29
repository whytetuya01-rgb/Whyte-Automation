import { readValidatedImage } from "@/lib/imageUpload";
import { assertLogoDimensions } from "@/lib/imageDimensions";
import { deleteImage } from "@/lib/cloudinary";
import { isOwnBrandingAsset } from "@/lib/uploadPaths";
import { LOGO_UPLOAD_SPECS, type LogoUploadKind } from "@/lib/logoSettings";

/**
 * One logo file from a multipart form, fully validated on the server against that upload's own rules (main logo or
 * compact logo): size, declared type, real magic bytes, pixel dimensions and aspect ratio. Throws a field-level
 * `ApiError` (attached to the upload's field name) for anything unacceptable.
 */
export async function readValidatedLogo(entry: FormDataEntryValue | null, kind: LogoUploadKind): Promise<{ buffer: Buffer; mime: string }> {
  const image = await readValidatedImage(entry, kind, { maxBytes: LOGO_UPLOAD_SPECS[kind].maxBytes });
  assertLogoDimensions(image.buffer, image.mime, kind);
  return image;
}

/**
 * Removes a previously uploaded logo file, but only one that sits in this company's own branding folder (never
 * another company's, never a product image). Best effort: a failure is logged and never thrown, so a cleanup
 * problem cannot fail a save that already succeeded.
 */
export async function deleteOwnBrandingAsset(publicId: string | null | undefined, companyId: number): Promise<void> {
  if (!publicId || !isOwnBrandingAsset(publicId, companyId)) return;
  try {
    await deleteImage(publicId);
  } catch (error) {
    console.error("[company-logo] Could not delete a replaced logo asset:", error instanceof Error ? error.message : "unknown error");
  }
}
