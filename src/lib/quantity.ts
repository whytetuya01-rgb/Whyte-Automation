/**
 * Quantity rules for a quotation line item. Shared by the dealer editor (typed input) and the API schemas so the
 * client message and the server limit can never drift apart.
 */

/** Largest quantity of one line item. Far above any real project, small enough that totals can never overflow. */
export const MAX_ITEM_QUANTITY = 999;

export type QuantityParseResult = { ok: true; value: number } | { ok: false; message: string };

/**
 * Parses what a dealer typed into a quantity field. Accepts only a whole number from 1 to `max`; every other input
 * (empty, 0, negative, decimal, text, exponent, too large) returns a message instead of a number, so an invalid
 * quantity is never silently rounded or clamped into a valid one.
 */
export function parseQuantityInput(raw: string, max: number = MAX_ITEM_QUANTITY): QuantityParseResult {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Enter a quantity." };
  if (/^-/.test(text)) return { ok: false, message: "Quantity cannot be negative." };
  if (/^\d+\.\d*$|^\.\d+$/.test(text)) return { ok: false, message: "Quantity must be a whole number." };
  if (!/^\d+$/.test(text)) return { ok: false, message: "Enter digits only." };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > max) return { ok: false, message: `Quantity cannot be more than ${max}.` };
  if (value < 1) return { ok: false, message: "Quantity must be at least 1." };
  return { ok: true, value };
}
