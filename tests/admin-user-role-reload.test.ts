/**
 * Regression: after a dev hot reload the AdminUser model is re-evaluated against the cached mongoose model, which
 * re-applies a role enum. Every role the app assigns must survive that, or registration fails with
 * "Validator failed for path `role`".
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/admin-user-role-reload.test.ts
 */
import assert from "node:assert/strict";

const modulePath = require.resolve("../src/models/AdminUser");
require(modulePath); // first evaluation registers the model
delete require.cache[modulePath];
const { AdminUser } = require(modulePath) as typeof import("../src/models/AdminUser"); // second one runs the hot-reload patch

for (const role of ["super_admin", "company_owner", "admin", "sales_executive", "dealer", "configurable_admin"]) {
  const doc = new AdminUser({ _id: 1, companyId: role === "super_admin" ? null : 1, email: "a@b.example", passwordHash: "x", role });
  const error = doc.validateSync();
  assert.equal(error?.errors?.role, undefined, `${role} must pass role validation after a reload`);
}
const bad = new AdminUser({ _id: 1, companyId: 1, email: "a@b.example", passwordHash: "x", role: "emperor" }).validateSync();
assert.ok(bad?.errors?.role, "an unknown role is still rejected");
console.log("  ✓ every assigned role (including company_owner) validates after a model hot reload; unknown roles are rejected\n\n1 check passed.");
