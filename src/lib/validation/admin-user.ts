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
import {
  emailSchema,
  gstinSchema,
  mobileSchema,
  optionalEmailSchema,
  optionalGstinSchema,
  optionalMobileSchema,
} from "@/lib/validation/fields";

export const adminRoleEnum = z.enum(["super_admin", "admin", "dealer"]);

export const createUserSchema = strictObject({
  firstName: nameField(60, "First name is required."),
  lastName: nameField(60, "Last name is required."),
  email: emailSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .refine((val) => new TextEncoder().encode(val).length <= 72, "Password must be 72 bytes or fewer."),
  role: adminRoleEnum.default("admin"),
  gstNumber: optionalGstinSchema.transform((val) => val ?? null),
  contactNumber: optionalMobileSchema,
  address: optionalText(500),
  discountAllocationPercent: z
    .number()
    .min(0, "Discount cannot be less than 0%.")
    .max(100, "Discount cannot exceed 100%.")
    .optional()
    .default(0),
});

export const updateUserSchema = strictObject({
  firstName: nameField(60, "First name is required.").optional(),
  lastName: nameField(60, "Last name is required.").optional(),
  role: adminRoleEnum.optional(),
  isActive: booleanField,
  gstNumber: optionalGstinSchema,
  contactNumber: optionalMobileSchema,
  address: optionalText(500).optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .refine((val) => new TextEncoder().encode(val).length <= 72, "Password must be 72 bytes or fewer.")
    .optional(),
  discountAllocationPercent: z
    .number()
    .min(0, "Discount cannot be less than 0%.")
    .max(100, "Discount cannot exceed 100%.")
    .optional(),
});

export const updateDealerDiscountSchema = strictObject({
  discountAllocationPercent: z
    .number()
    .min(0, "Discount allocation cannot be less than 0%.")
    .max(100, "Discount allocation cannot exceed 100%."),
});

export const updateDealerProfileSchema = strictObject({
  firstName: nameField(60, "First name is required.").optional(),
  lastName: nameField(60, "Last name is required.").optional(),
  contactNumber: mobileSchema.optional(),
  companyName: nameField(120, "Company name is required.").optional(),
  gstNumber: gstinSchema.optional(),
  businessEmail: optionalEmailSchema,
  address: requiredText(500, "Company address is required.").optional(),
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
    .refine((val) => new TextEncoder().encode(val).length <= 72, "Password must be 72 bytes or fewer.")
    .optional(),
});

export type UpdateDealerProfileInput = z.infer<typeof updateDealerProfileSchema>;

