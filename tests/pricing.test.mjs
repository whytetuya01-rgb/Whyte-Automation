import assert from "node:assert/strict";
import {
  calculateFromTaxInclusivePrice,
  calculateFromTaxExclusivePrice,
  resolveVariantPricing,
  round2,
} from "../src/lib/pricing.ts";

console.log("=== Running Pricing Engine Tests ===");

// TEST 1: Variant price ₹5,799, Tax 18%
{
  const res = calculateFromTaxInclusivePrice(5799, 18);
  console.log("TEST 1 result:", res);
  assert.equal(res.priceWithoutTax, 4914.41, "priceWithoutTax should be 4914.41");
  assert.equal(res.taxAmount, 884.59, "taxAmount should be 884.59");
  assert.equal(res.price, 5799, "price should be 5799");
  assert.equal(round2(res.priceWithoutTax + res.taxAmount), 5799, "sum must equal price");
  console.log("PASS: TEST 1 (5799 @ 18%)");
}

// TEST 2: Variant priceWithoutTax ₹10,000, Tax 18%
{
  const res = calculateFromTaxExclusivePrice(10000, 18);
  console.log("TEST 2 result:", res);
  assert.equal(res.taxAmount, 1800, "taxAmount should be 1800");
  assert.equal(res.price, 11800, "price should be 11800");
  assert.equal(res.priceWithoutTax, 10000, "priceWithoutTax should be 10000");
  console.log("PASS: TEST 2 (10000 @ 18%)");
}

// TEST 3: Variant priceWithoutTax ₹10,000, Tax 12%
{
  const res = calculateFromTaxExclusivePrice(10000, 12);
  console.log("TEST 3 result:", res);
  assert.equal(res.taxAmount, 1200, "taxAmount should be 1200");
  assert.equal(res.price, 11200, "price should be 11200");
  assert.equal(res.priceWithoutTax, 10000, "priceWithoutTax should be 10000");
  console.log("PASS: TEST 3 (10000 @ 12%)");
}

// TEST 4: Two variants of same product with independent tax
{
  const variantA = resolveVariantPricing({ price: 5799, taxPercent: 18 });
  const variantB = resolveVariantPricing({ price: 15999, taxPercent: 12 });

  console.log("TEST 4 Variant A:", variantA);
  console.log("TEST 4 Variant B:", variantB);

  assert.equal(variantA.taxPercent, 18);
  assert.equal(variantA.price, 5799);
  assert.equal(variantA.priceWithoutTax, 4914.41);
  assert.equal(variantA.taxAmount, 884.59);

  assert.equal(variantB.taxPercent, 12);
  assert.equal(variantB.price, 15999);
  // 15999 / 1.12 = 14284.8214... -> 14284.82
  assert.equal(variantB.priceWithoutTax, 14284.82);
  assert.equal(variantB.taxAmount, 1714.18);
  assert.equal(round2(variantB.priceWithoutTax + variantB.taxAmount), 15999);

  console.log("PASS: TEST 4 (Independent variant pricing and tax rates)");
}

console.log("All pricing engine unit tests passed successfully!");
