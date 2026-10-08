// READ-ONLY. No DB connection. Reproduces Mongoose hydration of a variant doc
// that has only `price` set (no priceWithoutTax/taxPercent), exactly like a
// raw-inserted document, then runs it through the same resolveVariantPricing
// call that src/app/api/quotations/[id]/items/route.ts makes.
import { ProductVariant } from "../../src/models/ProductVariant";
import { resolveVariantPricing } from "../../src/lib/pricing";

const rawDocAsStoredInMongo = {
  _id: 102,
  productId: 10,
  variantCode: "WIFI-GLASS",
  config: { series: "wifi", finish: "glass", variantCode: "WIFI-GLASS" },
  price: { $numberDecimal: "600.00" }, // how Decimal128 looks once BSON-decoded
  isActive: true,
  sortOrder: 2,
  // NOTE: priceWithoutTax, taxPercent, cost, purchaseTaxPercent intentionally ABSENT,
  // exactly as the test fixture (and potentially real legacy/migrated data) insert them.
};

const hydrated = ProductVariant.hydrate(rawDocAsStoredInMongo);
const json = hydrated.toJSON() as unknown as Record<string, unknown>;

console.log("Hydrated variant toJSON():", json);
console.log("typeof priceWithoutTax:", typeof json.priceWithoutTax, JSON.stringify(json.priceWithoutTax));
console.log("typeof price:", typeof json.price, JSON.stringify(json.price));

const pricing = resolveVariantPricing({
  price: json.price,
  priceWithoutTax: json.priceWithoutTax,
  taxPercent: json.taxPercent,
});

console.log("resolveVariantPricing result:", pricing);
console.log(pricing.price === 600 ? "OK: price resolved to 600" : `BUG: price resolved to ${pricing.price}, expected 600`);
