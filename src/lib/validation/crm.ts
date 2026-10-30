import { z } from "zod";
import {
  nameField,
  numericIdSchema,
  optionalText,
  strictObject,
} from "@/lib/validation/common";
import {
  optionalEmailSchema,
  optionalGstinSchema,
  optionalPhoneSchema,
} from "@/lib/validation/fields";

export const customerTypeEnum = z.enum([
  "individual",
  "architect",
  "builder",
  "interior_designer",
  "contractor",
  "commercial",
  "other",
]);

export const leadStatusEnum = z.enum([
  "new",
  "contacted",
  "site_visit",
  "quoted",
  "negotiation",
  "won",
  "lost",
]);

export const leadPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export const crmActivityTypeEnum = z.enum([
  "call",
  "whatsapp",
  "email",
  "site_visit",
  "meeting",
  "quotation_sent",
  "quotation_viewed",
  "follow_up",
  "note",
  "status_change",
]);

const optionalDateField = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((val, ctx) => {
    if (val === undefined || val === null || val === "") return null;
    const parsed = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date format." });
      return z.NEVER;
    }
    return parsed;
  });

export const createCustomerSchema = strictObject({
  name: nameField(160, "Customer name is required."),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  billingAddress: optionalText(500),
  siteAddress: optionalText(500),
  gstNumber: optionalGstinSchema,
  customerType: customerTypeEnum.default("individual"),
  assignedSalesId: numericIdSchema.optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  notes: optionalText(2000),
});

export const updateCustomerSchema = strictObject({
  name: nameField(160, "Customer name is required.").optional(),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  billingAddress: optionalText(500),
  siteAddress: optionalText(500),
  gstNumber: optionalGstinSchema,
  customerType: customerTypeEnum.optional(),
  assignedSalesId: numericIdSchema.optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  notes: optionalText(2000),
});

export const createLeadSchema = strictObject({
  customerName: nameField(160, "Customer name is required."),
  customerId: numericIdSchema.optional().nullable(),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  siteAddress: optionalText(500),
  location: optionalText(160),
  projectType: optionalText(120),
  estimatedBudget: z.number().min(0).optional().nullable(),
  expectedClosingDate: optionalDateField,
  sourceId: z.string().max(64).optional().nullable(),
  sourceName: optionalText(120),
  assignedSalesId: numericIdSchema.optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  description: optionalText(2000),
  status: leadStatusEnum.default("new"),
  priority: leadPriorityEnum.default("medium"),
  notes: optionalText(2000),
  nextFollowUpAt: optionalDateField,
});

export const updateLeadSchema = strictObject({
  customerName: nameField(160, "Customer name is required.").optional(),
  customerId: numericIdSchema.optional().nullable(),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  siteAddress: optionalText(500),
  location: optionalText(160),
  projectType: optionalText(120),
  estimatedBudget: z.number().min(0).optional().nullable(),
  expectedClosingDate: optionalDateField,
  sourceId: z.string().max(64).optional().nullable(),
  sourceName: optionalText(120),
  assignedSalesId: numericIdSchema.optional().nullable(),
  dealerId: numericIdSchema.optional().nullable(),
  description: optionalText(2000),
  status: leadStatusEnum.optional(),
  priority: leadPriorityEnum.optional(),
  notes: optionalText(2000),
  nextFollowUpAt: optionalDateField,
  lostReason: optionalText(500),
});

export const updateLeadStatusSchema = strictObject({
  status: leadStatusEnum,
  lostReason: optionalText(500),
  notes: optionalText(2000),
});

export const convertLeadSchema = strictObject({
  houseTypeId: numericIdSchema.optional().nullable(),
  defaultTier: optionalText(120),
  defaultFinish: optionalText(120),
  notes: optionalText(2000),
});

export const createCrmActivitySchema = strictObject({
  leadId: z.string().max(64).optional().nullable(),
  customerId: numericIdSchema.optional().nullable(),
  quotationId: z.string().max(64).optional().nullable(),
  type: crmActivityTypeEnum,
  title: nameField(200, "Activity title is required."),
  description: optionalText(2000),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const createLeadSourceSchema = strictObject({
  name: nameField(100, "Source name is required."),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateLeadSourceSchema = strictObject({
  name: nameField(100, "Source name is required.").optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

