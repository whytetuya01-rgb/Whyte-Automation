import assert from "node:assert/strict";
import { calculateQuotationGst } from "../src/lib/pricing.ts";
import { normalizeQuotation, serializeQuotationForClient } from "../src/lib/quotationNormalization.ts";

console.log("==================================================");
console.log("RUNNING END-TO-END PRICING CONSISTENCY TESTS");
console.log("==================================================");

// TEST CASE 1: Subtotal = 20,000, Discount = 2,000
// Expected: Net Subtotal = 18,000, CGST @ 9% = 1,620, SGST @ 9% = 1,620, Grand Total = 21,240
{
  const calc = calculateQuotationGst(20000, 2000);
  assert.equal(calc.grossSubtotal, 20000);
  assert.equal(calc.discountAmount, 2000);
  assert.equal(calc.netSubtotal, 18000);
  assert.equal(calc.cgstAmount, 1620);
  assert.equal(calc.sgstAmount, 1620);
  assert.equal(calc.totalGstAmount, 3240);
  assert.equal(calc.grandTotal, 21240);

  // Test through quotation normalization
  const mockQuotation = {
    _id: "q-test-1",
    rooms: [
      {
        id: 1,
        items: [
          { quantity: 2, unitPrice: 10000 }
        ]
      }
    ],
    discountType: "fixed",
    discountValue: "2000"
  };

  const normalized = normalizeQuotation(mockQuotation);
  assert.equal(normalized.subtotal, 20000);
  assert.equal(normalized.discountAmount, 2000);
  assert.equal(normalized.netSubtotal, 18000);
  assert.equal(normalized.cgstAmount, 1620);
  assert.equal(normalized.sgstAmount, 1620);
  assert.equal(normalized.totalGstAmount, 3240);
  assert.equal(normalized.grandTotal, 21240);

  const serialized = serializeQuotationForClient(normalized);
  assert.equal(serialized.subtotal, 20000);
  assert.equal(serialized.discountAmount, 2000);
  assert.equal(serialized.netSubtotal, 18000);
  assert.equal(serialized.cgstAmount, 1620);
  assert.equal(serialized.sgstAmount, 1620);
  assert.equal(serialized.totalGstAmount, 3240);
  assert.equal(serialized.grandTotal, 21240);

  console.log("PASS: TEST CASE 1 (Subtotal ₹20k, Discount ₹2k -> Grand Total ₹21,240)");
}

// TEST CASE 2: Subtotal = 20,000, Discount = 0
// Expected: Net Subtotal = 20,000, CGST @ 9% = 1,800, SGST @ 9% = 1,800, Grand Total = 23,600
{
  const calc = calculateQuotationGst(20000, 0);
  assert.equal(calc.grossSubtotal, 20000);
  assert.equal(calc.discountAmount, 0);
  assert.equal(calc.netSubtotal, 20000);
  assert.equal(calc.cgstAmount, 1800);
  assert.equal(calc.sgstAmount, 1800);
  assert.equal(calc.totalGstAmount, 3600);
  assert.equal(calc.grandTotal, 23600);

  const mockQuotation = {
    _id: "q-test-2",
    rooms: [
      {
        id: 1,
        items: [
          { quantity: 2, unitPrice: 10000 }
        ]
      }
    ],
    discountType: "none",
    discountValue: "0"
  };

  const normalized = normalizeQuotation(mockQuotation);
  assert.equal(normalized.subtotal, 20000);
  assert.equal(normalized.discountAmount, 0);
  assert.equal(normalized.netSubtotal, 20000);
  assert.equal(normalized.cgstAmount, 1800);
  assert.equal(normalized.sgstAmount, 1800);
  assert.equal(normalized.grandTotal, 23600);

  console.log("PASS: TEST CASE 2 (Subtotal ₹20k, Discount ₹0 -> Grand Total ₹23,600)");
}

// TEST CASE 3: Multi-room, multi-product quotation
{
  const mockQuotation = {
    _id: "q-test-3",
    rooms: [
      {
        id: 1,
        items: [
          { quantity: 3, unitPrice: 5000 },  // 15000
          { quantity: 2, unitPrice: 2500 }   // 5000 -> 20000
        ]
      },
      {
        id: 2,
        items: [
          { quantity: 1, unitPrice: 10000 }  // 10000 -> 30000 total
        ]
      }
    ],
    discountType: "percentage",
    discountValue: "10" // 10% of 30,000 = 3,000
  };

  const normalized = normalizeQuotation(mockQuotation);
  assert.equal(normalized.subtotal, 30000);
  assert.equal(normalized.discountAmount, 3000);
  assert.equal(normalized.netSubtotal, 27000);
  assert.equal(normalized.cgstAmount, 2430);
  assert.equal(normalized.sgstAmount, 2430);
  assert.equal(normalized.totalGstAmount, 4860);
  assert.equal(normalized.grandTotal, 31860);

  console.log("PASS: TEST CASE 3 (Multi-room multi-product consistency)");
}

// TEST CASE 4: Zero Subtotal
{
  const calc = calculateQuotationGst(0, 0);
  assert.equal(calc.grossSubtotal, 0);
  assert.equal(calc.discountAmount, 0);
  assert.equal(calc.netSubtotal, 0);
  assert.equal(calc.cgstAmount, 0);
  assert.equal(calc.sgstAmount, 0);
  assert.equal(calc.grandTotal, 0);
  assert.ok(!Number.isNaN(calc.grandTotal));
  console.log("PASS: TEST CASE 4 (Zero Subtotal safety)");
}

console.log("==================================================");
console.log("ALL END-TO-END CONSISTENCY TESTS PASSED 100%!");
console.log("==================================================");
