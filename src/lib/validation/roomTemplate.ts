import { z } from "zod";
import { strictObject, numericIdSchema, requiredText, optionalText, intField, booleanField } from "./common";

export const roomTemplateItemSchema = strictObject({
  productId: numericIdSchema,
  variantId: z.union([z.number(), z.string()]).nullable().optional().transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }),
  defaultQuantity: z.number().int().min(1).default(1),
  displayOrder: z.number().int().default(0),
  isRequired: z.boolean().default(false),
  notes: optionalText(500),
  variantConfig: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const createRoomTemplateSchema = strictObject({
  roomTypeId: numericIdSchema,
  name: requiredText(120, "Template name is required"),
  description: optionalText(500),
  isActive: booleanField.default(true),
  displayOrder: intField().default(0),
  items: z.array(roomTemplateItemSchema).default([]),
});

export const updateRoomTemplateSchema = strictObject({
  name: requiredText(120, "Template name is required").optional(),
  description: optionalText(500),
  isActive: booleanField.optional(),
  displayOrder: intField().optional(),
  items: z.array(roomTemplateItemSchema).optional(),
});

export type CreateRoomTemplateInput = z.infer<typeof createRoomTemplateSchema>;
export type UpdateRoomTemplateInput = z.infer<typeof updateRoomTemplateSchema>;
export type RoomTemplateItemInput = z.infer<typeof roomTemplateItemSchema>;
