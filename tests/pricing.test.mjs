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

// =========================================================================
// SECTION 2: QUOTATION REVIEW GST CALCULATION ENGINE TESTS
// =========================================================================

import { calculateQuotationGst } from "../src/lib/pricing.ts";

console.log("\n=== Running Quotation Review GST Calculation Tests ===");

// TEST 1 — NO DISCOUNT
// Subtotal = ₹10,000, Discount = ₹0
// Expected: Net Subtotal = ₹10,000, CGST @ 9% = ₹900, SGST @ 9% = ₹900, Grand Total = ₹11,800
{
  const res = calculateQuotationGst(10000, 0);
  console.log("GST TEST 1 (No Discount):", res);
  assert.equal(res.grossSubtotal, 10000, "grossSubtotal must be 10000");
  assert.equal(res.discountAmount, 0, "discountAmount must be 0");
  assert.equal(res.netSubtotal, 10000, "netSubtotal must be 10000");
  assert.equal(res.cgstAmount, 900, "cgstAmount must be 900");
  assert.equal(res.sgstAmount, 900, "sgstAmount must be 900");
  assert.equal(res.totalGstAmount, 1800, "totalGstAmount must be 1800");
  assert.equal(res.grandTotal, 11800, "grandTotal must be 11800");
  console.log("PASS: GST TEST 1 (Subtotal ₹10,000, Discount ₹0 -> Grand Total ₹11,800)");
}

// TEST 2 — DISCOUNT (SUBTOTAL ₹20,000, DISCOUNT ₹2,000)
// Subtotal = ₹20,000, Discount = ₹2,000
// Expected: Net Subtotal = ₹18,000, CGST @ 9% = ₹1,620, SGST @ 9% = ₹1,620, Grand Total = ₹21,240
{
  const res = calculateQuotationGst(20000, 2000);
  console.log("GST TEST 2 (Discount):", res);
  assert.equal(res.grossSubtotal, 20000, "grossSubtotal must be 20000");
  assert.equal(res.discountAmount, 2000, "discountAmount must be 2000");
  assert.equal(res.netSubtotal, 18000, "netSubtotal must be 18000");
  assert.equal(res.cgstAmount, 1620, "cgstAmount must be 1620");
  assert.equal(res.sgstAmount, 1620, "sgstAmount must be 1620");
  assert.equal(res.totalGstAmount, 3240, "totalGstAmount must be 3240");
  assert.equal(res.grandTotal, 21240, "grandTotal must be 21240");
  console.log("PASS: GST TEST 2 (Subtotal ₹20,000, Discount ₹2,000 -> Grand Total ₹21,240)");
}

// TEST 3 — SUBTOTAL ₹20,000, DISCOUNT ₹0
{
  const res = calculateQuotationGst(20000, 0);
  console.log("GST TEST 3 (Subtotal 20k, Discount 0):", res);
  assert.equal(res.grossSubtotal, 20000);
  assert.equal(res.discountAmount, 0);
  assert.equal(res.netSubtotal, 20000);
  assert.equal(res.cgstAmount, 1800);
  assert.equal(res.sgstAmount, 1800);
  assert.equal(res.totalGstAmount, 3600);
  assert.equal(res.grandTotal, 23600);
  console.log("PASS: GST TEST 3 (Subtotal ₹20,000, Discount ₹0 -> Grand Total ₹23,600)");
}

// TEST 4 — EXACT USER SPECIFICATION EXAMPLE (Gross ₹25,295.00, 10% Discount ₹2,529.50)
// Gross Subtotal = ₹25,295.00, Discount = ₹2,529.50
// Net Subtotal = ₹22,765.50
// CGST 9% = ₹2,048.90
// SGST 9% = ₹2,048.90
// Grand Total = ₹26,863.30
{
  const res = calculateQuotationGst(25295.00, 2529.50);
  console.log("GST TEST 4 (User Example ₹25,295 with 10% discount):", res);
  assert.equal(res.grossSubtotal, 25295.00);
  assert.equal(res.discountAmount, 2529.50);
  assert.equal(res.netSubtotal, 22765.50);
  assert.equal(res.cgstAmount, 2048.90);
  assert.equal(res.sgstAmount, 2048.90);
  assert.equal(res.totalGstAmount, 4097.80);
  assert.equal(res.grandTotal, 26863.30);
  console.log("PASS: GST TEST 4 (Gross ₹25,295, Discount ₹2,529.50 -> Grand Total ₹26,863.30)");
}

// TEST 5 — ZERO SUBTOTAL
{
  const res = calculateQuotationGst(0, 0);
  console.log("GST TEST 5 (Zero Subtotal):", res);
  assert.equal(res.grossSubtotal, 0);
  assert.equal(res.discountAmount, 0);
  assert.equal(res.netSubtotal, 0);
  assert.equal(res.cgstAmount, 0);
  assert.equal(res.sgstAmount, 0);
  assert.equal(res.totalGstAmount, 0);
  assert.equal(res.grandTotal, 0);
  console.log("PASS: GST TEST 5 (Subtotal ₹0, Discount ₹0 -> Grand Total ₹0)");
}

// TEST 6 — FRACTIONAL DISCOUNT (10,000 - 1,250)
// Net Subtotal = ₹8,750.00
// CGST @ 9% = round2(8750 * 0.09) = ₹787.50
// SGST @ 9% = round2(8750 * 0.09) = ₹787.50
// Grand Total = ₹8,750.00 + ₹1,575.00 = ₹10,325.00
{
  const res = calculateQuotationGst(10000, 1250);
  console.log("GST TEST 6 (Fractional discount):", res);
  assert.equal(res.grossSubtotal, 10000);
  assert.equal(res.discountAmount, 1250);
  assert.equal(res.netSubtotal, 8750);
  assert.equal(res.cgstAmount, 787.50);
  assert.equal(res.sgstAmount, 787.50);
  assert.equal(res.totalGstAmount, 1575.00);
  assert.equal(res.grandTotal, 10325.00);
  console.log("PASS: GST TEST 6 (Subtotal ₹10,000, Discount ₹1,250 -> Grand Total ₹10,325.00)");
}

// TEST 7 — NEGATIVE TAX BASE PROTECTION (Discount > Subtotal)
{
  const res = calculateQuotationGst(10000, 15000);
  console.log("GST TEST 7 (Discount > Subtotal clamp):", res);
  assert.equal(res.grossSubtotal, 10000);
  assert.equal(res.discountAmount, 10000);
  assert.equal(res.netSubtotal, 0);
  assert.equal(res.cgstAmount, 0);
  assert.equal(res.sgstAmount, 0);
  assert.equal(res.grandTotal, 0);
  console.log("PASS: GST TEST 7 (Negative tax base protected)");
}

console.log("\nAll pricing and GST calculation tests passed successfully!");
