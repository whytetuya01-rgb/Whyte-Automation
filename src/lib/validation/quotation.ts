import { z } from "zod";
import { ApiError } from "@/lib/api-response";
import {
  booleanField,
  intField,
  nameField,
  numericIdSchema,
  optionalText,
  quantityField,
  strictObject,
} from "@/lib/validation/common";
import { MAX_ITEM_QUANTITY } from "@/lib/quantity";
import { optionalEmailSchema, optionalGstinSchema, optionalPhoneSchema } from "@/lib/validation/fields";

/**
 * Quotation / QuotationRoom / QuotationItem validation.
 *
 * Field names mirror `src/models/Quotation.ts`, `QuotationRoom.ts` and
 * `QuotationItem.ts`. Every mutation is an explicit allowlist (`.strict()`) so a
 * client can never write `_id`, `quotationNumber` or any computed column.
 *
 * These routes require a session: every quotation handler calls `requireSession`
 * from `@/lib/api-auth`, and `src/proxy.ts` rejects unauthenticated requests
 * before they reach the handler. Validation alone is never the access control.
 */

/** Mirrors the `status` enum on the Quotation model. */
export const quotationStatusEnum = z.enum(["draft", "sent", "approved", "rejected", "delivered"]);

/** Mirrors the `discountType` enum on the Quotation model. */
export const discountTypeEnum = z.enum(["percentage", "fixed", "none"]);

/**
 * Quotation._id is a generated opaque string (`q_<base36>_<base36>`), not a
 * numeric id, so it gets its own guard instead of `parseNumericId`.
 */
export const quotationIdSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Quotation id is required.")
      .max(64, "Quotation id is too long.")
      .regex(/^[A-Za-z0-9_-]+$/, "Quotation id contains unsupported characters.")
  );

/**
 * Validates a route-parameter quotation id.
 * Throws a controlled INVALID_ID ApiError (never a raw ZodError) so a bad URL
 * produces a clean 400 instead of a validation envelope.
 */
export function parseQuotationId(raw: unknown, field = "id"): string {
  const result = quotationIdSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid quotation id.";
    throw new ApiError("INVALID_ID", message, { field });
  }
  return result.data;
}

const discountValueField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({ code: "custom", message: "Discount value must be zero or more." });
      return z.NEVER;
    }
    return parsed;
  });

const validUntilField = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Valid-until must be a valid date." });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * Create body. `quotationNumber`, `_id`, `createdAt` and `updatedAt` are
 * generated server-side and are therefore not accepted from the client.
 */
export const createQuotationSchema = strictObject({
  clientName: nameField(160, "Client name is required."),
  clientGstNumber: optionalGstinSchema,
  clientPhone: optionalPhoneSchema,
  clientEmail: optionalEmailSchema,
  clientAddress: optionalText(500),
  houseTypeId: numericIdSchema.optional().nullable(),
  status: quotationStatusEnum.optional(),
  notes: optionalText(2000),
  discountType: discountTypeEnum.optional().nullable(),
  discountValue: discountValueField,
  customerDiscountPercent: z.number().min(0).max(100).optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  assignedSalesId: numericIdSchema.optional().nullable(),
  terms: optionalText(2000),
  validUntil: validUntilField,
  defaultTier: optionalText(120),
  defaultFinish: optionalText(120),
});

/** PATCH body: every field optional, same allowlist as create. */
export const updateQuotationSchema = strictObject({
  clientName: nameField(160, "Client name is required.").optional(),
  clientGstNumber: optionalGstinSchema,
  clientPhone: optionalPhoneSchema,
  clientEmail: optionalEmailSchema,
  clientAddress: optionalText(500),
  houseTypeId: numericIdSchema.optional().nullable(),
  status: quotationStatusEnum.optional(),
  notes: optionalText(2000),
  discountType: discountTypeEnum.optional().nullable(),
  discountValue: discountValueField,
  customerDiscountPercent: z.number().min(0).max(100).optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  assignedSalesId: numericIdSchema.optional().nullable(),
  terms: optionalText(2000),
  validUntil: validUntilField,
  defaultTier: optionalText(120),
  defaultFinish: optionalText(120),
});

export const transitionQuotationSchema = strictObject({
  action: z.enum(["approve", "reject", "deliver"]),
});

export const spaceNameSchema = z
  .string({ message: "Space name is required." })
  .transform((val) => val.trim())
  .pipe(
    z
      .string()
      .min(1, "Space name cannot be empty.")
      .max(120, "Space name must be 120 characters or fewer.")
      .refine((val) => !/[\u0000-\u001f\u007f]/.test(val), {
        message: "Space name cannot contain control characters.",
      })
  );

