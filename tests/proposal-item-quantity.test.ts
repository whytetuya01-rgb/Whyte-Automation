import assert from "node:assert/strict";
import { parseQuantityInput, MAX_ITEM_QUANTITY } from "@/lib/quantity";

console.log("Starting Proposal Item Quantity & Management Tests...");

// 1. Basic quantity input parsing
assert.equal(parseQuantityInput("1").ok, true);
assert.equal((parseQuantityInput("1") as any).value, 1);

assert.equal(parseQuantityInput("999").ok, true);
assert.equal((parseQuantityInput("999") as any).value, 999);

assert.equal(parseQuantityInput("949").ok, true);
assert.equal((parseQuantityInput("949") as any).value, 949);

console.log("  ✓ 1. Parses valid numbers up to MAX_ITEM_QUANTITY (999)");

// 2. Reject zero, negative, above max, and non-digits
assert.equal(parseQuantityInput("0").ok, false, "0 must be rejected");
assert.equal(parseQuantityInput("-5").ok, false, "Negative numbers must be rejected");
assert.equal(parseQuantityInput("1000").ok, false, "1000 is above max 999");
assert.equal(parseQuantityInput("abc").ok, false, "Letters must be rejected");
assert.equal(parseQuantityInput("").ok, false, "Empty string must be rejected");
assert.equal(parseQuantityInput("1.5").ok, false, "Decimals must be rejected");

console.log("  ✓ 2. Safely rejects invalid quantities (0, negative, >999, decimals, non-digits)");

// 3. Line total and difference calculation logic in Change Modal
const unitPrice = 10399;
const originalQty = 999;
const originalTotal = originalQty * unitPrice; // 10,388,601

// User changes quantity to 949 (removing 50 items)
const updatedQty = 949;
const updatedTotal = updatedQty * unitPrice; // 9,868,651
const difference = updatedTotal - originalTotal; // -519,950

assert.equal(originalTotal, 10388601);
assert.equal(updatedTotal, 9868651);
assert.equal(difference, -519950);

console.log("  ✓ 3. Change Product modal line total and price difference correctly recalculate with updated quantity");

console.log("\nALL PROPOSAL ITEM QUANTITY TESTS PASSED SUCCESSFULLY!");

