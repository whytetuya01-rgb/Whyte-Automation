/**
 * Regression: a dev server that loaded an OLDER Company schema must not keep it. Mongoose drops fields its schema
 * does not know, which turned a pending self-registration into an unreviewed (approved-looking) company.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/company-model-reload.test.ts
 */
import assert from "node:assert/strict";
import mongoose, { Schema } from "mongoose";

// What an outdated hot-reloaded process holds: a Company model without the review fields.
mongoose.model("Company", new Schema({ _id: Number, name: String, slug: String, phone: String, address: String, status: String }, { _id: false }));
assert.equal(mongoose.models.Company.schema.path("registrationStatus"), undefined, "precondition: the cached model is the old one");

const { Company } = require("../src/models/Company") as typeof import("../src/models/Company");

assert.ok(Company.schema.path("registrationStatus"), "the stale cached model was replaced by the current schema");
const doc = new Company({ _id: 5, name: "X", slug: "x", phone: "1234567", address: "somewhere", registrationStatus: "pending_review" });
assert.equal(doc.toObject().registrationStatus, "pending_review", "the review state is kept when a company is saved");
assert.equal(doc.validateSync()?.errors?.registrationStatus, undefined);
console.log("  ✓ a stale cached Company model is rebuilt, so registrationStatus is never silently dropped\n\n1 check passed.");
