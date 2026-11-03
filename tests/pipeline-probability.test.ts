/**
 * Win probability rules (pure): stage defaults, overrides, won/lost, weighted value, tones.
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/pipeline-probability.test.ts
 */
import assert from "node:assert/strict";
import { STAGE_PROBABILITY, clampProbability, effectiveProbability, probabilityTone, weightedValue } from "../src/lib/pipelineProbability";
import { updateLeadSchema, createLeadSchema, createCustomerSchema, updateCustomerSchema, customerTypeEnum } from "../src/lib/validation/crm";

let count = 0;
const pass = (name: string) => { count += 1; console.log(`  ✓ ${name}`); };

assert.deepEqual(STAGE_PROBABILITY, { new: 10, contacted: 25, site_visit: 40, quoted: 60, negotiation: 80, won: 100, lost: 0 });
for (const status of ["new", "contacted", "site_visit", "quoted", "negotiation"] as const) assert.equal(effectiveProbability(status), STAGE_PROBABILITY[status]);
assert.ok(Object.values(STAGE_PROBABILITY).every((p) => Number.isInteger(p) && p >= 0 && p <= 100));
assert.ok(STAGE_PROBABILITY.new < STAGE_PROBABILITY.contacted && STAGE_PROBABILITY.contacted < STAGE_PROBABILITY.site_visit && STAGE_PROBABILITY.site_visit < STAGE_PROBABILITY.quoted && STAGE_PROBABILITY.quoted < STAGE_PROBABILITY.negotiation, "later stages are more likely");
pass("every open stage has a whole-number default and later stages are more likely");

assert.equal(effectiveProbability("quoted", 90), 90, "the salesperson's own number wins on an open stage");
assert.equal(effectiveProbability("quoted", 0), 0, "0 is a real override, not 'empty'");
assert.equal(effectiveProbability("quoted", null), 60);
assert.equal(effectiveProbability("quoted", undefined), 60);
assert.equal(effectiveProbability("quoted", 140), 60, "an out-of-range stored value is ignored");
assert.equal(effectiveProbability("quoted", Number.NaN), 60);
assert.equal(effectiveProbability("won", 10), 100, "won is always 100");
assert.equal(effectiveProbability("lost", 90), 0, "lost is always 0");
assert.equal(clampProbability(49.6), 50);
assert.equal(clampProbability(-1), null);
assert.equal(clampProbability("50"), null);
pass("an override wins on an open stage (0 included), bad values are ignored, won is 100 and lost is 0 whatever is stored");

assert.equal(weightedValue(400000, 60), 240000);
assert.equal(weightedValue(333, 10), 33);
assert.equal(weightedValue(0, 80), 0);
assert.equal(weightedValue(-5, 80), 0);
assert.equal(weightedValue(Number.NaN, 80), 0);
pass("expected value is value x probability to the rupee, and nothing for no value");

assert.deepEqual([80, 70, 69, 35, 34, 0].map(probabilityTone), ["high", "high", "medium", "medium", "low", "low"]);
pass("probability tones: 70+ strong, 35+ middling, below weak");

// ── API schemas ──
assert.equal(updateLeadSchema.parse({ probability: 55 }).probability, 55);
assert.equal(updateLeadSchema.parse({ probability: null }).probability, null);
assert.equal(updateLeadSchema.parse({}).probability, undefined);
for (const bad of [101, -1, 5.5, "50"]) assert.throws(() => updateLeadSchema.parse({ probability: bad }), `probability ${String(bad)} refused`);
assert.equal(createLeadSchema.parse({ customerName: "A", probability: 0 }).probability, 0);
assert.equal(updateLeadSchema.parse({ referrerId: 7 }).referrerId, 7);
assert.equal(updateLeadSchema.parse({ referrerId: null }).referrerId, null);
assert.throws(() => updateLeadSchema.parse({ referrerId: "x" }));
pass("lead schemas accept a whole 0-100 probability or null, and a contact id or null; anything else is refused");

assert.ok(customerTypeEnum.options.includes("dealer"), "Dealer is a contact type");
for (const type of ["individual", "architect", "builder", "interior_designer", "contractor", "dealer", "commercial", "other"]) assert.equal(customerTypeEnum.parse(type), type);
const contact = createCustomerSchema.parse({ name: "Studio Nine", customerType: "architect", companyName: " Studio Nine Architects ", designation: "Principal", tags: [" VIP ", "vip", "Referral"] });
assert.deepEqual([contact.companyName, contact.designation, contact.tags], ["Studio Nine Architects", "Principal", ["VIP", "Referral"]]);
assert.equal(updateCustomerSchema.parse({ companyName: null }).companyName, null, "an emptied firm clears");
assert.throws(() => updateCustomerSchema.parse({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }));
pass("contact schemas: Dealer type, firm, designation and tidied tags (limits as for leads)");

console.log(`\nALL ${count} PIPELINE PROBABILITY AND CONTACT TESTS PASSED`);
