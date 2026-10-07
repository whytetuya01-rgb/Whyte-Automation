import { z } from "zod";

/**
 * Shared field validators (email, phone, GSTIN).
 *
 * Pure functions with no server-only imports, so the exact same rules run in
 * the browser forms (instant inline errors) and in the API schemas (the real
 * enforcement). Never rely on the browser check alone.
 */

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export const EMAIL_MESSAGE = "Enter a valid email address, for example name@company.com.";
export const MOBILE_MESSAGE = "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
export const PHONE_MESSAGE = "Enter a valid phone number (7 to 15 digits, optionally starting with +).";
export const GSTIN_MESSAGE = "Enter a valid 15-character GSTIN, for example 27AAPFU0939F1ZV.";

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * Practical RFC 5322 subset: one "@", dot-atom local part (no leading, trailing
 * or doubled dots), a domain of valid labels and an alphabetic TLD of 2+ letters.
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length === 0 || email.length > 254) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !EMAIL_LOCAL.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => EMAIL_LABEL.test(label))) return false;
  return /^[A-Za-z]{2,}$/.test(labels[labels.length - 1]);
}

/* -------------------------------------------------------------------------- */
/* Phone                                                                       */
/* -------------------------------------------------------------------------- */

const PHONE_CHARS = /^\+?[\d\s().-]+$/;

/**
 * Indian mobile number to its 10 national digits, or null when invalid.
 * Accepts spaces, dashes and brackets plus an optional +91 / 91 / 0 prefix.
 */
export function normalizeIndianMobile(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "" || !PHONE_CHARS.test(raw)) return null;
  if (raw.includes("+") && !raw.startsWith("+")) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    if (!digits.startsWith("91")) return null;
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isValidIndianMobile(value: string | null | undefined): boolean {
  return normalizeIndianMobile(value) !== null;
}

/** Canonical display/storage format for an Indian mobile: "+91 98765 43210". */
export function formatIndianMobile(value: string): string | null {
  const digits = normalizeIndianMobile(value);
  return digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : null;
}

/**
 * General phone number (customers, companies, landlines): only digits and
 * formatting characters, a "+" only as the first character, 7 to 15 digits.
 */
export function isValidPhone(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (raw === "" || !PHONE_CHARS.test(raw)) return false;
  if (raw.includes("+") && !raw.startsWith("+")) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/* -------------------------------------------------------------------------- */
/* GSTIN                                                                       */
/* -------------------------------------------------------------------------- */

const GSTIN_FORMAT = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** State / UT codes issued for GSTINs (01 to 38, plus 97 other territory and 99 centre jurisdiction). */
function isKnownStateCode(code: number): boolean {
  return (code >= 1 && code <= 38) || code === 97 || code === 99;
}

/** The 15th GSTIN character is a base-36 check digit over the first 14. */
function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Structure (state code, PAN pattern, entity code, "Z") plus the check digit. */
export function isValidGstin(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const gstin = normalizeGstin(value);
  const match = GSTIN_FORMAT.exec(gstin);
  if (!match || !isKnownStateCode(Number(match[1]))) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/* -------------------------------------------------------------------------- */
/* Client-side helpers (return an error message or null)                       */
/* -------------------------------------------------------------------------- */

const isBlank = (value: string | null | undefined) => !value || value.trim() === "";

export function emailError(value: string, { required = false } = {}): string | null {
  if (isBlank(value)) return required ? "Email is required." : null;
  return isValidEmail(value) ? null : EMAIL_MESSAGE;
}

export function mobileError(value: string, { required = false } = {}): string | null {
  if (isBlank(value)) return required ? "Contact number is required." : null;
  return isValidIndianMobile(value) ? null : MOBILE_MESSAGE;
}

export function phoneError(value: string, { required = false } = {}): string | null {
  if (isBlank(value)) return required ? "Phone number is required." : null;
  return isValidPhone(value) ? null : PHONE_MESSAGE;
}

export function gstinError(value: string): string | null {
  if (isBlank(value)) return null;
  return isValidGstin(value) ? null : GSTIN_MESSAGE;
}

/* -------------------------------------------------------------------------- */
/* Zod schemas                                                                 */
/* -------------------------------------------------------------------------- */

/** Required email: trimmed, lowercased, validated. */
export const emailSchema = z
  .string({ message: "Email is required." })
  .trim()
  .min(1, "Email is required.")
  .refine(isValidEmail, EMAIL_MESSAGE)
  .transform((value) => value.toLowerCase());

/** Optional email that preserves `undefined` (PATCH) and turns blank into null. */
export const optionalEmailSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    if (!isValidEmail(value)) {
      ctx.addIssue({ code: "custom", message: EMAIL_MESSAGE });
      return z.NEVER;
    }
    return value.trim().toLowerCase();
  });

/** Required Indian mobile, stored as "+91 98765 43210". */
export const mobileSchema = z
  .string({ message: "Contact number is required." })
  .trim()
  .min(1, "Contact number is required.")
  .transform((value, ctx) => {
    const formatted = formatIndianMobile(value);
    if (!formatted) {
      ctx.addIssue({ code: "custom", message: MOBILE_MESSAGE });
      return z.NEVER;
    }
    return formatted;
  });

/** Optional Indian mobile (preserves `undefined`). */
export const optionalMobileSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    const formatted = formatIndianMobile(value);
    if (!formatted) {
      ctx.addIssue({ code: "custom", message: MOBILE_MESSAGE });
      return z.NEVER;
    }
    return formatted;
  });

/** Required general phone (company / landline allowed). Stored trimmed. */
export const phoneSchema = z
  .string({ message: "Phone number is required." })
  .trim()
  .min(1, "Phone number is required.")
  .refine(isValidPhone, PHONE_MESSAGE);

/** Optional general phone (customer contact). Preserves `undefined`; blank becomes null. */
export const optionalPhoneSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    if (!isValidPhone(value)) {
      ctx.addIssue({ code: "custom", message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return value.trim();
  });

/** Optional GSTIN: preserves `undefined`, blank becomes null, stored upper-case. */
export const optionalGstinSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    if (!isValidGstin(value)) {
      ctx.addIssue({ code: "custom", message: GSTIN_MESSAGE });
      return z.NEVER;
    }
    return normalizeGstin(value);
  });
