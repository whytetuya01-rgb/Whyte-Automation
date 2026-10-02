import { z } from "zod";
import { ApiError } from "@/lib/api-response";

/**
 * Reusable Zod primitives shared by every mutation schema.
 *
 * These live here (not in a per-resource file) so product, catalogue,
 * quotation and upload validation can never drift apart: one definition of
 * "required text", "optional text", "numeric id" and "price" for the whole API.
 */

export const MAX_STRING = 200;
export const MAX_LONG_STRING = 2000;

/**
 * Optional text that PRESERVES `undefined`.
 *
 * This matters for PATCH: a partial body such as `{ isActive: false }` must not
 * turn every other optional field into an explicit `null`, otherwise a route
 * that iterates over the parsed body would wipe untouched columns. An explicit
 * `null` or a whitespace-only string still normalises to `null`.
 */
export const optionalText = (max = MAX_STRING) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed.slice(0, max);
    });

export const requiredText = (max = MAX_STRING, message = "This field is required.") =>
  z
    .string({ message })
    .transform((value) => value.trim())
    .pipe(z.string().min(1, message).max(max, `Must be ${max} characters or fewer.`));

/** Display name: required, trimmed, length bounded, no control characters. */
export const nameField = (max = 120, message = "Name is required.") =>
  requiredText(max, message).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Name cannot contain control characters.",
  });

/** URL slug: lowercase, digits and single dashes only. */
export const slugField = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1, "Slug is required.")
      .max(80, "Slug must be 80 characters or fewer.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers and single dashes.")
  );

/** Positive integer document id. Accepts the numeric strings HTML inputs send. */
export const numericIdSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const raw = typeof value === "number" ? value : value.trim();
  if (typeof raw === "string" && !/^\d+$/.test(raw)) {
    ctx.addIssue({ code: "custom", message: "Must be a valid numeric id." });
    return z.NEVER;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    ctx.addIssue({ code: "custom", message: "Must be a valid numeric id." });
    return z.NEVER;
  }
  return parsed;
});

/** Price accepts numbers or numeric strings; rejects NaN, Infinity and negatives. */
export const priceFieldSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const raw = typeof value === "number" ? value : value.trim();
  if (raw === "") {
    ctx.addIssue({ code: "custom", message: "Price is required." });
    return z.NEVER;
  }
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isNaN(parsed)) {
    ctx.addIssue({ code: "custom", message: "Price must be a number." });
    return z.NEVER;
  }
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: "custom", message: "Price must be a finite number." });
    return z.NEVER;
  }
  if (parsed < 0) {
    ctx.addIssue({ code: "custom", message: "Price cannot be negative." });
    return z.NEVER;
  }
  return Math.round(parsed * 100) / 100;
});

/** Non-negative quantity. */
export const quantityField = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const raw = typeof value === "number" ? value : String(value).trim();
    if (raw === "") {
      ctx.addIssue({ code: "custom", message: "Quantity is required." });
      return z.NEVER;
    }
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({ code: "custom", message: "Quantity must be zero or more." });
      return z.NEVER;
    }
    return parsed;
  });

export const booleanField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  });

export const intField = (message = "Must be a whole number.") =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return Math.trunc(parsed);
    });

/** ISO date string (or Date) normalised to a `Date`, rejecting invalid dates. */
export const dateField = z
  .union([z.string(), z.date()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Must be a valid date." });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * Rejects unknown keys so a client can never write a field the endpoint is not
 * designed to touch (mass assignment). Every mutation schema uses `.strict()`.
 */
export const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

/* -------------------------------------------------------------------------- */
/* Query-string validation                                                     */
/* -------------------------------------------------------------------------- */

function readRaw(searchParams: URLSearchParams, key: string): string | undefined {
  const raw = searchParams.get(key);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Strict positive-integer query parameter.
 *
 * Unlike `parsePaginationParams` (which silently falls back to a default for
 * legacy callers) this rejects a malformed value, so `?page=abc` can never
 * become `NaN` deep inside a Mongo query.
 */
export function parseIntQueryParam(
  searchParams: URLSearchParams,
  key: string,
  options?: { defaultValue?: number; min?: number; max?: number; field?: string }
): number | undefined {
  const field = options?.field ?? key;
  const raw = readRaw(searchParams, key);
  if (raw === undefined) return options?.defaultValue;

  if (!/^\d+$/.test(raw)) {
    throw new ApiError("INVALID_FIELD", `${field} must be a whole number.`, { field });
  }
  const parsed = Number(raw);
  const min = options?.min ?? 0;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `between ${min} and ${max}`;
    throw new ApiError("INVALID_FIELD", `${field} must be ${range}.`, { field });
  }
  return parsed;
}

/** Strict boolean query parameter (`true`/`false`/`1`/`0`/`yes`/`no`). */
export function parseBooleanQueryParam(
  searchParams: URLSearchParams,
  key: string,
  options?: { defaultValue?: boolean; field?: string }
): boolean | undefined {
  const field = options?.field ?? key;
  const raw = readRaw(searchParams, key);
  if (raw === undefined) return options?.defaultValue;
  const normalised = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalised)) return true;
  if (["false", "0", "no", "off"].includes(normalised)) return false;
  throw new ApiError("INVALID_FIELD", `${field} must be true or false.`, { field });
}

/** Optional free-text search term, length bounded so it cannot be used to push huge regexes. */
export function parseSearchQueryParam(
  searchParams: URLSearchParams,
  key = "search",
  options?: { max?: number; field?: string }
): string | undefined {
  const field = options?.field ?? key;
  const raw = readRaw(searchParams, key);
  if (raw === undefined) return undefined;
  const max = options?.max ?? 100;
  if (raw.length > max) {
    throw new ApiError("INVALID_FIELD", `${field} must be ${max} characters or fewer.`, { field });
  }
  return raw;
}

/** Optional short string query parameter (status, sort, mode, ...) with a length cap. */
export function parseStringQueryParam(
  searchParams: URLSearchParams,
  key: string,
  options?: { max?: number; field?: string; allowed?: readonly string[] }
): string | undefined {
  const field = options?.field ?? key;
  const raw = readRaw(searchParams, key);
  if (raw === undefined) return undefined;
  if (options?.allowed && !options.allowed.includes(raw)) {
    throw new ApiError("INVALID_FIELD", `${field} must be one of: ${options.allowed.join(", ")}.`, {
      field,
    });
  }
  const max = options?.max ?? 100;
  if (raw.length > max) {
    throw new ApiError("INVALID_FIELD", `${field} must be ${max} characters or fewer.`, { field });
  }
  return raw;
}
