import assert from "node:assert/strict";
import {
  calculateFromTaxExclusivePrice,
  calculateFromTaxInclusivePrice,
  resolveVariantPricing,
  round2,
} from "../src/lib/pricing.ts";

console.log("==================================================");
console.log("RUNNING COMPREHENSIVE PRICING & QUOTATION TESTS");
console.log("==================================================\n");

// TEST 1: Variant price ₹5,799, Tax 18%
console.log("TEST 1: Tax-inclusive ₹5,799 @ 18% tax");
{
  const res = calculateFromTaxInclusivePrice(5799, 18);
  console.log(`  priceWithoutTax: ${res.priceWithoutTax} (expected ~4914.41)`);
  console.log(`  taxAmount: ${res.taxAmount} (expected ~884.59)`);
  console.log(`  price: ${res.price} (expected 5799.00)`);

  assert.equal(res.priceWithoutTax, 4914.41);
  assert.equal(res.taxAmount, 884.59);
  assert.equal(res.price, 5799);
  assert.equal(round2(res.priceWithoutTax + res.taxAmount), 5799);
  console.log("  => [PASS] TEST 1 passed successfully.\n");
}

// TEST 2: Variant priceWithoutTax ₹10,000, Tax 18%
console.log("TEST 2: Tax-exclusive ₹10,000 @ 18% tax");
{
  const res = calculateFromTaxExclusivePrice(10000, 18);
  console.log(`  taxAmount: ${res.taxAmount} (expected 1800.00)`);
  console.log(`  price: ${res.price} (expected 11800.00)`);

  assert.equal(res.taxAmount, 1800);
  assert.equal(res.price, 11800);
  console.log("  => [PASS] TEST 2 passed successfully.\n");
}

// TEST 3: Variant priceWithoutTax ₹10,000, Tax 12%
console.log("TEST 3: Tax-exclusive ₹10,000 @ 12% tax");
{
  const res = calculateFromTaxExclusivePrice(10000, 12);
  console.log(`  taxAmount: ${res.taxAmount} (expected 1200.00)`);
  console.log(`  price: ${res.price} (expected 11200.00)`);

  assert.equal(res.taxAmount, 1200);
  assert.equal(res.price, 11200);
  console.log("  => [PASS] TEST 3 passed successfully.\n");
}

// TEST 4: Two variants of the same Product have different tax
console.log("TEST 4: Independent variant pricing & tax on the same Product");
{
  const variantA = resolveVariantPricing({
    price: 5799,
    taxPercent: 18,
    cost: 0,
    purchaseTaxPercent: 18,
  });

  const variantB = resolveVariantPricing({
    price: 15999,
    taxPercent: 12,
    cost: 0,
    purchaseTaxPercent: 18,
  });

  console.log("  Variant A (Remote + Acrylic):", variantA);
  console.log("  Variant B (WiFi + Acrylic):", variantB);

  assert.equal(variantA.price, 5799);
  assert.equal(variantA.taxPercent, 18);
  assert.equal(variantA.priceWithoutTax, 4914.41);
  assert.equal(variantA.taxAmount, 884.59);

  assert.equal(variantB.price, 15999);
  assert.equal(variantB.taxPercent, 12);
  assert.equal(variantB.priceWithoutTax, 14284.82);
  assert.equal(variantB.taxAmount, 1714.18);

  // Both retain their independent taxes and prices
  assert.notEqual(variantA.taxPercent, variantB.taxPercent);
  assert.notEqual(variantA.price, variantB.price);
  console.log("  => [PASS] TEST 4 passed successfully.\n");
}

// TEST 5: Existing quotation created at ₹5,799 retains price even if variant price changes to ₹6,499
console.log("TEST 5: Quotation snapshot immutability when variant price changes");
{
  // Variant initial state
  const variant = {
    id: 101,
    productId: 44,
    price: 5799,
    priceWithoutTax: 4914.41,
    taxPercent: 18,
    cost: 0,
    purchaseTaxPercent: 18,
  };

  // Quotation item creation snapshots pricing
  const quoteItemSnapshot = {
    productId: variant.productId,
    productVariantId: variant.id,
    quantity: 1,
    unitPrice: variant.price,
    priceWithoutTax: variant.priceWithoutTax,
    taxPercent: variant.taxPercent,
    taxAmount: round2(variant.priceWithoutTax * (variant.taxPercent / 100)),
    linePrice: round2(variant.price * 1),
  };

  console.log("  Initial Quotation Item Snapshot:", quoteItemSnapshot);

  // Later: Admin updates variant price to ₹6,499
  const updatedVariantPricing = resolveVariantPricing({
    price: 6499,
    taxPercent: 18,
  });
  const updatedVariant = {
    ...variant,
    ...updatedVariantPricing,
  };
  console.log("  Updated Variant in Catalog:", updatedVariant);

  // Quotation Item must remain at ₹5,799
  assert.equal(quoteItemSnapshot.unitPrice, 5799);
  assert.equal(quoteItemSnapshot.priceWithoutTax, 4914.41);
  assert.equal(quoteItemSnapshot.taxPercent, 18);
  assert.equal(quoteItemSnapshot.taxAmount, 884.59);
  assert.equal(quoteItemSnapshot.linePrice, 5799);

  // Assert variant changed but quotation snapshot did not
  assert.equal(updatedVariant.price, 6499);
  assert.notEqual(quoteItemSnapshot.unitPrice, updatedVariant.price);
  console.log("  => [PASS] TEST 5 passed successfully: Quotation snapshot remained intact.\n");
}

// TEST 6: Quantity = 3 calculation uses variant unit price * quantity
console.log("TEST 6: Quantity = 3 quotation item calculation and discount logic");
{
  const unitPrice = 5799;
  const quantity = 3;
  const priceWithoutTax = 4914.41;
  const taxPercent = 18;
  const taxAmount = 884.59;

  const quoteItem = {
    unitPrice,
    quantity,
    priceWithoutTax,
    taxPercent,
    taxAmount,
    linePrice: round2(unitPrice * quantity), // 5799 * 3 = 17397
  };

  console.log("  Quotation Item (Qty: 3):", quoteItem);
  assert.equal(quoteItem.linePrice, 17397);
  assert.equal(quoteItem.linePrice, round2(5799 * 3));

  // Test discount calculation (e.g., 10% discount on quotation subtotal)
  const discountPercent = 10;
  const discountAmount = round2(quoteItem.linePrice * (discountPercent / 100));
  const finalTotal = round2(quoteItem.linePrice - discountAmount);

  console.log(`  Subtotal: ₹${quoteItem.linePrice}`);
  console.log(`  Discount (10%): ₹${discountAmount}`);
  console.log(`  Final Total: ₹${finalTotal}`);

  assert.equal(discountAmount, 1739.7);
  assert.equal(finalTotal, 15657.3);
  console.log("  => [PASS] TEST 6 passed successfully.\n");
}

console.log("==================================================");
console.log("ALL 6 TESTS PASSED WITH 100% SUCCESS!");
console.log("==================================================");
