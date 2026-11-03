/**
 * Per-product discount rules (pure): who may give one, how it is worked out, what is acceptable, when a stored one is stale.
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/item-discount.test.ts
 */
import assert from "node:assert/strict";
import { basePriceBeforeDiscount, canGiveItemDiscount, discountPerUnit, intactItemDiscount, itemDiscountLabel, netUnitPrice, previewItemDiscount, validateItemDiscount } from "../src/lib/itemDiscount";
import { updateQuotationItemSchema } from "../src/lib/validation/quotation";

let count = 0;
const pass = (name: string) => { count += 1; console.log(`  ✓ ${name}`); };

for (const role of ["admin", "company_owner", " Admin ", "COMPANY_OWNER"]) assert.equal(canGiveItemDiscount(role), true, role);
for (const role of ["dealer", "sales_executive", "super_admin", "configurable_admin", "sales", "", null, undefined]) assert.equal(canGiveItemDiscount(role), false, String(role));
pass("only an Admin or a Company Owner may give a per-product discount");

assert.equal(netUnitPrice(1000, "percentage", 10), 900);
assert.equal(netUnitPrice(1000, "percentage", 12.5), 875);
assert.equal(netUnitPrice(4599, "percentage", 7), 4277.07);
assert.equal(netUnitPrice(1000, "fixed", 150), 850);
assert.equal(netUnitPrice(1000, "percentage", 100), 0);
assert.equal(netUnitPrice(1000, "fixed", 1000), 0);
assert.equal(netUnitPrice(100, "fixed", 150), 0, "never below zero");
assert.equal(discountPerUnit(1000, "percentage", 10), 100);
assert.equal(discountPerUnit(333, "percentage", 10), 33.3);
assert.equal(discountPerUnit(1000, "fixed", 150), 150);
pass("a percentage or fixed amount comes off each unit, to the paisa, never below zero");

assert.equal(validateItemDiscount(1000, "percentage", 10), null);
assert.equal(validateItemDiscount(1000, "percentage", 100), null);
assert.equal(validateItemDiscount(1000, "fixed", 1000), null);
assert.match(validateItemDiscount(1000, "percentage", 0) ?? "", /greater than zero/);
assert.match(validateItemDiscount(1000, "percentage", -5) ?? "", /greater than zero/);
assert.match(validateItemDiscount(1000, "percentage", Number.NaN) ?? "", /greater than zero/);
assert.match(validateItemDiscount(1000, "percentage", 100.5) ?? "", /more than 100%/);
assert.match(validateItemDiscount(1000, "fixed", 1000.01) ?? "", /more than the unit price/);
assert.match(validateItemDiscount(1000, "percentage", 10.123) ?? "", /2 decimal/);
pass("zero, negative, over 100%, more than the price and more than 2 decimals are all refused with a reason");

assert.deepEqual(previewItemDiscount(1000, 3, "percentage", 10), { perUnit: 100, netUnit: 900, lineBefore: 3000, lineAfter: 2700, saving: 300 });
assert.deepEqual(previewItemDiscount(500, 2, "fixed", 50), { perUnit: 50, netUnit: 450, lineBefore: 1000, lineAfter: 900, saving: 100 });
assert.equal(previewItemDiscount(1000, 0, "percentage", 10).lineBefore, 1000, "a quantity under one counts as one");
pass("the live preview shows the saving per unit, the new price and the line before and after");

const stored = { unitPrice: 900, discountType: "percentage", discountValue: 10, preDiscountUnitPrice: 1000 };
assert.deepEqual(intactItemDiscount(stored), { type: "percentage", value: 10, preDiscountUnitPrice: 1000 });
assert.equal(basePriceBeforeDiscount(stored), 1000);
assert.equal(intactItemDiscount({ ...stored, unitPrice: 5000 }), null, "the price was changed some other way: the stored discount is stale");
assert.equal(basePriceBeforeDiscount({ ...stored, unitPrice: 5000 }), 5000, "so the current price is the base");
assert.equal(intactItemDiscount({ unitPrice: 900 }), null);
assert.equal(intactItemDiscount({ ...stored, discountType: "none" }), null);
assert.equal(intactItemDiscount({ ...stored, discountValue: 0 }), null);
assert.equal(intactItemDiscount({ ...stored, preDiscountUnitPrice: null }), null);
assert.deepEqual(intactItemDiscount({ unitPrice: "850.00", discountType: "fixed", discountValue: "150", preDiscountUnitPrice: "1000.00" }), { type: "fixed", value: 150, preDiscountUnitPrice: 1000 });
pass("a stored discount counts only while it still explains the unit price; text numbers are read too");

assert.equal(itemDiscountLabel("percentage", 10), "10% off");
assert.equal(itemDiscountLabel("fixed", 500), "₹500 off");
pass("badge labels: 10% off, ₹500 off");

assert.deepEqual(updateQuotationItemSchema.parse({ discountType: "percentage", discountValue: 10 }), { discountType: "percentage", discountValue: 10 });
assert.equal(updateQuotationItemSchema.parse({ discountType: "none" }).discountType, "none");
assert.throws(() => updateQuotationItemSchema.parse({ discountType: "bogus", discountValue: 1 }));
assert.throws(() => updateQuotationItemSchema.parse({ discountType: "fixed", discountValue: -1 }));
assert.throws(() => updateQuotationItemSchema.parse({ discountType: "fixed", discountValue: "5" }));
pass("the item schema accepts a type and a number, and refuses an unknown type, a negative or a text amount");

console.log(`\nALL ${count} ITEM DISCOUNT TESTS PASSED`);
