/**
 * GST rates and HSN/SAC codes for a company's catalogue (#3, batch 2).
 *
 * Catalogue prices are GST-INCLUSIVE. A product's GST rate only decides how its price splits into "price without tax"
 * + "tax" (the split a quotation item snapshots when it is added); it never changes the price. It is unrelated to the
 * 18% Service & Integration charge on a quotation (`calculateQuotationGst`), which nothing here touches.
 *
 * Pure helpers shared by the server (validation, APIs) and the admin screens.
 */
import { calculateFromTaxInclusivePrice, parseFinancialNumber, resolveVariantPricing, round2 } from "@/lib/pricing";

/** India's GST slabs since 22 Sep 2025 (12% and 28% were folded into 5% / 18% / 40%). Each company edits its own list. */
export const DEFAULT_GST_RATES: readonly number[] = Object.freeze([0, 5, 18, 40]);
export const DEFAULT_GST_RATE = 18;
export const TAX_LIMITS = { rates: 12, hsnCodes: 500, description: 200 } as const;

export type TaxCodeKind = "hsn" | "sac";
export const TAX_CODE_KINDS: readonly TaxCodeKind[] = ["hsn", "sac"];

export interface HsnSacCode {
  code: string;
  /** HSN for goods, SAC for services. */
  kind: TaxCodeKind;
  description: string | null;
  /** The rate a product gets when this code is picked (one of the company's rates). */
  gstRate: number;
  /** Inactive codes stay on the products that use them but cannot be newly picked. */
  isActive: boolean;
}

export interface CompanyTaxSettings {
  /** Allowed GST rates, ascending. */
  gstRates: number[];
  /** Pre-selected for a new product; always one of `gstRates`. */
  defaultGstRate: number;
  hsnCodes: HsnSacCode[];
}

/** What GET /api/catalog/tax-settings returns. */
export interface TaxSettingsView extends CompanyTaxSettings {
  hsnCodes: Array<HsnSacCode & { productCount: number }>;
  /** Products per GST rate (keyed by the rate as text). */
  productsByRate: Record<string, number>;
  unclassifiedProducts: number;
  totalProducts: number;
  canManage: boolean;
}

/** HSN (goods): 4, 6 or 8 digits. SAC (services): 6 digits starting with 99. */
const CODE_PATTERNS: Record<TaxCodeKind, RegExp> = { hsn: /^(\d{4}|\d{6}|\d{8})$/, sac: /^99\d{4}$/ };

export const TAX_CODE_HINTS: Record<TaxCodeKind, string> = {
  hsn: "4, 6 or 8 digits, e.g. 8536",
  sac: "6 digits starting with 99, e.g. 998713",
};

export function isValidTaxCode(kind: TaxCodeKind, code: string): boolean {
  return CODE_PATTERNS[kind]?.test(code) ?? false;
}

/** A GST rate: 0-100 with at most two decimals (0.25% and 3% exist for some goods). */
export function isValidGstRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 100 && Math.abs(Math.round(rate * 100) - rate * 100) < 1e-9;
}

export function formatGstRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0$/, "")}%`;
}

export function taxCodeLabel(entry: Pick<HsnSacCode, "code" | "kind" | "description" | "gstRate">): string {
  return `${entry.kind.toUpperCase()} ${entry.code}${entry.description ? ` · ${entry.description}` : ""} (${formatGstRate(entry.gstRate)})`;
}

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Stored settings read back safely; absent on every company that never changed them. Always a fresh object. */
export function normalizeTaxSettings(stored: unknown): CompanyTaxSettings {
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const rawRates = Array.isArray(source.gstRates) ? source.gstRates.map((rate) => parseFinancialNumber(rate, NaN)) : [];
  const rates = [...new Set(rawRates.filter(isValidGstRate))].sort((a, b) => a - b).slice(0, TAX_LIMITS.rates);
  const gstRates = rates.length > 0 ? rates : [...DEFAULT_GST_RATES];
  const storedDefault = parseFinancialNumber(source.defaultGstRate, NaN);
  const defaultGstRate = gstRates.includes(storedDefault) ? storedDefault : gstRates.includes(DEFAULT_GST_RATE) ? DEFAULT_GST_RATE : gstRates[0];

  const hsnCodes: HsnSacCode[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(source.hsnCodes) ? source.hsnCodes : []) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const kind = entry.kind === "sac" ? "sac" : "hsn";
    const code = typeof entry.code === "string" ? entry.code.trim() : "";
    const gstRate = parseFinancialNumber(entry.gstRate, NaN);
    if (!isValidTaxCode(kind, code) || !isValidGstRate(gstRate) || seen.has(code)) continue;
    seen.add(code);
    hsnCodes.push({ code, kind, description: text(entry.description, TAX_LIMITS.description), gstRate, isActive: entry.isActive !== false });
    if (hsnCodes.length >= TAX_LIMITS.hsnCodes) break;
  }
  return { gstRates, defaultGstRate, hsnCodes };
}

/** A product's stored GST rate (null = never set; its variants keep whatever rate they have). */
export function normalizeProductGstRate(stored: unknown): number | null {
  const rate = parseFinancialNumber(stored, NaN);
  return isValidGstRate(rate) ? rate : null;
}

export interface GstSplit {
  /** Unchanged: the variant's GST-inclusive price. */
  price: number;
  taxPercent: number;
  /**
   * The price without tax that resolves back to exactly `price` through `resolveVariantPricing`, or null when no
   * two-decimal value does (null is read as "absent", so the inclusive price is used as is).
   */
  priceWithoutTax: number | null;
}

/**
 * The tax fields a variant gets when its product moves to `rate`, keeping its GST-inclusive price to the paisa.
 * `resolveVariantPricing` prefers priceWithoutTax over price, so a naive `price / (1 + rate)` could move the quoted
 * price by a paisa; only a value that resolves back to the same price is used. Returns null when the stored price is
 * unreadable or cannot be kept (never for a rate up to 40%), and the caller must then leave the variant alone.
 */
export function gstSplitKeepingPrice(storedPrice: unknown, rate: number): GstSplit | null {
  const price = parseFinancialNumber(storedPrice, NaN);
  if (!Number.isFinite(price) || price < 0 || round2(price) !== price || !isValidGstRate(rate)) return null;
  if (resolveVariantPricing({ price, taxPercent: rate }).price !== price) return null;
  const base = calculateFromTaxInclusivePrice(price, rate).priceWithoutTax;
  for (const offset of [0, -0.01, 0.01, -0.02, 0.02]) {
    const candidate = round2(base + offset);
    if (candidate >= 0 && resolveVariantPricing({ price, priceWithoutTax: candidate, taxPercent: rate }).price === price) {
      return { price, taxPercent: rate, priceWithoutTax: candidate };
    }
  }
  return { price, taxPercent: rate, priceWithoutTax: null };
}
