/**
 * Pure, decimal-safe pricing and tax calculation utilities.
 * Used across the admin catalog, variant management, APIs, and quotation engine.
 */

export interface VariantPricingCalculation {
  priceWithoutTax: number;
  taxPercent: number;
  taxAmount: number;
  price: number;
  cost: number;
  purchaseTaxPercent: number;
}

export const DEFAULT_TAX_PERCENT = 18;
export const DEFAULT_PURCHASE_TAX_PERCENT = 18;
export const DEFAULT_COST = 0;

/**
 * Rounds a number to exactly two decimal places safely.
 */
export function round2(num: number): number {
  if (!Number.isFinite(num) || Number.isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Parses any incoming price/tax representation (number, string, or {$numberDecimal})
 * into a safe finite number.
 */
export function parseFinancialNumber(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === "") return fallback;
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  if (typeof val === "string") {
    const parsed = Number(val.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof val === "object" && val !== null) {
    if ("$numberDecimal" in val && typeof (val as { $numberDecimal: unknown }).$numberDecimal === "string") {
      const parsed = Number((val as { $numberDecimal: string }).$numberDecimal);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (typeof (val as { toString?: () => string }).toString === "function") {
      const str = (val as { toString: () => string }).toString();
      const parsed = Number(str);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  }
  return fallback;
}

/**
 * Formats a financial number to a fixed 2-decimal string for MongoDB Decimal128 or display.
 */
export function toDecimalString(val: unknown, fallback = "0.00"): string {
  const num = parseFinancialNumber(val, NaN);
  if (Number.isNaN(num)) return fallback;
  return round2(num).toFixed(2);
}

/**
 * Calculates pre-tax price and tax amount given a tax-inclusive selling price.
 *
 * Example:
 * price = 5799, taxPercent = 18
 * priceWithoutTax = 5799 / 1.18 = 4914.41
 * taxAmount = 4914.41 * 0.18 = 884.59
 * price = 4914.41 + 884.59 = 5799.00
 */
export function calculateFromTaxInclusivePrice(
  priceWithTaxInput: unknown,
  taxPercentInput: unknown = DEFAULT_TAX_PERCENT
): { priceWithoutTax: number; taxAmount: number; price: number; taxPercent: number } {
  const price = Math.max(0, round2(parseFinancialNumber(priceWithTaxInput, 0)));
  const taxPercent = Math.max(0, round2(parseFinancialNumber(taxPercentInput, DEFAULT_TAX_PERCENT)));

  if (price === 0 || taxPercent === 0) {
    return {
      priceWithoutTax: price,
      taxAmount: 0,
      price,
      taxPercent,
    };
  }

  const taxRate = taxPercent / 100;
  const priceWithoutTax = round2(price / (1 + taxRate));
  const taxAmount = round2(priceWithoutTax * taxRate);
  // Re-verify that priceWithoutTax + taxAmount matches price; adjust taxAmount slightly if 1 cent rounding difference occurs
  const adjustedPrice = round2(priceWithoutTax + taxAmount);
  const finalPrice = Math.abs(adjustedPrice - price) <= 0.02 ? price : adjustedPrice;
  const finalTaxAmount = round2(finalPrice - priceWithoutTax);

  return {
    priceWithoutTax,
    taxAmount: finalTaxAmount,
    price: finalPrice,
    taxPercent,
  };
}

/**
 * Calculates tax amount and tax-inclusive selling price given a pre-tax selling price.
 *
 * Example:
 * priceWithoutTax = 10000, taxPercent = 18
 * taxAmount = 10000 * 0.18 = 1800
 * price = 10000 + 1800 = 11800
 */
export function calculateFromTaxExclusivePrice(
  priceWithoutTaxInput: unknown,
  taxPercentInput: unknown = DEFAULT_TAX_PERCENT
): { priceWithoutTax: number; taxAmount: number; price: number; taxPercent: number } {
  const priceWithoutTax = Math.max(0, round2(parseFinancialNumber(priceWithoutTaxInput, 0)));
  const taxPercent = Math.max(0, round2(parseFinancialNumber(taxPercentInput, DEFAULT_TAX_PERCENT)));

  const taxAmount = round2(priceWithoutTax * (taxPercent / 100));
  const price = round2(priceWithoutTax + taxAmount);

  return {
    priceWithoutTax,
    taxAmount,
    price,
    taxPercent,
  };
}

/**
 * Full variant pricing resolver that accepts any subset of pricing fields,
 * guaranteeing all 5 core fields + taxAmount are returned consistently.
 */
export function resolveVariantPricing(params: {
  price?: unknown;
  priceWithoutTax?: unknown;
  taxPercent?: unknown;
  cost?: unknown;
  purchaseTaxPercent?: unknown;
}): VariantPricingCalculation {
  const taxPercent =
    params.taxPercent !== undefined && params.taxPercent !== null && params.taxPercent !== ""
      ? Math.max(0, round2(parseFinancialNumber(params.taxPercent, DEFAULT_TAX_PERCENT)))
      : DEFAULT_TAX_PERCENT;

  let priceWithoutTax = 0;
  let taxAmount = 0;
  let price = 0;

  if (params.priceWithoutTax !== undefined && params.priceWithoutTax !== null && params.priceWithoutTax !== "") {
    const calc = calculateFromTaxExclusivePrice(params.priceWithoutTax, taxPercent);
    priceWithoutTax = calc.priceWithoutTax;
    taxAmount = calc.taxAmount;
    price = calc.price;
  } else if (params.price !== undefined && params.price !== null && params.price !== "") {
    const calc = calculateFromTaxInclusivePrice(params.price, taxPercent);
    priceWithoutTax = calc.priceWithoutTax;
    taxAmount = calc.taxAmount;
    price = calc.price;
  }

  const cost =
    params.cost !== undefined && params.cost !== null && params.cost !== ""
      ? Math.max(0, round2(parseFinancialNumber(params.cost, DEFAULT_COST)))
      : DEFAULT_COST;

  const purchaseTaxPercent =
    params.purchaseTaxPercent !== undefined &&
    params.purchaseTaxPercent !== null &&
    params.purchaseTaxPercent !== ""
      ? Math.max(0, round2(parseFinancialNumber(params.purchaseTaxPercent, DEFAULT_PURCHASE_TAX_PERCENT)))
      : DEFAULT_PURCHASE_TAX_PERCENT;

  return {
    priceWithoutTax,
    taxPercent,
    taxAmount,
    price,
    cost,
    purchaseTaxPercent,
  };
}