/** Mirrors QuotationRoom: roomTypeId, customName, subArea, notes, sortOrder. */
export const createQuotationRoomSchema = strictObject({
  roomTypeId: numericIdSchema.optional().nullable(),
  customName: z.union([spaceNameSchema, z.null()]).optional(),
  subArea: optionalText(120),
  notes: optionalText(1000),
  sortOrder: intField().transform((value) => value ?? 0),
});

export const updateQuotationRoomSchema = strictObject({
  roomTypeId: numericIdSchema.optional().nullable(),
  customName: z.union([spaceNameSchema, z.null()]).optional(),
  subArea: optionalText(120),
  notes: optionalText(1000),
  sortOrder: intField(),
});

/** A line-item quantity: a whole number from 0 up to the shared maximum (create still floors it at 1). */
const itemQuantityField = quantityField.pipe(
  z
    .number()
    .int("Quantity must be a whole number.")
    .max(MAX_ITEM_QUANTITY, `Quantity cannot be more than ${MAX_ITEM_QUANTITY}.`)
);

/**
 * QuotationItem create body. `unitPrice` is intentionally absent: the price is
 * always taken from the resolved ProductVariant so a client cannot invent one.
 */
export const createQuotationItemSchema = strictObject({
  quotationRoomId: numericIdSchema,
  productId: numericIdSchema,
  productVariantId: numericIdSchema.optional().nullable(),
  variantConfig: z.record(z.string(), z.string()).optional().nullable(),
  quantity: itemQuantityField.optional(),
  sbNumber: optionalText(60),
  notes: optionalText(500),
  sortOrder: intField(),
});

/**
 * QuotationItem PATCH body. Moving an item to another room and swapping the
 * product are both supported here; the room is re-checked against this
 * quotation before the move is applied.
 */
export const updateQuotationItemSchema = strictObject({
  quantity: itemQuantityField.optional(),
  sbNumber: optionalText(60),
  notes: optionalText(500),
  productId: numericIdSchema.optional(),
  productVariantId: numericIdSchema.optional().nullable(),
  variantLabel: optionalText(200),
  variantConfig: z.record(z.string(), z.string()).optional().nullable(),
  unitPrice: z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({ code: "custom", message: "Unit price must be zero or more." });
        return z.NEVER;
      }
      return Math.round(parsed * 100) / 100;
    }),
  resetToDefaultPrice: booleanField.optional(),
  isCustomPrice: booleanField.optional(),
  sortOrder: intField(),
  quotationRoomId: numericIdSchema.optional(),
});

/** Duplicate accepts an optional override set; the rest is copied server-side. */
export const duplicateQuotationSchema = strictObject({
  clientName: nameField(160, "Client name is required.").optional(),
  notes: optionalText(2000),
  internalNotes: optionalText(2000),
  includeRooms: booleanField,
  /** Admin / Super Admin only: dealer to assign the clone to, or null to keep it. */
  dealerId: numericIdSchema.optional().nullable(),
});

/** Assignment body: `dealerId` null unassigns dealer, `assignedSalesId` null unassigns salesperson. */
export const assignQuotationSchema = strictObject({
  dealerId: numericIdSchema.optional().nullable(),
  assignedSalesId: numericIdSchema.optional().nullable(),
});

export const massUpdateRoomItemSchema = strictObject({
  itemId: numericIdSchema,
  productId: numericIdSchema,
  productVariantId: numericIdSchema.optional().nullable(),
  variantConfig: z.record(z.string(), z.string()).optional().nullable(),
  variantLabel: optionalText(200),
  quantity: quantityField.optional(),
  notes: optionalText(500),
});

export const massUpdateRoomItemsSchema = strictObject({
  items: z.array(massUpdateRoomItemSchema).min(1, "At least one item must be updated."),
});

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
export type CreateQuotationRoomInput = z.infer<typeof createQuotationRoomSchema>;
export type UpdateQuotationRoomInput = z.infer<typeof updateQuotationRoomSchema>;
export type CreateQuotationItemInput = z.infer<typeof createQuotationItemSchema>;
export type UpdateQuotationItemInput = z.infer<typeof updateQuotationItemSchema>;
export type MassUpdateRoomItemInput = z.infer<typeof massUpdateRoomItemSchema>;
export type MassUpdateRoomItemsInput = z.infer<typeof massUpdateRoomItemsSchema>;
export type AssignQuotationInput = z.infer<typeof assignQuotationSchema>;
export type DuplicateQuotationInput = z.infer<typeof duplicateQuotationSchema>;

