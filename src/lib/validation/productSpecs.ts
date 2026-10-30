import { z } from "zod";
import { SPEC_FIELD_TYPES, SPEC_KEY_PATTERN, SPEC_LIMITS, type SpecField, type SpecFieldType } from "@/lib/productSpecs";

const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

const specFieldSchema = z
  .object({
    key: z.string({ message: "Each field needs a key." }).regex(SPEC_KEY_PATTERN, "A field key is lower-case letters, digits and _ (starting with a letter)."),
    label: z
      .string({ message: "Each field needs a name." })
      .trim()
      .min(1, "Each field needs a name.")
      .max(SPEC_LIMITS.label, `A field name must be ${SPEC_LIMITS.label} characters or fewer.`)
      .refine(noControlChars, "A field name contains invalid characters."),
    type: z.enum(SPEC_FIELD_TYPES as [SpecFieldType, ...SpecFieldType[]], { message: "Choose Text, Number or Dropdown." }),
    unit: z
      .string({ message: "The unit must be text." })
      .trim()
      .max(SPEC_LIMITS.unit, `A unit must be ${SPEC_LIMITS.unit} characters or fewer.`)
      .refine(noControlChars, "The unit contains invalid characters.")
      .nullable()
      .optional(),
    options: z
      .array(
        z
          .string({ message: "Each option must be text." })
          .trim()
          .min(1, "An option cannot be blank.")
          .max(SPEC_LIMITS.option, `An option must be ${SPEC_LIMITS.option} characters or fewer.`)
          .refine(noControlChars, "An option contains invalid characters.")
      )
      .max(SPEC_LIMITS.options, `Up to ${SPEC_LIMITS.options} options.`)
      .optional(),
    required: z.boolean().optional(),
    showInPicker: z.boolean().optional(),
    showOnPdf: z.boolean().optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    const options = field.options ?? [];
    if (field.type === "select" && options.length === 0) ctx.addIssue({ code: "custom", path: ["options"], message: `"${field.label}" needs at least one option.` });
    if (field.type !== "select" && options.length > 0) ctx.addIssue({ code: "custom", path: ["options"], message: `Only a dropdown has options ("${field.label}").` });
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) ctx.addIssue({ code: "custom", path: ["options"], message: `"${field.label}" lists an option twice.` });
  })
  .transform(
    (field): SpecField => ({
      key: field.key,
      label: field.label,
      type: field.type,
      unit: field.type === "select" ? null : field.unit ? field.unit : null,
      options: field.type === "select" ? field.options ?? [] : [],
      required: field.required ?? false,
      showInPicker: field.showInPicker ?? false,
      showOnPdf: field.showOnPdf ?? false,
      scope: "product",
    })
  );

/** PUT /api/categories/[id]/spec-fields: the category's own fields, in display order (replaces the list). */
export const categorySpecFieldsSchema = z
  .object({
    fields: z.array(specFieldSchema).max(SPEC_LIMITS.fields, `Up to ${SPEC_LIMITS.fields} fields per category.`),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Each field can be listed once." });
    const labels = value.fields.map((field) => field.label.toLowerCase());
    if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Two fields have the same name." });
  });

/** A product's specification values: { fieldKey: value }; null clears them all. Checked against the category's fields by the route. */
export const productSpecsField = z.union([z.record(z.string(), z.unknown()), z.null()]).optional();

export type CategorySpecFieldsInput = z.infer<typeof categorySpecFieldsSchema>;
