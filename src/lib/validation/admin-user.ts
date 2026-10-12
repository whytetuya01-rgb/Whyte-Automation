import { z } from "zod";
import {
  booleanField,
  nameField,
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

import { ALL_PERMISSIONS, SUPER_ADMIN_EXCLUSIVE_PERMISSIONS } from "@/lib/permissions";

export const adminRoleEnum = z
  .string()
  .trim()
  .min(2, "Role key must be at least 2 characters.")
  .max(50, "Role key cannot exceed 50 characters.")
  .regex(/^[a-z0-9_-]+$/i, "Role key must contain only letters, numbers, hyphens, and underscores.")
  .refine((role) => role.toLowerCase() !== "sales", "The 'sales' role is deprecated and cannot be assigned.");

export const permissionEnum = z.enum(ALL_PERMISSIONS);

export const configurablePermissionSchema = z
  .array(permissionEnum)
  .default([])
  .refine(
    (perms) => !perms.some((p) => SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)),
    "Configurable admins cannot be granted Super Admin-exclusive permissions."
  );

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
  permissions: configurablePermissionSchema.optional(),
});

export const updateUserSchema = strictObject({
  firstName: nameField(60, "First name is required.").optional(),
  lastName: nameField(60, "Last name is required.").optional(),
  role: adminRoleEnum.optional(),
  isActive: booleanField.optional(),
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
  permissions: configurablePermissionSchema.optional(),
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

