/**
 * Bulk price rules (pure): percent / fixed, direction, rounding to 1 or 10, GST split kept, what is skipped and why.
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/bulk-pricing.test.ts
 */
import assert from "node:assert/strict";
import { applyRounding, newPriceFor, planBulkPrice, ruleProblem, type BulkPriceRule } from "../src/lib/bulkPricing";
import { resolveVariantPricing } from "../src/lib/pricing";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const rule = (over: Partial<BulkPriceRule>): BulkPriceRule => ({ mode: "percent", direction: "increase", value: 10, rounding: "none", ...over });

// ── rounding ──
assert.equal(applyRounding(1234.567, "none"), 1234.57);
assert.equal(applyRounding(1234.4, "1"), 1234);
assert.equal(applyRounding(1234.5, "1"), 1235);
assert.equal(applyRounding(1234, "10"), 1230);
assert.equal(applyRounding(1235, "10"), 1240, "halves round up");
assert.equal(applyRounding(4, "10"), 0);
pass("rounding to the paisa, the rupee or ten rupees, halves up");

// ── the new price ──
assert.equal(newPriceFor(1000, rule({ value: 10 })), 1100);
assert.equal(newPriceFor(1000, rule({ value: 10, direction: "decrease" })), 900);
assert.equal(newPriceFor(999, rule({ value: 7.5 })), 1073.93, "percent, to the paisa");
assert.equal(newPriceFor(999, rule({ value: 7.5, rounding: "10" })), 1070);
assert.equal(newPriceFor(999, rule({ value: 7.5, rounding: "1" })), 1074);
assert.equal(newPriceFor(1000, rule({ mode: "amount", value: 250 })), 1250);
assert.equal(newPriceFor(1000, rule({ mode: "amount", value: 250, direction: "decrease" })), 750);
assert.equal(newPriceFor(1000, rule({ mode: "amount", value: 99.5, rounding: "10" })), 1100);
pass("percent and fixed amounts, both directions, then rounded");

// ── the rule itself ──
assert.equal(ruleProblem(rule({})), null);
for (const bad of [rule({ value: 0 }), rule({ value: -5 }), rule({ value: NaN }), rule({ value: Infinity }), rule({ value: 1001 }), rule({ value: 101, direction: "decrease" }), rule({ mode: "amount", value: 10_000_001 }), rule({ rounding: "5" as never })]) {
  assert.ok(ruleProblem(bad), JSON.stringify(bad));
}
assert.equal(ruleProblem(rule({ value: 100, direction: "decrease" })), null, "a 100% decrease is allowed (it makes prices free)");
pass("a rule must be a positive, sensible amount or percentage with a known rounding");

// ── the plan ──
const rows = [
  { id: 1, price: "1180.00", priceWithoutTax: "1000.00", taxPercent: "18.00" },
  { id: 2, price: "5799.00", priceWithoutTax: null, taxPercent: null }, // an older price-only row
  { id: 3, price: 0, priceWithoutTax: 0, taxPercent: 18 },
  { id: 4, price: "abc" },
  { id: 5, price: { $numberDecimal: "250.00" }, priceWithoutTax: "211.86", taxPercent: "18.00" },
  { id: 6, price: "100.00", priceWithoutTax: "95.24", taxPercent: "5.00" },
];
const plan = planBulkPrice(rows, rule({ value: 10, rounding: "10" }));
const byId = new Map(plan.changes.map((c) => [c.id, c]));
assert.deepEqual([...byId.keys()].sort(), [1, 2, 5, 6]);
assert.deepEqual(plan.skipped.sort((a, b) => a.id - b.id), [{ id: 3, reason: "unchanged" }, { id: 4, reason: "unreadable_price" }]);
assert.deepEqual([byId.get(1)?.before.price, byId.get(1)?.after.price, byId.get(1)?.delta, byId.get(1)?.deltaPercent], [1180, 1300, 120, 10.17]);
assert.equal(byId.get(2)?.after.price, 6380, "a price-only row is changed too");
assert.equal(byId.get(2)?.after.taxPercent, 18, "and gets the default rate recorded");
assert.equal(byId.get(5)?.before.price, 250, "a Decimal128-shaped value is read");
assert.equal(byId.get(6)?.after.taxPercent, 5, "the GST rate is never changed");
pass("the plan changes readable prices, skips zero and unreadable ones with a reason, and never changes the GST rate");

// the GST split always round-trips to exactly the new price
for (const change of plan.changes) {
  const back = resolveVariantPricing({ price: change.after.price, priceWithoutTax: change.after.priceWithoutTax ?? undefined, taxPercent: change.after.taxPercent });
  assert.equal(back.price, change.after.price, `row ${change.id}: price ${change.after.price} must round-trip through its split`);
}
const many = planBulkPrice(Array.from({ length: 2000 }, (_, i) => ({ id: i, price: (100 + i * 13.37).toFixed(2), taxPercent: [0, 5, 18, 40][i % 4] })), rule({ value: 3.3 }));
for (const change of many.changes) {
  assert.equal(resolveVariantPricing({ price: change.after.price, priceWithoutTax: change.after.priceWithoutTax ?? undefined, taxPercent: change.after.taxPercent }).price, change.after.price);
}
assert.ok(many.changes.length + many.skipped.length === 2000);
pass("the split price and GST always add back to exactly the new price (2000 varied prices, rates 0/5/18/40)");

// ── negatives and no-ops ──
const low = planBulkPrice([{ id: 1, price: "100.00", taxPercent: 18 }, { id: 2, price: "500.00", taxPercent: 18 }], rule({ mode: "amount", value: 200, direction: "decrease" }));
assert.deepEqual(low.skipped, [{ id: 1, reason: "negative_result" }], "a price that would go below zero is left alone");
assert.equal(low.changes[0].after.price, 300);
assert.equal(planBulkPrice([{ id: 1, price: "100.00", taxPercent: 18 }], rule({ value: 1, rounding: "10" })).skipped[0].reason, "unchanged", "rounding can make a change vanish");
assert.equal(planBulkPrice([{ id: 1, price: "100.00", taxPercent: 18 }], rule({ value: 100, direction: "decrease" })).changes[0].after.price, 0, "100% off is a price of zero");
assert.deepEqual(planBulkPrice([], rule({})), { changes: [], skipped: [] });
// determinism: the same input gives the same plan
assert.deepEqual(planBulkPrice(rows, rule({ value: 10, rounding: "10" })), plan);
pass("prices that would go negative or not change are skipped, 100% off gives zero, and a plan is deterministic");

console.log(`\nALL ${count} BULK PRICING TESTS PASSED!`);
