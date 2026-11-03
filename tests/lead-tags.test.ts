/**
 * Lead tag rules (pure): tidy, de-duplicate ignoring case, limits, stable colours, counts.
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/lead-tags.test.ts
 */
import assert from "node:assert/strict";
import { MAX_LEAD_TAGS, MAX_LEAD_TAG_LENGTH, addTag, cleanTag, countTags, normalizeTags, tagTone } from "../src/lib/leadTags";
import { leadTagsSchema } from "../src/lib/validation/crm";

let count = 0;
const pass = (name: string) => { count += 1; console.log(`  ✓ ${name}`); };

assert.equal(cleanTag("  #  VIP   client "), "VIP client");
assert.equal(cleanTag("##Villa"), "Villa");
assert.deepEqual(normalizeTags([" VIP ", "vip", "#Villa", "", "  ", "VILLA", "Architect referral"]), ["VIP", "Villa", "Architect referral"]);
pass("tags are tidied and de-duplicated ignoring case (first spelling wins)");

assert.deepEqual(addTag(["VIP"], "vip"), { tags: ["VIP"], added: false, reason: "duplicate" });
assert.equal(addTag([], "   ").reason, "empty");
assert.equal(addTag([], "x".repeat(MAX_LEAD_TAG_LENGTH + 1)).reason, "too_long");
assert.equal(addTag([], "x".repeat(MAX_LEAD_TAG_LENGTH)).added, true);
assert.equal(addTag([], "<b>").reason, "forbidden");
const full = Array.from({ length: MAX_LEAD_TAGS }, (_, i) => `t${i}`);
assert.equal(addTag(full, "one more").reason, "limit");
assert.deepEqual(addTag(["a"], "b"), { tags: ["a", "b"], added: true });
pass("adding a tag explains why it was refused: empty, duplicate, too long, forbidden characters, limit");

assert.deepEqual(leadTagsSchema.parse([" VIP ", "vip", "Villa"]), ["VIP", "Villa"]);
assert.throws(() => leadTagsSchema.parse(["x".repeat(MAX_LEAD_TAG_LENGTH + 1)]));
assert.throws(() => leadTagsSchema.parse(["<script>"]));
assert.throws(() => leadTagsSchema.parse(full.concat("extra")));
assert.equal(leadTagsSchema.parse(full).length, MAX_LEAD_TAGS);
assert.throws(() => leadTagsSchema.parse("VIP"));
assert.throws(() => leadTagsSchema.parse([5]));
pass("the API schema tidies, then enforces the length, characters and count limits");

assert.equal(tagTone("VIP"), tagTone("vip"), "a tag keeps its colour whatever its case");
assert.notEqual(new Set(["VIP", "Villa", "Hot", "Architect", "Builder", "Referral", "Repeat", "Urgent"].map((t) => tagTone(t).chip)).size, 1, "tags are spread over several colours");
pass("a tag always gets the same colour, and tags use more than one");

assert.deepEqual(countTags([["VIP", "Villa"], ["vip"], ["VIP"], null, undefined, ["Hot"]]), [
  { tag: "VIP", count: 3 },
  { tag: "Hot", count: 1 },
  { tag: "Villa", count: 1 },
]);
assert.deepEqual(countTags([["vip"], ["VIP"]]), [{ tag: "VIP", count: 2 }], "on a tie the spelling with capitals is shown");
pass("tag counts ignore case, show the most used spelling, and sort by use then name");

console.log(`\nALL ${count} LEAD TAG TESTS PASSED`);
