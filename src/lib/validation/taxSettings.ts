import { z } from "zod";
import { TAX_CODE_HINTS, TAX_LIMITS, isValidGstRate, isValidTaxCode } from "@/lib/taxSettings";

const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

const gstRateField = z
  .number({ message: "The GST rate must be a number." })
  .refine(isValidGstRate, "A GST rate must be between 0 and 100 with at most two decimals.");

const descriptionField = z
  .string({ message: "The description must be text." })
  .trim()
  .max(TAX_LIMITS.description, `The description must be ${TAX_LIMITS.description} characters or fewer.`)
  .refine(noControlChars, "The description contains invalid characters.")
  .transform((value) => (value === "" ? null : value))
  .nullable();

/** PUT /api/catalog/tax-settings: the company's allowed GST rates and the default for new products. */
export const gstRatesSchema = z
  .object({
    gstRates: z
      .array(gstRateField)
      .min(1, "Keep at least one GST rate.")
      .max(TAX_LIMITS.rates, `Up to ${TAX_LIMITS.rates} GST rates.`)
      .refine((rates) => new Set(rates).size === rates.length, "Each GST rate can be listed once."),
    defaultGstRate: gstRateField,
  })
  .strict()
  .refine((value) => value.gstRates.includes(value.defaultGstRate), { message: "The default GST rate must be one of the allowed rates.", path: ["defaultGstRate"] })
  .transform((value) => ({ ...value, gstRates: [...value.gstRates].sort((a, b) => a - b) }));

/** POST /api/catalog/tax-settings/hsn-codes. The code and its kind never change afterwards (products refer to the code). */
export const hsnCodeCreateSchema = z
  .object({
    kind: z.enum(["hsn", "sac"], { message: "Choose HSN (goods) or SAC (services)." }),
    code: z.string({ message: "Enter the code." }).trim(),
    description: descriptionField.optional(),
    gstRate: gstRateField,
    isActive: z.boolean({ message: "Active must be on or off." }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isValidTaxCode(value.kind, value.code)) {
      ctx.addIssue({ code: "custom", path: ["code"], message: `${value.kind === "sac" ? "A SAC" : "An HSN"} code is ${TAX_CODE_HINTS[value.kind]}.` });
    }
  });

/** PATCH /api/catalog/tax-settings/hsn-codes/[code]: description, rate and active only. */
export const hsnCodeUpdateSchema = z
  .object({
    description: descriptionField.optional(),
    gstRate: gstRateField.optional(),
    isActive: z.boolean({ message: "Active must be on or off." }).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to save.");

/** A product's HSN/SAC code: optional; "" or null clears it. Checked against the company's list by the route. */
export const productHsnCodeField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim()))
  .refine((value) => value === undefined || value === null || /^\d{4,8}$/.test(value), "The HSN/SAC code must be 4 to 8 digits.");

/** A product's GST rate: optional; null clears it. Must be one of the company's rates (checked by the route). */
export const productGstRateField = z
  .union([z.number(), z.null()])
  .optional()
  .refine((value) => value === undefined || value === null || isValidGstRate(value), "A GST rate must be between 0 and 100 with at most two decimals.");

export type GstRatesInput = z.infer<typeof gstRatesSchema>;
export type HsnCodeCreateInput = z.infer<typeof hsnCodeCreateSchema>;
export type HsnCodeUpdateInput = z.infer<typeof hsnCodeUpdateSchema>;
