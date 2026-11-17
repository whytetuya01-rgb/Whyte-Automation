import type { ClientSession } from "mongoose";
import { getNextQuotationSequence } from "@/lib/counter";
import type { TemplateNumberingFormat } from "@/types/template";

/**
 * The ONE place quotation numbers are made. Format default: `QT-YYYY-NNN`
 * Or custom per-template format: `{prefix}{sep}{year}{sep}{seq}{sep}{suffix}`
 *
 * Numbers are issued on the server only, inside the request's tenant context (the company is never taken from client
 * input), by the atomic counter in `lib/counter.ts`.
 */

export const QUOTATION_NUMBER_PREFIX = "QT";
export const QUOTATION_NUMBER_PATTERN = /^QT-\d{4}-\d{3,}$/;
const MIN_DIGITS = 3;

export function formatQuotationNumber(
  year: number,
  sequence: number,
  format?: TemplateNumberingFormat | null
): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error(`Invalid quotation year: ${year}`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Invalid quotation sequence: ${sequence}`);

  if (!format) {
    return `${QUOTATION_NUMBER_PREFIX}-${year}-${String(sequence).padStart(MIN_DIGITS, "0")}`;
  }

  const { prefix, separator, includeYear, yearFormat, digitCount, suffix } = format;
  const yr = yearFormat === "YY" ? String(year).slice(-2) : String(year);
  const padSeq = String(sequence).padStart(Math.max(MIN_DIGITS, digitCount || 3), "0");

  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  if (includeYear) parts.push(yr);
  parts.push(padSeq);
  if (suffix) parts.push(suffix);

  return parts.join(separator || "-");
}

/** Issues the next number for the calling company (from the tenant context) in `year`. */
export async function issueQuotationNumber(
  year: number,
  session?: ClientSession,
  format?: TemplateNumberingFormat | null
): Promise<{ quotationNumber: string; sequence: number }> {
  const sequence = await getNextQuotationSequence(year, session);
  return { quotationNumber: formatQuotationNumber(year, sequence, format), sequence };
}

/** True for a duplicate-key (E11000) error on the quotation number index. */
export function isQuotationNumberConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; keyPattern?: Record<string, unknown>; message?: unknown };
  if (e.code !== 11000) return false;
  return Boolean(e.keyPattern && "quotationNumber" in e.keyPattern) || (typeof e.message === "string" && /quotationNumber/.test(e.message));
}

/**
 * Runs a creation step (the whole transaction, so a fresh number is issued each time) and tries again, a bounded
 * number of times, if the only problem was that the number was taken by a simultaneous request. Any other error, or
 * running out of attempts, is thrown as it is.
 */
export async function withQuotationNumberRetry<T>(create: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      if (!isQuotationNumberConflict(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
