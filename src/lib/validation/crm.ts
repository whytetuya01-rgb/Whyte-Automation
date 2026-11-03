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
import { LEAD_TAG_FORBIDDEN, MAX_LEAD_TAGS, MAX_LEAD_TAG_LENGTH, normalizeTags } from "@/lib/leadTags";

/** Tags on a lead: tidied, empties and case-insensitive duplicates dropped, then limited in number and length. */
export const leadTagsSchema = z
  .array(z.string().max(200))
  .max(MAX_LEAD_TAGS * 3)
  .transform(normalizeTags)
  .pipe(
    z
      .array(
        z
          .string()
          .min(1)
          .max(MAX_LEAD_TAG_LENGTH, `A tag can have at most ${MAX_LEAD_TAG_LENGTH} characters.`)
          .refine((tag) => !LEAD_TAG_FORBIDDEN.test(tag), "A tag cannot contain < or > characters.")
      )
      .max(MAX_LEAD_TAGS, `A lead can have at most ${MAX_LEAD_TAGS} tags.`)
  );

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
  tags: leadTagsSchema.optional(),
  nextFollowUpAt: optionalDateField,
  /** Who owns the follow-up. Default: the person creating the lead. */
  followUpOwnerId: numericIdSchema.optional().nullable(),
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
  tags: leadTagsSchema.optional(),
  nextFollowUpAt: optionalDateField,
  /** Hands the open follow-up to this person. */
  followUpOwnerId: numericIdSchema.optional().nullable(),
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

export const assignmentModeEnum = z.enum(["manual", "round_robin", "least_open_leads"]);

export const sourceMappingSchema = strictObject({
  sourceId: z.string().min(1, "Source ID is required."),
  salesId: numericIdSchema,
});

export const updateLeadAssignmentRuleSchema = strictObject({
  mode: assignmentModeEnum,
  enabled: z.boolean(),
  eligibleSalesIds: z.array(numericIdSchema).default([]),
  fallbackSalesId: numericIdSchema.optional().nullable(),
  sourceMappings: z.array(sourceMappingSchema).optional().default([]),
});

