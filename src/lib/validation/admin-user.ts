import { z } from "zod";
import {
  booleanField,
  intField,
  nameField,
  numericIdSchema,
  optionalText,
  strictObject,
} from "@/lib/validation/common";

export const adminRoleEnum = z.enum(["super_admin", "admin", "dealer"]);

export const createUserSchema = strictObject({
  firstName: nameField(60, "First name is required."),
  lastName: nameField(60, "Last name is required."),
  email: z
    .string()
    .trim()
    .max(254, "Email must be 254 characters or fewer.")
    .email("Enter a valid email address.")
    .transform((val) => val.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .refine((val) => new TextEncoder().encode(val).length <= 72, "Password must be 72 bytes or fewer."),
  role: adminRoleEnum.default("admin"),
  gstNumber: optionalText(30).transform((val) => (val ? val.toUpperCase() : null)),
  contactNumber: optionalText(30),
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
  gstNumber: optionalText(30).transform((val) => (val ? val.toUpperCase() : null)).optional(),
  contactNumber: optionalText(30).optional(),
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
  contactNumber: z
    .string()
    .trim()
    .min(1, "Contact number is required.")
    .max(30, "Contact number must be 30 characters or fewer.")
    .refine((value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
    }, "Enter a valid 10-digit Indian mobile number.")
    .optional(),
  gstNumber: optionalText(30).transform((val) => (val ? val.toUpperCase() : null)).optional(),
  address: optionalText(500).optional(),
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
    .refine((val) => new TextEncoder().encode(val).length <= 72, "Password must be 72 bytes or fewer.")
    .optional(),
});

export type UpdateDealerProfileInput = z.infer<typeof updateDealerProfileSchema>;

