/**
 * GST rates and HSN/SAC codes (#3, batch 2). Pure helpers, the price-keeping tax split (property-checked across many
 * prices and rates, on BOTH ways the app resolves a variant price, including a hydrated Mongoose document), the
 * variant change plan, validation, the untouched quotation 18% charge, and static guards on the routes.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/tax-settings.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { ProductVariant } from "../src/models";
import { calculateQuotationGst, QUOTATION_CGST_PERCENT, QUOTATION_SGST_PERCENT, resolveVariantPricing } from "../src/lib/pricing";
import { DEFAULT_GST_RATES, formatGstRate, gstSplitKeepingPrice, isValidGstRate, isValidTaxCode, normalizeProductGstRate, normalizeTaxSettings, taxCodeLabel } from "../src/lib/taxSettings";
import { planGstRateChange } from "../src/lib/productTax";
import { gstRatesSchema, hsnCodeCreateSchema, hsnCodeUpdateSchema } from "../src/lib/validation/taxSettings";
import { updateProductSchema } from "../src/lib/validation/product";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

function main() {
  // ── settings ──
  const fresh = normalizeTaxSettings(undefined);
  assert.deepEqual(fresh, { gstRates: [0, 5, 18, 40], defaultGstRate: 18, hsnCodes: [] });
  fresh.gstRates.push(99);
  assert.deepEqual(normalizeTaxSettings(null).gstRates, [...DEFAULT_GST_RATES], "the defaults are never shared or mutated");
  const stored = normalizeTaxSettings({
    gstRates: [18, 5, 18, "12", -1, 101, 0.255, 0.25],
    defaultGstRate: 28,
    hsnCodes: [
      { code: "8536", kind: "hsn", description: "  Switches  ", gstRate: 18 },
      { code: "8536", kind: "hsn", gstRate: 5 },
      { code: "998713", kind: "sac", gstRate: 18, isActive: false },
      { code: "12", kind: "hsn", gstRate: 18 },
      { code: "123456", kind: "sac", gstRate: 18 },
      { code: "85171300", kind: "hsn", gstRate: 1000 },
    ],
  });
  assert.deepEqual(stored.gstRates, [0.25, 5, 12, 18], "valid rates, once each, ascending");
  assert.equal(stored.defaultGstRate, 18, "a default outside the list falls back to 18");
  assert.deepEqual(stored.hsnCodes, [
    { code: "8536", kind: "hsn", description: "Switches", gstRate: 18, isActive: true },
    { code: "998713", kind: "sac", description: null, gstRate: 18, isActive: false },
  ], "valid codes only (HSN 4/6/8 digits, SAC 99xxxx), first of a duplicate wins");
  assert.equal(normalizeTaxSettings({ gstRates: [5, 12] }).defaultGstRate, 5, "no 18 in the list: the lowest rate");
  pass("stored settings read back safely: defaults 0/5/18/40 at 18%, valid rates and codes only, fresh objects");

  assert.ok(isValidTaxCode("hsn", "8536") && isValidTaxCode("hsn", "853690") && isValidTaxCode("hsn", "85369090"));
  assert.ok(!isValidTaxCode("hsn", "853") && !isValidTaxCode("hsn", "85369") && !isValidTaxCode("hsn", "8536a"));
  assert.ok(isValidTaxCode("sac", "998713") && !isValidTaxCode("sac", "123456") && !isValidTaxCode("sac", "9987"));
  assert.ok([0, 0.25, 0.29, 3, 18, 40, 100].every(isValidGstRate));
  assert.ok(![-1, 100.01, 0.295, Number.NaN, Infinity, "18" as unknown].some(isValidGstRate));
  assert.deepEqual([formatGstRate(18), formatGstRate(0.25), formatGstRate(1.5)], ["18%", "0.25%", "1.5%"]);
  assert.equal(taxCodeLabel({ code: "8536", kind: "hsn", description: "Switches", gstRate: 18 }), "HSN 8536 · Switches (18%)");
  assert.deepEqual([normalizeProductGstRate(null), normalizeProductGstRate(undefined), normalizeProductGstRate(5), normalizeProductGstRate(-3)], [null, null, 5, null]);
  pass("HSN/SAC code formats, GST rate bounds (two decimals, float-safe) and labels");

  // ── the price-keeping split: property check ──
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const prices = [0, 0.01, 0.99, 1, 99, 147.5, 999.99, 1000, 5799, 12345.67, 99999.99, 250000];
  for (let i = 0; i < 1500; i += 1) prices.push(Math.round(random() * 20000000) / 100);
  const rates = [0, 0.25, 3, 5, 12, 18, 28, 40];
  let checked = 0;
  let nullSplits = 0;
  for (const price of prices) {
    for (const rate of rates) {
      const split = gstSplitKeepingPrice(price, rate);
      assert.ok(split, `price ${price} at ${rate}% must be keepable`);
      assert.equal(split.price, price);
      // The add-item route resolves with priceWithoutTax first; the room route with the price first. Both keep it.
      assert.equal(resolveVariantPricing({ price, priceWithoutTax: split.priceWithoutTax, taxPercent: rate }).price, price, `pwt path ${price} @ ${rate}`);
      assert.equal(resolveVariantPricing({ price, taxPercent: rate }).price, price, `price path ${price} @ ${rate}`);
      if (split.priceWithoutTax === null) nullSplits += 1;
      else assert.ok(Math.abs(split.priceWithoutTax - price / (1 + rate / 100)) <= 0.021, "the split is the true pre-tax price to within 2 paise");
      checked += 1;
    }
  }
  assert.equal(gstSplitKeepingPrice("abc", 18), null);
  assert.equal(gstSplitKeepingPrice(10.005, 18), null, "only two-decimal prices");
  assert.equal(gstSplitKeepingPrice(100, 7.123), null, "only valid rates");
  pass(`a GST rate change keeps every price to the paisa on both resolution paths (${checked} price/rate pairs; ${nullSplits} use the inclusive price as is)`);

  // ── what the add-item route actually sees: a hydrated document ──
  const nullCase = prices.find((price) => gstSplitKeepingPrice(price, 18)?.priceWithoutTax === null);
  assert.ok(nullCase !== undefined, "the sample includes a price with no exact pre-tax value");
  for (const [price, rate] of [[5799, 5], [1000, 18], [147.5, 12], [0.99, 40], [nullCase, 18]] as const) {
    const split = gstSplitKeepingPrice(price, rate)!;
    const doc = ProductVariant.hydrate({
      _id: 1, companyId: 1, productId: 1, config: {},
      price: mongoose.Types.Decimal128.fromString(price.toFixed(2)),
      taxPercent: mongoose.Types.Decimal128.fromString(rate.toFixed(2)),
      priceWithoutTax: split.priceWithoutTax === null ? null : mongoose.Types.Decimal128.fromString(split.priceWithoutTax.toFixed(2)),
    });
    const json = doc.toJSON() as unknown as Record<string, unknown>;
    assert.equal(resolveVariantPricing({ price: json.price, priceWithoutTax: json.priceWithoutTax, taxPercent: json.taxPercent }).price, price, `hydrated ${price} @ ${rate}`);
  }
  pass("after the change, a hydrated variant (as POST /api/quotations/[id]/items loads it) resolves to the same price");

  // ── the variant change plan ──
  const dec = (value: string) => mongoose.Types.Decimal128.fromString(value);
  const plan = planGstRateChange(
    [
      { _id: 1, price: dec("5799.00") }, // price only (older catalogue rows)
      { _id: 2, price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00") }, // consistent, same rate
      { _id: 3, price: dec("1000.00"), priceWithoutTax: dec("800.00"), taxPercent: dec("18.00") }, // pre-tax price disagrees with the price
    ],
    18
  );
  assert.deepEqual(plan.ops.map((op) => op.id), [1, 3], "an already-consistent variant at the same rate is not rewritten");
  assert.equal(plan.realigned, 1, "the disagreeing one is reported");
  assert.ok(plan.ops.every((op) => op.taxPercent === 18 && !("price" in op)), "only the tax split is planned, never the price");
  assert.throws(() => planGstRateChange([{ _id: 9, price: "not a price" }], 5), /cannot be kept/);
  pass("the variant plan rewrites only taxPercent + priceWithoutTax, skips consistent rows, reports realigned ones, refuses an unreadable price");

  // ── validation ──
  const rates1 = gstRatesSchema.safeParse({ gstRates: [18, 0, 5], defaultGstRate: 5 });
  assert.ok(rates1.success && rates1.data.gstRates.join() === "0,5,18");
  for (const bad of [{ gstRates: [], defaultGstRate: 0 }, { gstRates: [5, 5], defaultGstRate: 5 }, { gstRates: [5], defaultGstRate: 18 }, { gstRates: [101], defaultGstRate: 101 }, { gstRates: [5], defaultGstRate: 5, companyId: 2 }, { gstRates: ["5"], defaultGstRate: 5 }]) {
    assert.equal(gstRatesSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.ok(hsnCodeCreateSchema.safeParse({ kind: "hsn", code: " 8536 ", description: "Switches", gstRate: 18 }).success);
  assert.ok(hsnCodeCreateSchema.safeParse({ kind: "sac", code: "998713", gstRate: 18, isActive: false }).success);
  for (const bad of [{ kind: "hsn", code: "85", gstRate: 18 }, { kind: "sac", code: "853690", gstRate: 18 }, { kind: "gst", code: "8536", gstRate: 18 }, { kind: "hsn", code: "8536", gstRate: 18, companyId: 2 }, { kind: "hsn", code: "8536", gstRate: 18, description: "bad\u0007" }]) {
    assert.equal(hsnCodeCreateSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.equal(hsnCodeUpdateSchema.safeParse({}).success, false, "an empty edit is refused");
  assert.equal(hsnCodeUpdateSchema.safeParse({ code: "9999" }).success, false, "the code itself cannot be edited");
  const productTax = updateProductSchema.safeParse({ hsnCode: " 8536 ", gstRate: 5 });
  assert.ok(productTax.success && productTax.data.hsnCode === "8536" && productTax.data.gstRate === 5);
  const cleared = updateProductSchema.safeParse({ hsnCode: "", gstRate: null });
  assert.ok(cleared.success && cleared.data.hsnCode === null && cleared.data.gstRate === null);
  assert.equal(updateProductSchema.safeParse({ gstRate: 101 }).success, false);
  assert.equal(updateProductSchema.safeParse({ hsnCode: "85a6" }).success, false);
  assert.ok(updateProductSchema.safeParse({ isActive: false }).success, "unrelated product edits are unaffected");
  pass("validation: rates (unique, 1-12, default among them), codes by kind, immutable code, product fields optional and strict");

  // ── the quotation 18% charge is untouched ──
  assert.deepEqual(calculateQuotationGst(20000, 2000), { grossSubtotal: 20000, discountAmount: 2000, netSubtotal: 18000, cgstPercent: 9, cgstAmount: 1620, sgstPercent: 9, sgstAmount: 1620, totalGstAmount: 3240, grandTotal: 21240 });
  assert.equal(QUOTATION_CGST_PERCENT + QUOTATION_SGST_PERCENT, 18);
  pass("the quotation Service & Integration charge (18%) and its calculation are unchanged");

  // ── static guards ──
  const list = read("src", "app", "api", "catalog", "tax-settings", "route.ts");
  assert.ok(/withPermission\("catalog:read"/.test(list) && /withPermission\("catalog:edit"/.test(list) && (list.match(/requireActiveCompany\(actor\)/g) ?? []).length === 2);
  for (const parts of [["hsn-codes", "route.ts"], ["hsn-codes", "[code]", "route.ts"], ["hsn-codes", "[code]", "apply", "route.ts"]]) {
    const source = read("src", "app", "api", "catalog", "tax-settings", ...parts);
    assert.ok(/withPermission\("catalog:edit"/.test(source) && /requireActiveCompany\(actor\)/.test(source), parts.join("/"));
    assert.ok(!/body\.companyId|input\.companyId|searchParams/.test(source), `${parts.join("/")}: the company never comes from the request`);
  }
  const helper = read("src", "lib", "productTax.ts");
  assert.ok(!/QuotationItem|Quotation\b/.test(helper), "the tax helper never touches quotations");
  assert.ok(!/\bprice:\s*mongoose/.test(helper), "it never writes a price");
  const patch = read("src", "app", "api", "products", "[id]", "route.ts");
  assert.ok(/data\.gstRate !== normalizeProductGstRate\(existingProduct\.gstRate\)/.test(patch), "only a changed rate re-splits the variants");
  assert.ok(patch.indexOf("applyGstRateToVariants([productId]") < patch.indexOf("Product.findByIdAndUpdate(productId"), "variants are planned before the product is written");
  const company = read("src", "models", "Company.ts");
  assert.ok(/taxSettings: \{\s*type: new Schema/.test(company) && /taxSettings\.hsnCodes/.test(company), "settings live on the company document (no migration)");
  pass("static guards: permission-checked, acting company only, company never from the request, quotations and prices never written");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
