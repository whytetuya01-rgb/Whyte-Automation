import type { ClientSession } from "mongoose";
import { getNextQuotationSequence } from "@/lib/counter";

/**
 * The ONE place quotation numbers are made. Format: `QT-YYYY-NNN`
 *   QT    fixed prefix
 *   YYYY  calendar year of creation
 *   NNN   sequence within that company and year, padded to at least three digits (QT-2026-001, QT-2026-1000)
 *
 * Numbers are issued on the server only, inside the request's tenant context (the company is never taken from client
 * input), by the atomic counter in `lib/counter.ts` ("create the counter if missing, lift it above the highest number
 * already issued, then add" in one update). The sequence restarts at 001 each calendar year, and a counter that has
 * fallen behind existing data can never hand out a number that is already used. Numbers are unique per company
 * (`(companyId, quotationNumber)` is a unique index); historical numbers are never touched.
 *
 * Every way of creating a quotation (new, converted from a lead, cloned) calls `issueQuotationNumber`, so there is one
 * format and one counter. Creation and the counter step run in the same transaction when one is available.
 */

export const QUOTATION_NUMBER_PREFIX = "QT";
export const QUOTATION_NUMBER_PATTERN = /^QT-\d{4}-\d{3,}$/;
const MIN_DIGITS = 3;

export function formatQuotationNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error(`Invalid quotation year: ${year}`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Invalid quotation sequence: ${sequence}`);
  return `${QUOTATION_NUMBER_PREFIX}-${year}-${String(sequence).padStart(MIN_DIGITS, "0")}`;
}

/** Issues the next number for the calling company (from the tenant context) in `year`. */
export async function issueQuotationNumber(year: number, session?: ClientSession): Promise<{ quotationNumber: string; sequence: number }> {
  const sequence = await getNextQuotationSequence(year, session);
  return { quotationNumber: formatQuotationNumber(year, sequence), sequence };
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
