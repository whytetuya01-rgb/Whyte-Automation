/**
 * Quotation Workflow & Custom Field Validation Engine
 * 
 * Provides pure, zero-eval server-authoritative validation for:
 * 1. Safe workflow step ordering & built-in module dependencies
 * 2. Declarative visibility condition evaluation
 * 3. Custom field values schema validation (types, required, regex, ranges)
 */

import type {
  WorkflowStepDefinition,
  WorkflowFieldDefinition,
  FieldVisibilityCondition,
  BuiltinModuleType,
} from "@/types/template";

export interface WorkflowValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface FieldValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  sanitizedValues: Record<string, any>;
}

const VALID_FIELD_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Validates that a workflow definition preserves safe built-in module dependencies
 * and has valid step and field identifiers.
 * 
 * Safe dependency rules:
 * - `project_details` must be present and precede `space_selection` and `product_config`.
 * - `space_selection` must be present and precede `product_config`.
 * - `product_config` must be present and precede `pricing_review`.
 * - `pricing_review` must be present and precede `proposal_preview`.
 * - `proposal_preview` must be the final or post-review step.
 * - Custom steps can be placed anywhere (before, between, after).
 * - All step IDs and field keys must be unique.
 */
export function validateWorkflowDependencies(steps: WorkflowStepDefinition[]): WorkflowValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    return { isValid: false, errors: ["Workflow must contain at least one step."] };
  }

  // 1. Step ID uniqueness
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (!step.id || typeof step.id !== "string" || !step.id.trim()) {
      errors.push("Every workflow step must have a non-empty ID.");
      continue;
    }
    const cleanId = step.id.trim();
    if (stepIds.has(cleanId)) {
      errors.push(`Duplicate step ID "${cleanId}". Step IDs must be unique.`);
    }
    stepIds.add(cleanId);
  }

  // 2. Track index of built-in modules
  const builtinIndices: Record<BuiltinModuleType, number> = {
    project_details: -1,
    space_selection: -1,
    product_config: -1,
    pricing_review: -1,
    proposal_preview: -1,
  };

  steps.forEach((step, idx) => {
    if ((step.moduleType === "builtin" || step.type === "built_in_module") && (step.builtinModule || step.moduleRef)) {
      const mod = (step.builtinModule || step.moduleRef) as BuiltinModuleType;
      if (builtinIndices[mod] !== -1) {
        errors.push(`Duplicate built-in module "${mod}". Each built-in module can only be included once.`);
      }
      builtinIndices[mod] = idx;
    }
  });

  // 3. Conditional ordering dependencies:
  // Only enforce ordering when BOTH dependent modules are included in the workflow.
  if (builtinIndices.project_details !== -1 && builtinIndices.space_selection !== -1) {
    if (builtinIndices.project_details > builtinIndices.space_selection) {
      errors.push('"Project Details" must appear before "Space Selection".');
    }
  }

  if (builtinIndices.space_selection !== -1 && builtinIndices.product_config !== -1) {
    if (builtinIndices.space_selection > builtinIndices.product_config) {
      errors.push('"Space Selection" must appear before "Device Configuration".');
    }
  }

  if (builtinIndices.product_config !== -1 && builtinIndices.pricing_review !== -1) {
    if (builtinIndices.product_config > builtinIndices.pricing_review) {
      errors.push('"Device Configuration" must appear before "Pricing & Review".');
    }
  }

  if (builtinIndices.pricing_review !== -1 && builtinIndices.proposal_preview !== -1) {
    if (builtinIndices.pricing_review > builtinIndices.proposal_preview) {
      errors.push('"Pricing & Review" must appear before "Proposal Preview".');
    }
  }

  // 4. Verify client identity capability:
  // A valid quotation workflow must capture client/customer identity to safely initialize the quotation.
  let hasClientIdentity = builtinIndices.project_details !== -1;
  if (!hasClientIdentity) {
    for (const step of steps) {
      for (const section of step.sections || []) {
        for (const field of section.fields || []) {
          if (field.systemBinding === "clientName" || field.key === "clientName") {
            hasClientIdentity = true;
            break;
          }
        }
        if (hasClientIdentity) break;
      }
      if (hasClientIdentity) break;
    }
  }

  if (!hasClientIdentity) {
    errors.push(
      'Workflow must include at least one step capturing Client / Customer Name (either Project Details module or a field mapped to "clientName").'
    );
  }

  // 5. Verify custom field definitions across all custom steps
  const fieldKeys = new Set<string>();
  for (const step of steps) {
    if (step.sections && Array.isArray(step.sections)) {
      for (const section of step.sections) {
        if (!section.fields || !Array.isArray(section.fields)) continue;
        for (const field of section.fields) {
          if (!field.key || !VALID_FIELD_KEY_REGEX.test(field.key)) {
            errors.push(
              `Invalid field key "${field.key || ""}". Field keys must start with a letter and contain only alphanumeric characters and underscores.`
            );
          }
          if (fieldKeys.has(field.key)) {
            errors.push(`Duplicate field key "${field.key}". Custom field keys must be unique across the workflow.`);
          }
          fieldKeys.add(field.key);

          // Select / Multiselect / Radio must have options
          if (field.type === "select" || field.type === "multiselect" || field.type === "radio") {
            if (!field.options || !Array.isArray(field.options) || field.options.length === 0) {
              errors.push(`Field "${field.label}" of type "${field.type}" must specify at least one option.`);
            }
          }
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Evaluates a declarative visibility condition against currently stored field values.
 * Zero-eval, strictly operator-based.
 */
export function evaluateVisibilityCondition(
  condition: FieldVisibilityCondition | undefined,
  values: Record<string, any>
): boolean {
  if (!condition || !condition.fieldKey) {
    return true; // No condition means always visible
  }

  const { fieldKey, operator, value: targetVal } = condition;
  const currentVal = values ? values[fieldKey] : undefined;

  switch (operator) {
    case "equals":
      return String(currentVal ?? "").trim() === String(targetVal ?? "").trim();

    case "not_equals":
      return String(currentVal ?? "").trim() !== String(targetVal ?? "").trim();

    case "is_not_empty":
      if (currentVal === null || currentVal === undefined) return false;
      if (typeof currentVal === "string") return currentVal.trim().length > 0;
      if (Array.isArray(currentVal)) return currentVal.length > 0;
      return true;

    case "is_empty":
      if (currentVal === null || currentVal === undefined) return true;
      if (typeof currentVal === "string") return currentVal.trim().length === 0;
      if (Array.isArray(currentVal)) return currentVal.length === 0;
      return false;

    case "contains":
      if (Array.isArray(currentVal)) {
        return currentVal.some((item) => String(item).toLowerCase() === String(targetVal).toLowerCase());
      }
      if (typeof currentVal === "string") {
        return currentVal.toLowerCase().includes(String(targetVal).toLowerCase());
      }
      return false;

    case "in":
      if (Array.isArray(targetVal)) {
        return targetVal.some((item) => String(item).toLowerCase() === String(currentVal).toLowerCase());
      }
      return false;

    default:
      return true;
  }
}

/**
 * Validates and sanitizes custom field input values according to their schema definitions.
 * Evaluates visibility conditions first; invisible fields are skipped from required checks.
 */
export function validateCustomFieldValues(
  fieldDefs: WorkflowFieldDefinition[],
  rawValues: Record<string, any>
): FieldValidationResult {
  const errors: Record<string, string> = {};
  const sanitizedValues: Record<string, any> = {};
  const values = rawValues || {};

  for (const def of fieldDefs) {
    const isVisible = evaluateVisibilityCondition(def.visibilityCondition, values);
    if (!isVisible) {
      continue; // Skip validation for conditionally hidden fields
    }

    const rawVal = values[def.key];
    const hasValue = rawVal !== undefined && rawVal !== null && (typeof rawVal === "string" ? rawVal.trim().length > 0 : true);

    // Required check
    if (def.required && !hasValue) {
      errors[def.key] = `${def.label} is required.`;
      continue;
    }

    if (!hasValue) {
      if (def.defaultValue !== undefined && def.defaultValue !== "") {
        sanitizedValues[def.key] = def.defaultValue;
      }
      continue;
    }

    // Type validation
    switch (def.type) {
      case "number": {
        const num = Number(rawVal);
        if (Number.isNaN(num)) {
          errors[def.key] = `${def.label} must be a valid number.`;
        } else {
          if (def.validationRule?.min !== undefined && num < def.validationRule.min) {
            errors[def.key] = def.validationRule.message || `${def.label} must be at least ${def.validationRule.min}.`;
          } else if (def.validationRule?.max !== undefined && num > def.validationRule.max) {
            errors[def.key] = def.validationRule.message || `${def.label} must be at most ${def.validationRule.max}.`;
          } else {
            sanitizedValues[def.key] = num;
          }
        }
        break;
      }

      case "email": {
        const emailStr = String(rawVal).trim();
        if (!EMAIL_REGEX.test(emailStr)) {
          errors[def.key] = `${def.label} must be a valid email address.`;
        } else if (emailStr.length > 255) {
          errors[def.key] = `${def.label} cannot exceed 255 characters.`;
        } else {
          sanitizedValues[def.key] = emailStr;
        }
        break;
      }

      case "phone": {
        const phoneStr = String(rawVal).trim();
        const digits = phoneStr.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) {
          errors[def.key] = `${def.label} must contain a valid phone number.`;
        } else {
          sanitizedValues[def.key] = phoneStr;
        }
        break;
      }

      case "date": {
        const dateStr = String(rawVal).trim();
        if (!DATE_REGEX.test(dateStr)) {
          errors[def.key] = `${def.label} must be a valid date.`;
        } else {
          sanitizedValues[def.key] = dateStr;
        }
        break;
      }

      case "select":
      case "radio": {
        const selectedVal = String(rawVal).trim();
        const validValues = (def.options || []).map((o) => o.value);
        if (validValues.length > 0 && !validValues.includes(selectedVal)) {
          errors[def.key] = `Invalid selection for ${def.label}.`;
        } else {
          sanitizedValues[def.key] = selectedVal;
        }
        break;
      }

      case "multiselect": {
        if (!Array.isArray(rawVal)) {
          errors[def.key] = `${def.label} must be a list of selections.`;
        } else {
          const validValues = new Set((def.options || []).map((o) => o.value));
          const cleanArray = rawVal.map(String).filter((v) => validValues.has(v));
          sanitizedValues[def.key] = cleanArray;
        }
        break;
      }

      case "checkbox": {
        sanitizedValues[def.key] = Boolean(rawVal);
        break;
      }

      case "text":
      case "textarea": {
        const strVal = String(rawVal).trim();
        if (strVal.length > 5000) {
          errors[def.key] = `${def.label} cannot exceed 5,000 characters.`;
        } else if (def.validationRule?.pattern) {
          try {
            const rx = new RegExp(def.validationRule.pattern);
            if (!rx.test(strVal)) {
              errors[def.key] = def.validationRule.message || `${def.label} format is invalid.`;
            } else {
              sanitizedValues[def.key] = strVal;
            }
          } catch {
            sanitizedValues[def.key] = strVal;
          }
        } else {
          sanitizedValues[def.key] = strVal;
        }
        break;
      }

      case "image":
      case "file": {
        const fileStr = String(rawVal).trim();
        if (fileStr.length > 2000) {
          errors[def.key] = `${def.label} asset path is invalid.`;
        } else {
          sanitizedValues[def.key] = fileStr;
        }
        break;
      }

      default:
        sanitizedValues[def.key] = rawVal;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitizedValues,
  };
}
