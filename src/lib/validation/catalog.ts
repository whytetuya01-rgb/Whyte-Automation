import { z } from "zod";
import {
  booleanField,
  intField,
  nameField,
  numericIdSchema,
  optionalText,
  requiredText,
  strictObject,
} from "@/lib/validation/common";

export const CATEGORY_MAX_DEPTH = 3;

/**
 * Category master data.
 *
 * `variantTiers` / `variantFinishes` are intentionally `z.array(z.unknown())`:
 * the ProductVariant matrix reads them as free-form axis entries and the
 * existing master rows keep whatever shape they were seeded with. They are
 * size-capped so a client cannot push an unbounded document.
 */
const categoryAxisSchema = z.array(z.unknown()).max(200);

const levelField = (required: boolean) => {
  const base = z.union([z.number(), z.string()]).transform((value, ctx) => {
    const raw = typeof value === "number" ? value : String(value).trim();
    if (raw === "") {
      ctx.addIssue({ code: "custom", message: "Level is required." });
      return z.NEVER;
    }
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "Level must be a number." });
      return z.NEVER;
    }
    const int = Math.trunc(parsed);
    if (int < 1 || int > CATEGORY_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `Level must be between 1 and ${CATEGORY_MAX_DEPTH}.`,
      });
      return z.NEVER;
    }
    return int;
  });
  return required ? base : base.optional();
};

const sortOrderField = (required: boolean) => {
  const base = intField();
  if (required) {
    return base.transform((value) => value ?? 0);
  }
  return base;
};

export const createCategorySchema = strictObject({
  name: nameField(120, "Category name is required."),
  level: levelField(true),
  parentId: numericIdSchema.optional().nullable(),
  sortOrder: sortOrderField(true),
  variantTiers: categoryAxisSchema.optional(),
  variantFinishes: categoryAxisSchema.optional(),
});

export const updateCategorySchema = strictObject({
  name: nameField(120, "Category name is required.").optional(),
  level: levelField(false),
  parentId: numericIdSchema.optional().nullable(),
  sortOrder: sortOrderField(false),
  variantTiers: categoryAxisSchema.optional(),
  variantFinishes: categoryAxisSchema.optional(),
});

/**
 * HouseType has exactly four persisted columns: name, description, isActive and
 * sortOrder. `rooms` seeds the matching HouseTypeRoomTemplate rows in the same
 * transaction and is therefore part of the create payload only.
 */
const houseTypeRoomSchema = z
  .object({
    roomTypeId: numericIdSchema,
    defaultCount: intField("Default count must be a whole number.").transform((v) => v ?? 1),
  })
  .strict()
  .refine((room) => (room.defaultCount ?? 1) >= 1, {
    message: "Default count must be at least 1.",
    path: ["defaultCount"],
  });

export const createHouseTypeSchema = strictObject({
  name: nameField(120, "House type name is required."),
  description: optionalText(2000),
  isActive: booleanField,
  sortOrder: sortOrderField(true),
  rooms: z.array(houseTypeRoomSchema).max(200).optional(),
});

/** PATCH also accepts `rooms`, which replaces the template set in the same transaction. */
export const updateHouseTypeSchema = strictObject({
  name: nameField(120, "House type name is required.").optional(),
  description: optionalText(2000),
  isActive: booleanField,
  sortOrder: sortOrderField(false),
  rooms: z.array(houseTypeRoomSchema).max(200).optional(),
});

/** RoomType columns: name, icon, isActive, sortOrder. `notes` is NOT persisted. */
export const createRoomTypeSchema = strictObject({
  name: nameField(120, "Room type name is required."),
  icon: optionalText(120),
  isActive: booleanField,
  sortOrder: sortOrderField(true),
});

export const updateRoomTypeSchema = strictObject({
  name: nameField(120, "Room type name is required.").optional(),
  icon: optionalText(120),
  isActive: booleanField,
  sortOrder: sortOrderField(false),
});

/**
 * Company is a single-row collection (SINGLETON_COMPANY_ID) with exactly these
 * persisted columns. The PATCH body is an explicit allowlist so a client can
 * never write `_id` or `updatedAt`.
 */
export const updateCompanySchema = strictObject({
  name: nameField(160, "Company name is required.").optional(),
  gstNumber: optionalText(80),
  phone: requiredText(60, "Phone is required."),
  email: optionalText(160),
  address: requiredText(500, "Address is required."),
  logoUrl: optionalText(1000),
  tagline: optionalText(300),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateHouseTypeInput = z.infer<typeof createHouseTypeSchema>;
export type UpdateHouseTypeInput = z.infer<typeof updateHouseTypeSchema>;
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
