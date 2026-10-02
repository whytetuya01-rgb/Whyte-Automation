import { z } from "zod";
import { strictObject } from "@/lib/validation/common";

export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const uploadFormSchema = strictObject({});

export const deleteUploadSchema = strictObject({
  publicId: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "publicId is required.")),
});
