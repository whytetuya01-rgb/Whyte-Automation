import { parseFinancialNumber, round2, DEFAULT_TAX_PERCENT } from "@/lib/pricing";
import { gstSplitKeepingPrice } from "@/lib/taxSettings";

/**
 * Bulk price changes (#3, batch 5): the rules, as pure functions (no database), so the preview and the real change can never
 * disagree. Catalogue prices are GST-inclusive, so a change moves the inclusive `price`; the GST rate stays as it is and
 * `priceWithoutTax` is re-split to match (kept exact, or explicitly null, exactly as a GST-rate change does). Nothing here
 * knows about quotations: they hold their own snapshot of every price and are never touched.
 */

export const ROUNDINGS = ["none", "1", "10"] as const;
export type Rounding = (typeof ROUNDINGS)[number];

export interface BulkPriceRule {
  /** "percent": value is a percentage of the current price; "amount": value is a fixed number of rupees. */
  mode: "percent" | "amount";
  direction: "increase" | "decrease";
  /** Always positive; `direction` says which way. */
  value: number;
  /** "1" / "10": the new price is rounded to the nearest rupee / ten rupees. "none": to the paisa. */
  rounding: Rounding;
}

export const MAX_PERCENT = 1000;
export const MAX_AMOUNT = 10_000_000;

/** Why a rule is not acceptable, or null. */
export function ruleProblem(rule: BulkPriceRule): string | null {
  if (!Number.isFinite(rule.value) || rule.value <= 0) return "Enter an amount or percentage greater than zero.";
  if (!(ROUNDINGS as readonly string[]).includes(rule.rounding)) return "Choose how to round the new prices.";
  if (rule.mode === "percent") {
    if (rule.value > MAX_PERCENT) return `A percentage change can be at most ${MAX_PERCENT}%.`;
    if (rule.direction === "decrease" && rule.value > 100) return "A price cannot be decreased by more than 100%.";
  } else if (rule.value > MAX_AMOUNT) {
    return `A fixed change can be at most ₹${MAX_AMOUNT.toLocaleString("en-IN")}.`;
  }
  return null;
}

export function applyRounding(value: number, rounding: Rounding): number {
  const step = rounding === "1" ? 1 : rounding === "10" ? 10 : 0;
  return step === 0 ? round2(value) : Math.round(value / step) * step;
}

/** The new GST-inclusive price for one old price. */
export function newPriceFor(oldPrice: number, rule: BulkPriceRule): number {
  const change = rule.mode === "percent" ? (oldPrice * rule.value) / 100 : rule.value;
  return applyRounding(rule.direction === "increase" ? oldPrice + change : oldPrice - change, rule.rounding);
}

export interface PriceRow {
  id: number;
  price: unknown;
  priceWithoutTax?: unknown;
  taxPercent?: unknown;
}

export interface PriceSnapshot {
  /** GST-inclusive selling price. */
  price: number;
  /** null = not stored (the inclusive price is the truth). */
  priceWithoutTax: number | null;
  taxPercent: number;
}

export interface PlannedChange {
  id: number;
  before: PriceSnapshot;
  after: PriceSnapshot;
  delta: number;
  /** Change as a percentage of the old price (0 when the old price was 0). */
  deltaPercent: number;
}

export type SkipReason = "unreadable_price" | "negative_result" | "unchanged" | "cannot_keep_price";

export interface BulkPricePlan {
  changes: PlannedChange[];
  skipped: Array<{ id: number; reason: SkipReason }>;
}

const storedNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseFinancialNumber(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

export function snapshotOf(row: PriceRow): PriceSnapshot | null {
  const price = storedNumber(row.price);
  if (price === null || price < 0) return null;
  return { price, priceWithoutTax: storedNumber(row.priceWithoutTax), taxPercent: storedNumber(row.taxPercent) ?? DEFAULT_TAX_PERCENT };
}

/** What a rule would do to these variants. Deterministic and side-effect free. */
export function planBulkPrice(rows: ReadonlyArray<PriceRow>, rule: BulkPriceRule): BulkPricePlan {
  const plan: BulkPricePlan = { changes: [], skipped: [] };
  for (const row of rows) {
    const before = snapshotOf(row);
    if (!before) {
      plan.skipped.push({ id: row.id, reason: "unreadable_price" });
      continue;
    }
    const next = newPriceFor(before.price, rule);
    if (next < 0) {
      plan.skipped.push({ id: row.id, reason: "negative_result" });
      continue;
    }
    if (next === before.price) {
      plan.skipped.push({ id: row.id, reason: "unchanged" });
      continue;
    }
    const split = gstSplitKeepingPrice(next, before.taxPercent);
    if (!split) {
      plan.skipped.push({ id: row.id, reason: "cannot_keep_price" });
      continue;
    }
    const delta = round2(next - before.price);
    plan.changes.push({
      id: row.id,
      before,
      after: { price: next, priceWithoutTax: split.priceWithoutTax, taxPercent: before.taxPercent },
      delta,
      deltaPercent: before.price === 0 ? 0 : round2((delta / before.price) * 100),
    });
  }
  return plan;
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  unreadable_price: "has no readable price",
  negative_result: "would become negative",
  unchanged: "would not change after rounding",
  cannot_keep_price: "its price cannot be split exactly",
};
