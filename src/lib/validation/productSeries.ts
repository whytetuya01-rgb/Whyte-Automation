import { z } from "zod";
import { SERIES_LIMITS } from "@/lib/productSeries";

const noControlChars = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/**
 * PATCH /api/categories/[id]/series. Every key optional; `null` clears. The image is one the company uploaded through
 * POST /api/upload (its own product folder); the route checks that ownership before saving.
 */
export const categorySeriesSchema = z
  .object({
    enabled: z.boolean({ message: "Series must be on or off." }).optional(),
    description: z
      .string({ message: "The series description must be text." })
      .trim()
      .max(SERIES_LIMITS.description, `The series description must be ${SERIES_LIMITS.description} characters or fewer.`)
      .refine(noControlChars, "The series description contains invalid characters.")
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
    image: z
      .object({
        url: z.string().trim().url("The series image must be an uploaded image.").max(1000).refine((value) => value.startsWith("https://"), "The series image must be an https address."),
        publicId: z.string().trim().min(1).max(255),
      })
      .strict()
      .nullable()
      .optional(),
    showOnPdf: z.boolean({ message: "Show on PDF must be on or off." }).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to save.");

export type CategorySeriesInput = z.infer<typeof categorySeriesSchema>;
