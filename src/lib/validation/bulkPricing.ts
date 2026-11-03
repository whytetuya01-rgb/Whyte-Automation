import { z } from "zod";
import { ROUNDINGS } from "@/lib/bulkPricing";
import { numericIdSchema, optionalText, strictObject } from "@/lib/validation/common";

/** Which products a bulk change covers: everything, or chosen categories (with their sub-categories) and/or chosen products. */
export const bulkScopeSchema = strictObject({
  all: z.boolean().optional(),
  categoryIds: z.array(numericIdSchema).max(500).optional(),
  productIds: z.array(numericIdSchema).max(5000).optional(),
}).refine((scope) => scope.all === true || (scope.categoryIds?.length ?? 0) > 0 || (scope.productIds?.length ?? 0) > 0, {
  message: "Choose what to change: all products, some categories, or some products.",
  path: ["all"],
});

export const bulkRuleSchema = strictObject({
  mode: z.enum(["percent", "amount"]),
  direction: z.enum(["increase", "decrease"]),
  value: z.number().finite(),
  rounding: z.enum(ROUNDINGS),
});

export const bulkPreviewSchema = strictObject({ scope: bulkScopeSchema, rule: bulkRuleSchema });

export const bulkApplySchema = strictObject({
  scope: bulkScopeSchema,
  rule: bulkRuleSchema,
  /** The checksum the preview returned: the change is refused if prices moved since. */
  checksum: z.string().min(16).max(128),
  note: optionalText(200),
});
