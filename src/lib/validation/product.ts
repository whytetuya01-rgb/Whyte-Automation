import { z } from "zod";
import { VARIANT_CODE_RULE } from "@/lib/productVariantService";

/**
 * Shared Zod schemas for product / variant mutations.
 *
 * These schemas are strict (unknown keys rejected) so a client can never
 * silently change a field the API is not designed to touch — in particular the
 * Product PATCH route can no longer wipe the variants array.
 *
 * Field names mirror `src/models/Product.ts` and `src/models/ProductVariant.ts`
 * exactly. Note `type` (not `productType`) and that `price` lives on the
 * variant, never on the product.
 */

const MAX_STRING = 200;
const MAX_LONG_STRING = 2000;

/**
 * Optional text that PRESERVES `undefined`.
 *
 * This matters for PATCH: a partial body such as `{ isActive: false }` must not
 * turn every other optional field into an explicit `null`, otherwise the route's
 * `Object.entries(body)` update would wipe untouched columns. Mongoose defaults
 * still apply for absent fields on create, so a single shared helper is enough.
 * An explicit `null` or a whitespace-only string still normalises to `null`.
 */
const optionalText = (max = MAX_STRING) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed.slice(0, max);
    });

const requiredText = (max = MAX_STRING, message = "This field is required.") =>
  z
    .string({ message })
    .transform((value) => value.trim())
    .pipe(z.string().min(1, message).max(max, `Must be ${max} characters or fewer.`));

export const numericIdSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const raw = typeof value === "number" ? value : value.trim();
  if (typeof raw === "string" && !/^\d+$/.test(raw)) {
    ctx.addIssue({ code: "custom", message: "Must be a valid numeric id." });
    return z.NEVER;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    ctx.addIssue({ code: "custom", message: "Must be a valid numeric id." });
    return z.NEVER;
  }
  return parsed;
});

/** Price accepts numbers or numeric strings; rejects NaN, Infinity and negatives. */
export const priceFieldSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const raw = typeof value === "number" ? value : value.trim();
  if (raw === "") {
    ctx.addIssue({ code: "custom", message: "Price is required." });
    return z.NEVER;
  }
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isNaN(parsed)) {
    ctx.addIssue({ code: "custom", message: "Price must be a number." });
    return z.NEVER;
  }
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: "custom", message: "Price must be a finite number." });
    return z.NEVER;
  }
  if (parsed < 0) {
    ctx.addIssue({ code: "custom", message: "Price cannot be negative." });
    return z.NEVER;
  }
  return Math.round(parsed * 100) / 100;
});

export const variantCodeField = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Variant code is required.")
      .max(
        VARIANT_CODE_RULE.maxLength,
        `Variant code must be ${VARIANT_CODE_RULE.maxLength} characters or fewer.`
      )
      .regex(
        VARIANT_CODE_RULE.pattern,
        `Variant code may only contain ${VARIANT_CODE_RULE.patternDescription}.`
      )
  );

const booleanField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  });

const intField = (message = "Must be a whole number.") =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return Math.trunc(parsed);
    });

/** Matches the `type` enum on the Product model. */
export const productTypeEnum = z.enum([
  "switch_board",
  "accessory",
  "retrofit",
  "curtain",
  "smart_lock",
  "vdp",
  "other",
]);

/** `type` on PATCH: omitted stays omitted so it is never silently reset. */
const productTypeField = z
  .union([productTypeEnum, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === null ? "other" : value));

/**
 * `type` on create: `Product.type` is required with no schema default, so a
 * missing/blank value must fall back to "other" instead of failing the insert.
 */
const createProductTypeField = z
  .union([productTypeEnum, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === null || value === undefined ? "other" : value));

export const createVariantSchema = z
  .object({
    automationTier: optionalText(),
    surfaceFinish: optionalText(),
    variantCode: variantCodeField,
    name: optionalText(),
    code: optionalText(),
    price: priceFieldSchema,
    isActive: booleanField,
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createProductSchema = z
  .object({
    name: requiredText(MAX_STRING, "Product name is required."),
    code: optionalText(MAX_STRING),
    type: createProductTypeField,
    categoryId: numericIdSchema,
    description: optionalText(MAX_LONG_STRING),
    unit: optionalText(50),
    imageUrl: optionalText(MAX_LONG_STRING),
    moduleSize: optionalText(100),
    notes: optionalText(MAX_LONG_STRING),
    isActive: booleanField,
    sortOrder: intField(),
    variants: z.array(createVariantSchema).min(1, "At least one variant is required."),
  })
  .strict();

/**
 * Product PATCH: every field optional and whitelisted. `variants` is
 * deliberately NOT accepted here — the matrix is edited through the dedicated
 * variant endpoints, so a partial update can never erase variants.
 */
export const updateProductSchema = z
  .object({
    name: requiredText(MAX_STRING, "Product name is required.").optional(),
    code: optionalText(MAX_STRING),
    type: productTypeField,
    categoryId: numericIdSchema.optional(),
    description: optionalText(MAX_LONG_STRING),
    unit: optionalText(50),
    imageUrl: optionalText(MAX_LONG_STRING),
    moduleSize: optionalText(100),
    notes: optionalText(MAX_LONG_STRING),
    isActive: booleanField,
    sortOrder: intField(),
  })
  .strict();

/** Bulk variant edit (Edit Variants modal): code + price only. */
export const bulkVariantUpdateSchema = z
  .object({
    variants: z
      .array(
        z
          .object({
            id: numericIdSchema,
            variantCode: variantCodeField,
            price: priceFieldSchema,
          })
          .strict()
      )
      .min(1, "At least one variant must be provided."),
  })
  .strict();

/**
 * Single-variant PATCH. automationTier / surfaceFinish are intentionally NOT
 * editable: the category master matrix defines them and they can only change
 * through a full matrix resync.
 */
export const updateVariantSchema = z
  .object({
    variantCode: variantCodeField.optional(),
    name: optionalText(),
    price: priceFieldSchema.optional(),
    isActive: booleanField,
    sortOrder: intField(),
  })
  .strict();

/**
 * Axis value for an Add request. `null` and "" both mean "this category has no
 * such axis", which is a legal state for a one-axis matrix.
 */
const axisField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  });

/**
 * Add a combination that is valid in the category matrix but was never added to
 * this Product. The server re-validates the combination against the matrix and
 * rejects it if a live variant already exists for it.
 */
export const addVariantSchema = z
  .object({
    automationTier: axisField,
    surfaceFinish: axisField,
    variantCode: variantCodeField,
    price: priceFieldSchema,
  })
  .strict();

/**
 * Restore a hard-deleted variant from ProductVariantHistory. The combination
 * comes from the history row (not the client) and is re-validated against the
 * current category matrix; the code and price are sent by the client so the
 * user can adjust the prefilled history values before committing.
 */
export const restoreVariantSchema = z
  .object({
    historyId: numericIdSchema,
    variantCode: variantCodeField,
    price: priceFieldSchema,
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type BulkVariantUpdateInput = z.infer<typeof bulkVariantUpdateSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type AddVariantInput = z.infer<typeof addVariantSchema>;
export type RestoreVariantInput = z.infer<typeof restoreVariantSchema>;
