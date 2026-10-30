import mongoose, { type ClientSession } from "mongoose";
import { Company, Product, ProductVariant } from "@/models";
import { ApiError } from "@/lib/api-response";
import { parseFinancialNumber, resolveVariantPricing } from "@/lib/pricing";
import { formatGstRate, gstSplitKeepingPrice, normalizeProductGstRate, normalizeTaxSettings, type CompanyTaxSettings } from "@/lib/taxSettings";

/**
 * Server side of product GST (#3, batch 2): the company's tax settings, the checks a product's HSN/SAC code and GST
 * rate must pass, and moving variants to a new GST rate without changing any price. Every query runs through the
 * tenant-scoped models, so only the acting company's products are read or written.
 */

export async function loadCompanyTaxSettings(companyId: number): Promise<CompanyTaxSettings> {
  const company = await Company.findById(companyId).select("taxSettings").lean();
  return normalizeTaxSettings(company?.taxSettings);
}

/**
 * A product's HSN/SAC code and GST rate must come from the company's own lists. A value the product already has is
 * accepted even if it was since deactivated, so an unrelated edit never fails on it.
 */
export function assertProductTaxAllowed(
  settings: CompanyTaxSettings,
  next: { hsnCode?: string | null; gstRate?: number | null },
  current: { hsnCode?: string | null; gstRate?: number | null } = {}
): void {
  if (next.hsnCode && next.hsnCode !== (current.hsnCode ?? null)) {
    const entry = settings.hsnCodes.find((row) => row.code === next.hsnCode);
    if (!entry) throw new ApiError("VALIDATION_ERROR", `HSN/SAC code ${next.hsnCode} is not in your company's list.`, { field: "hsnCode" });
    if (!entry.isActive) throw new ApiError("VALIDATION_ERROR", `HSN/SAC code ${next.hsnCode} is inactive.`, { field: "hsnCode" });
  }
  const rate = next.gstRate;
  if (rate !== undefined && rate !== null && rate !== normalizeProductGstRate(current.gstRate) && !settings.gstRates.includes(rate)) {
    throw new ApiError("VALIDATION_ERROR", `${formatGstRate(rate)} is not one of your company's GST rates.`, { field: "gstRate" });
  }
}

export interface GstApplyResult {
  /** Variants of the products. */
  variants: number;
  /** Variants whose tax split was rewritten. */
  changed: number;
  /** Variants whose stored price-without-tax did not resolve to their GST-inclusive price; they now do. */
  realigned: number;
}

type VariantTaxRow = { _id: number; price?: unknown; priceWithoutTax?: unknown; taxPercent?: unknown };

/** The writes that move these variants to `rate`, keeping every GST-inclusive `price` exactly. Throws (nothing written) if one cannot be kept. */
export function planGstRateChange(variants: ReadonlyArray<VariantTaxRow>, rate: number): { ops: Array<{ id: number; taxPercent: number; priceWithoutTax: number | null }>; realigned: number } {
  const ops: Array<{ id: number; taxPercent: number; priceWithoutTax: number | null }> = [];
  let realigned = 0;
  for (const variant of variants) {
    const split = gstSplitKeepingPrice(variant.price, rate);
    if (!split) {
      throw new ApiError("CONFLICT", `The price of variant ${variant._id} cannot be kept at ${formatGstRate(rate)}, so nothing was changed.`, { field: "gstRate" });
    }
    const storedWithoutTax = variant.priceWithoutTax === null || variant.priceWithoutTax === undefined ? null : parseFinancialNumber(variant.priceWithoutTax, NaN);
    if (parseFinancialNumber(variant.taxPercent, NaN) === rate && storedWithoutTax === split.priceWithoutTax) continue;
    if (storedWithoutTax !== null && resolveVariantPricing({ price: variant.price, priceWithoutTax: storedWithoutTax, taxPercent: variant.taxPercent }).price !== split.price) {
      realigned += 1;
    }
    ops.push({ id: variant._id, taxPercent: rate, priceWithoutTax: split.priceWithoutTax });
  }
  return { ops, realigned };
}

/**
 * Moves every variant of these products to `rate`. Only `taxPercent` and `priceWithoutTax` are written: the
 * GST-inclusive `price`, cost and everything else stay as they are, and quotation items keep the snapshot they were
 * added with. All-or-nothing: if any price cannot be kept, nothing is written.
 */
export async function applyGstRateToVariants(productIds: number[], rate: number, session?: ClientSession): Promise<GstApplyResult> {
  if (productIds.length === 0) return { variants: 0, changed: 0, realigned: 0 };
  let query = ProductVariant.find({ productId: { $in: productIds } }).select("price priceWithoutTax taxPercent").lean<VariantTaxRow[]>();
  if (session) query = query.session(session);
  const variants = await query;
  const { ops, realigned } = planGstRateChange(variants, rate);
  if (ops.length > 0) {
    const now = new Date();
    // An explicit null (not a missing field) is what keeps the inclusive price: see `gstSplitKeepingPrice`.
    const writes = ops.map((op) => ({
      updateOne: {
        filter: { _id: op.id },
        update: {
          $set: {
            taxPercent: mongoose.Types.Decimal128.fromString(op.taxPercent.toFixed(2)),
            priceWithoutTax: op.priceWithoutTax === null ? null : mongoose.Types.Decimal128.fromString(op.priceWithoutTax.toFixed(2)),
            updatedAt: now,
          },
        },
      },
    })) as unknown as Parameters<typeof ProductVariant.bulkWrite>[0];
    await ProductVariant.bulkWrite(writes, session ? { session } : {});
  }
  return { variants: variants.length, changed: ops.length, realigned };
}

/** How many of the company's products use each HSN/SAC code and each GST rate. */
export async function productTaxUsage(): Promise<{ byCode: Record<string, number>; byRate: Record<string, number>; unclassified: number; total: number }> {
  const products = await Product.find({}).select("hsnCode gstRate").lean();
  const byCode: Record<string, number> = {};
  const byRate: Record<string, number> = {};
  let unclassified = 0;
  for (const product of products) {
    if (product.hsnCode) byCode[product.hsnCode] = (byCode[product.hsnCode] ?? 0) + 1;
    else unclassified += 1;
    const rate = normalizeProductGstRate(product.gstRate);
    if (rate !== null) byRate[String(rate)] = (byRate[String(rate)] ?? 0) + 1;
  }
  return { byCode, byRate, unclassified, total: products.length };
}
