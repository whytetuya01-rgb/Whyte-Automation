/**
 * Quotation item pricing from the catalogue: the stored GST-inclusive variant price is authoritative. Reproduces the
 * root cause of the ₹0 bug (a price-only variant loaded as a Mongoose document carries the schema default
 * priceWithoutTax "0.00", which `resolveVariantPricing` preferred) and checks that every route that prices an item from
 * the catalogue now uses the one shared rule.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-item-pricing.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { ProductVariant } from "../src/models";
import { calculateQuotationGst, resolveStoredVariantPricing, resolveVariantPricing } from "../src/lib/pricing";
import { gstSplitKeepingPrice } from "../src/lib/taxSettings";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
const dec = (value: string) => mongoose.Types.Decimal128.fromString(value);
const hydrated = (fields: Record<string, unknown>) =>
  ProductVariant.hydrate({ _id: 1, companyId: 1, productId: 1, config: {}, ...fields }).toJSON() as unknown as Record<string, unknown>;

function main() {
  // ── the root cause, reproduced ──
  const legacy = hydrated({ price: dec("5799.00") });
  assert.equal(legacy.priceWithoutTax, "0.00", "a price-only row loaded as a document gets the schema default");
  assert.equal(resolveVariantPricing({ price: legacy.price, priceWithoutTax: legacy.priceWithoutTax, taxPercent: legacy.taxPercent }).price, 0, "the old add-item resolution: ₹0");
  const fixed = resolveStoredVariantPricing(legacy);
  assert.deepEqual([fixed.price, fixed.taxPercent, fixed.priceWithoutTax, fixed.taxAmount], [5799, 18, 4914.41, 884.59], "the stored ₹5,799 is used, split at its 18% GST");
  const leanLegacy = { price: dec("5799.00") };
  assert.equal(resolveStoredVariantPricing(leanLegacy).price, 5799, "lean and hydrated agree");
  pass("root cause: a hydrated price-only variant resolved to ₹0 through priceWithoutTax '0.00'; the stored price now wins (₹5,799)");

  // ── the scenarios ──
  const consistent = hydrated({ price: dec("1000.00"), priceWithoutTax: dec("847.46"), taxPercent: dec("18.00") });
  assert.equal(resolveStoredVariantPricing(consistent).price, 1000, "a variant saved by the app (price + pre-tax) is unchanged");
  assert.equal(resolveStoredVariantPricing(consistent).price, resolveVariantPricing({ price: consistent.price, priceWithoutTax: consistent.priceWithoutTax, taxPercent: consistent.taxPercent }).price, "same result as before for app-saved variants");

  for (const [price, rate] of [[5799, 5], [147.5, 12], [1000, 40], [0.99, 0.25]] as const) {
    const split = gstSplitKeepingPrice(price, rate)!;
    const configured = hydrated({ price: dec(price.toFixed(2)), taxPercent: dec(rate.toFixed(2)), priceWithoutTax: split.priceWithoutTax === null ? null : dec(split.priceWithoutTax.toFixed(2)) });
    const resolved = resolveStoredVariantPricing(configured);
    assert.deepEqual([resolved.price, resolved.taxPercent], [price, rate], `GST rate configured: ${price} @ ${rate}%`);
    assert.equal(Math.round((resolved.priceWithoutTax + resolved.taxAmount) * 100) / 100, price, "the split adds back up to the price");
  }

  const noRate = resolveStoredVariantPricing(hydrated({ price: dec("2360.00") }));
  assert.deepEqual([noRate.price, noRate.taxPercent], [2360, 18], "without an explicit rate the existing 18% default splits the price");

  assert.equal(resolveStoredVariantPricing(hydrated({ price: dec("0.00") })).price, 0, "a free product (price 0) stays ₹0");
  assert.equal(resolveStoredVariantPricing(hydrated({ price: dec("0.00"), priceWithoutTax: dec("0.00"), taxPercent: dec("18.00") })).price, 0);

  assert.equal(resolveStoredVariantPricing({ priceWithoutTax: "100.00", taxPercent: "18.00" }).price, 118, "no stored price: the pre-tax price is used, as before");
  assert.equal(resolveStoredVariantPricing({ price: "not a price", priceWithoutTax: "100.00", taxPercent: "18.00" }).price, 118, "an unreadable price never becomes ₹0 when a pre-tax price exists");
  assert.equal(resolveStoredVariantPricing({ price: null, priceWithoutTax: null }).price, 0, "nothing stored: 0, as before");
  pass("scenarios: app-saved, GST-rate configured, no explicit rate (18% default), free (₹0), pre-tax only, unreadable price");

  // ── lean and hydrated always agree; app-saved variants are unchanged ──
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 2000; i += 1) {
    const price = Math.round(random() * 5000000) / 100;
    const rate = [0, 5, 12, 18, 28, 40][i % 6];
    const asSaved = resolveVariantPricing({ price, taxPercent: rate }); // what the app stores for a price typed in
    const fields = { price: dec(asSaved.price.toFixed(2)), priceWithoutTax: dec(asSaved.priceWithoutTax.toFixed(2)), taxPercent: dec(rate.toFixed(2)) };
    const before = resolveVariantPricing({ price: fields.price, priceWithoutTax: fields.priceWithoutTax, taxPercent: fields.taxPercent }).price;
    assert.equal(resolveStoredVariantPricing(hydrated(fields)).price, asSaved.price, `stored price kept ${price} @ ${rate}`);
    assert.ok(Math.abs(Math.round(before * 100) - Math.round(asSaved.price * 100)) <= 1, "the old resolution differed by at most a paisa when both prices are stored");
    assert.equal(resolveStoredVariantPricing(hydrated({ price: fields.price })).price, resolveStoredVariantPricing({ price: fields.price }).price, "lean = hydrated");
  }
  pass("2,000 random variants: the stored GST-inclusive price is quoted exactly; lean and hydrated documents agree");

  // ── the quotation charge is untouched ──
  assert.deepEqual(calculateQuotationGst(20000, 2000), { grossSubtotal: 20000, discountAmount: 2000, netSubtotal: 18000, cgstPercent: 9, cgstAmount: 1620, sgstPercent: 9, sgstAmount: 1620, totalGstAmount: 3240, grandTotal: 21240 });
  pass("the 18% Service & Integration charge calculation is unchanged");

  // ── one rule in every route that prices an item from the catalogue ──
  const routes = {
    add: read("src", "app", "api", "quotations", "[id]", "items", "route.ts"),
    edit: read("src", "app", "api", "quotations", "[id]", "items", "[itemId]", "route.ts"),
    room: read("src", "app", "api", "quotations", "[id]", "rooms", "[roomId]", "items", "route.ts"),
    clone: read("src", "app", "api", "quotations", "[id]", "duplicate", "route.ts"),
  };
  assert.equal((routes.add.match(/resolveStoredVariantPricing\(selectedVariant\)/g) ?? []).length, 1);
  assert.equal((routes.edit.match(/resolveStoredVariantPricing\((v|match)\)/g) ?? []).length, 2, "edit: reset-to-catalogue and variant change");
  assert.equal((routes.room.match(/resolveStoredVariantPricing\(matchedVariant\)/g) ?? []).length, 1);
  assert.equal((routes.clone.match(/resolveStoredVariantPricing\((variant|liveVariant)\)/g) ?? []).length, 2);
  for (const [name, source] of Object.entries(routes)) {
    assert.ok(!/priceWithoutTax:\s*(selectedVariant|match|matchedVariant|variant|liveVariant|v)\.priceWithoutTax/.test(source), `${name}: no route resolves a variant through its priceWithoutTax first`);
  }
  pass("add, edit (reset + variant change), room edit and clone all use the same stored-price rule");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
