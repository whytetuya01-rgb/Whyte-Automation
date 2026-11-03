/**
 * Suggested accessories: which ones are suggested for a room, and how an id list is cleaned.
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/product-accessories.test.ts
 */
import assert from "node:assert/strict";
import { MAX_ACCESSORIES, cleanAccessoryIds, suggestAccessories } from "../src/lib/productAccessories";
import { accessoryIdsField } from "../src/lib/validation/product";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

assert.equal(MAX_ACCESSORIES, 20);
assert.deepEqual(cleanAccessoryIds([3, "4", 3, 0, -1, 1.5, "x", null, undefined, { a: 1 }, 5]), [3, 4, 5], "whole positive numbers only, no repeats, in order");
assert.deepEqual(cleanAccessoryIds(undefined), []);
assert.deepEqual(cleanAccessoryIds("1,2"), []);
pass("an id list is cleaned to whole positive numbers without repeats");

const catalog = [
  { id: 1, accessoryIds: [10, 11] },
  { id: 2, accessoryIds: [11, 12] },
  { id: 3, accessoryIds: [] },
  { id: 4 },
  { id: 10 },
  { id: 11 },
  { id: 12, isActive: false },
  { id: 13, accessoryIds: [10, 999] },
];
assert.deepEqual(suggestAccessories([1], catalog), [10, 11]);
assert.deepEqual(suggestAccessories([1, 2], catalog), [10, 11], "an accessory suggested by two products is listed once; an inactive one is left out");
assert.deepEqual(suggestAccessories([2, 1], catalog), [11, 10], "in the order the products appear");
assert.deepEqual(suggestAccessories([1, 10], catalog), [11], "an accessory already in the room is not suggested");
assert.deepEqual(suggestAccessories([1, 1, 1], catalog), [10, 11], "a product in the room several times counts once");
assert.deepEqual(suggestAccessories([13], catalog), [10], "an accessory that is not in the catalogue (removed, or another company's) is left out");
assert.deepEqual(suggestAccessories([3, 4], catalog), [], "no accessories, nothing suggested");
assert.deepEqual(suggestAccessories([], catalog), []);
assert.deepEqual(suggestAccessories([999], catalog), [], "an unknown product in the room is harmless");
pass("suggestions: the accessories of what is in the room, once each, in order, never what is already there, inactive or missing");

assert.deepEqual(accessoryIdsField.parse(["5", 6]), [5, 6]);
assert.equal(accessoryIdsField.parse(undefined), undefined);
assert.equal(accessoryIdsField.safeParse([1, 1]).success, false, "a repeat is refused");
assert.equal(accessoryIdsField.safeParse(Array.from({ length: 21 }, (_, i) => i + 1)).success, false, "21 are refused");
assert.equal(accessoryIdsField.safeParse(Array.from({ length: 20 }, (_, i) => i + 1)).success, true);
for (const bad of [[0], [-3], ["abc"], [1.5], [null]]) assert.equal(accessoryIdsField.safeParse(bad).success, false, JSON.stringify(bad));
pass("the schema accepts up to 20 distinct product ids and refuses repeats, 21, and non-ids");

console.log(`\nALL ${count} PRODUCT ACCESSORY TESTS PASSED!`);
