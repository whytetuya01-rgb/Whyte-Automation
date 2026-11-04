import assert from "node:assert/strict";
import { parseCustomerNotes } from "@/lib/crmCustomerInsights";

console.log("Starting CRM Customer Notes Parsing Tests...");

// 1. Raw migration JSON payload
const migrationPayload = JSON.stringify({
  migrationBatch: "HISTORICAL_CRM_MIGRATION_2026_V1",
  fingerprint: "85d6a484ef8bc7e7cc6896571dc579a2e4a35e032782f92ce049e0a546be3d16",
  migratedQuotationIds: ["q_mvs21m37_u6r4ssn"],
  migratedQuotationNumbers: ["QT-2026-067"],
});

const parsed1 = parseCustomerNotes(migrationPayload);
assert.equal(parsed1.userNotes, null, "User notes should be null for pure migration JSON");
assert.ok(parsed1.migrationInfo, "Migration info should be extracted");
assert.equal(parsed1.migrationInfo?.batch, "HISTORICAL_CRM_MIGRATION_2026_V1");
assert.deepEqual(parsed1.migrationInfo?.quotationNumbers, ["QT-2026-067"]);
console.log("  ✓ 1. Correctly parses and hides raw migration JSON payload from user notes");

// 2. Normal human notes
const normalNotes = "Client prefers WhatsApp communication.\nDecision maker is her partner.";
const parsed2 = parseCustomerNotes(normalNotes);
assert.equal(parsed2.userNotes, normalNotes, "Normal user notes should be preserved as-is");
assert.equal(parsed2.migrationInfo, null, "Migration info should be null for regular notes");
console.log("  ✓ 2. Preserves regular human customer notes with line breaks");

// 3. Null and undefined notes
const parsedNull = parseCustomerNotes(null);
assert.equal(parsedNull.userNotes, null);
assert.equal(parsedNull.migrationInfo, null);

const parsedEmpty = parseCustomerNotes("   ");
assert.equal(parsedEmpty.userNotes, null);
assert.equal(parsedEmpty.migrationInfo, null);
console.log("  ✓ 3. Handles null and whitespace empty strings cleanly");

console.log("\nAll CRM customer notes parsing tests passed successfully!");

