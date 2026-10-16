/**
 * Phase 2 — Target Four-Role RBAC Definitions, Canonical Identifiers & Permission Registry Test
 *
 * Validates:
 * 1. Canonical role identifiers and human-readable labels.
 * 2. Role normalization from varied strings and casing.
 * 3. Exact permission sets for the four target roles:
 *    - super_admin (all 24 permissions)
 *    - admin (company-scoped, includes users:manage, excludes super admin exclusives)
 *    - sales_executive (assigned-scope: quotations:create, catalog:read, categories:read, spaces:read, company:read)
 *    - dealer (quotations:create, categories:read, spaces:read, company:read)
 * 4. Super Admin exclusive protections (spaces:hard_delete, activity:view, admins:manage).
 * 5. Cost & margin visibility: pricing:view_cost granted to super_admin and admin, denied to sales_executive and dealer.
 * 6. Backward compatibility: company_owner and legacy sales behavior preserved without unintended escalations.
 * 7. Least privilege for configurable_admin accounts.
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/four-role-definitions-foundation.test.ts
 */

import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  ADMIN_PERMISSIONS,
  SALES_EXECUTIVE_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  COMPANY_OWNER_PERMISSIONS,
  hasPermission,
  getEffectivePermissions,
  CANONICAL_ROLES,
  CANONICAL_ROLE_LABELS,
  isCanonicalRole,
  normalizeRole,
  getRoleLabel,
  PERMISSION_ALIASES,
  resolvePermission,
  sanitizePermissions,
  type Permission,
} from "../src/lib/permissions";

let passed = 0;
const testCase = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

console.log("\n--- Phase 2: Four-Role RBAC & Permission Registry Tests ---\n");

// ── 1. Canonical Role Identifiers & Labels ──────────────────────────────────
testCase("canonical roles contain exactly the four approved target roles", () => {
  assert.deepEqual(Array.from(CANONICAL_ROLES), [
    "super_admin",
    "admin",
    "sales_executive",
    "dealer",
  ]);
});

testCase("canonical role labels match official human-readable requirements", () => {
  assert.equal(CANONICAL_ROLE_LABELS.super_admin, "Super Admin");
  assert.equal(CANONICAL_ROLE_LABELS.admin, "Admin");
  assert.equal(CANONICAL_ROLE_LABELS.sales_executive, "Sales Executive");
  assert.equal(CANONICAL_ROLE_LABELS.dealer, "Dealer");
});

testCase("isCanonicalRole strictly validates canonical role identifiers", () => {
  assert.equal(isCanonicalRole("super_admin"), true);
  assert.equal(isCanonicalRole("admin"), true);
  assert.equal(isCanonicalRole("sales_executive"), true);
  assert.equal(isCanonicalRole("dealer"), true);

  // Non-canonical / legacy
  assert.equal(isCanonicalRole("company_owner"), false);
  assert.equal(isCanonicalRole("sales"), false);
  assert.equal(isCanonicalRole("configurable_admin"), false);
  assert.equal(isCanonicalRole("unknown_role"), false);
  assert.equal(isCanonicalRole(""), false);
  assert.equal(isCanonicalRole(null), false);
  assert.equal(isCanonicalRole(undefined), false);
});

// ── 2. Role Normalization ──────────────────────────────────────────────────
testCase("normalizeRole normalizes valid casing and formatting variations", () => {
  assert.equal(normalizeRole("super_admin"), "super_admin");
  assert.equal(normalizeRole("SUPER_ADMIN"), "super_admin");
  assert.equal(normalizeRole("Super Admin"), "super_admin");
  assert.equal(normalizeRole("superadmin"), "super_admin");
  assert.equal(normalizeRole("super-admin"), "super_admin");

  assert.equal(normalizeRole("admin"), "admin");
  assert.equal(normalizeRole("Admin"), "admin");
  assert.equal(normalizeRole("ADMINISTRATOR"), "admin");

  assert.equal(normalizeRole("sales_executive"), "sales_executive");
  assert.equal(normalizeRole("Sales Executive"), "sales_executive");
  assert.equal(normalizeRole("salesexecutive"), "sales_executive");
  assert.equal(normalizeRole("sales-executive"), "sales_executive");

  assert.equal(normalizeRole("dealer"), "dealer");
  assert.equal(normalizeRole("Dealer"), "dealer");
  assert.equal(normalizeRole("DEALER"), "dealer");

  // Legacy preserved
  assert.equal(normalizeRole("company_owner"), "company_owner");
  assert.equal(normalizeRole("Company Owner"), "company_owner");
  assert.equal(normalizeRole("sales"), "sales");
  assert.equal(normalizeRole("configurable_admin"), "configurable_admin");

  // Invalid / empty
  assert.equal(normalizeRole(""), null);
  assert.equal(normalizeRole("   "), null);
  assert.equal(normalizeRole(null), null);
  assert.equal(normalizeRole(undefined), null);
});

testCase("getRoleLabel produces accurate display labels", () => {
  assert.equal(getRoleLabel("super_admin"), "Super Admin");
  assert.equal(getRoleLabel("admin"), "Admin");
  assert.equal(getRoleLabel("sales_executive"), "Sales Executive");
  assert.equal(getRoleLabel("dealer"), "Dealer");
  assert.equal(getRoleLabel("company_owner"), "Company Owner (Legacy)");
  assert.equal(getRoleLabel("configurable_admin"), "Configurable Admin (Legacy)");
  assert.equal(getRoleLabel("sales"), "Sales (Legacy)");
  assert.equal(getRoleLabel(""), "Unknown");
});

// ── 3. Permission Sets & Registry Integrity ─────────────────────────────────
testCase("ALL_PERMISSIONS includes users:manage, quotations:assign_sales, and retains all prior keys (25 total)", () => {
  assert.equal(ALL_PERMISSIONS.length, 25);
  assert.ok(ALL_PERMISSIONS.includes("users:manage"));
  assert.ok(ALL_PERMISSIONS.includes("quotations:assign_sales"));
  assert.ok(ALL_PERMISSIONS.includes("quotations:assign_dealer"));
  assert.ok(ALL_PERMISSIONS.includes("admins:manage"));
  assert.ok(ALL_PERMISSIONS.includes("admins:read"));
  assert.ok(ALL_PERMISSIONS.includes("spaces:hard_delete"));
  assert.ok(ALL_PERMISSIONS.includes("activity:view"));
  assert.ok(ALL_PERMISSIONS.includes("pricing:view_cost"));
});

testCase("SUPER_ADMIN_EXCLUSIVE_PERMISSIONS contains only platform-exclusive operations", () => {
  assert.deepEqual(
    Array.from(SUPER_ADMIN_EXCLUSIVE_PERMISSIONS).sort(),
    ["activity:view", "admins:manage", "spaces:hard_delete"].sort()
  );
  // users:manage is company-scoped, so it MUST NOT be super-admin exclusive
  assert.equal(SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has("users:manage"), false);
});

testCase("ADMIN_PERMISSIONS includes company user management and excludes platform exclusives", () => {
  assert.equal(ADMIN_PERMISSIONS.size, 22);
  assert.ok(ADMIN_PERMISSIONS.has("users:manage"), "Admin must have users:manage for company users");
  assert.ok(ADMIN_PERMISSIONS.has("quotations:assign_sales"), "Admin must have quotations:assign_sales");
  assert.ok(ADMIN_PERMISSIONS.has("quotations:assign_dealer"), "Admin must have quotations:assign_dealer");
  assert.ok(ADMIN_PERMISSIONS.has("admins:read"), "Admin must have admins:read");
  assert.ok(ADMIN_PERMISSIONS.has("pricing:view_cost"), "Admin has pricing:view_cost by default");
  assert.ok(ADMIN_PERMISSIONS.has("quotations:read_all"), "Admin has quotations:read_all within company");

  // Must NOT have Super Admin exclusive permissions
  for (const p of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
    assert.equal(ADMIN_PERMISSIONS.has(p), false, `Admin must not have ${p}`);
  }
});

testCase("SALES_EXECUTIVE_DEFAULT_PERMISSIONS grants least privilege for field sales", () => {
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.size, 5);
  assert.ok(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("quotations:create"));
  assert.ok(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("catalog:read"));
  assert.ok(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("categories:read"));
  assert.ok(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("spaces:read"));
  assert.ok(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("company:read"));

  // Strictly denied
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("pricing:view_cost"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("quotations:read_all"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("quotations:edit_all"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("quotations:delete"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("quotations:transition"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("dealers:manage"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("spaces:manage"), false);
  assert.equal(SALES_EXECUTIVE_DEFAULT_PERMISSIONS.has("users:manage"), false);
});

testCase("DEALER_DEFAULT_PERMISSIONS retains exact partner capabilities with costs hidden", () => {
  assert.equal(DEALER_DEFAULT_PERMISSIONS.size, 4);
  assert.ok(DEALER_DEFAULT_PERMISSIONS.has("quotations:create"));
  assert.ok(DEALER_DEFAULT_PERMISSIONS.has("categories:read"));
  assert.ok(DEALER_DEFAULT_PERMISSIONS.has("spaces:read"));
  assert.ok(DEALER_DEFAULT_PERMISSIONS.has("company:read"));

  // Denied
  assert.equal(DEALER_DEFAULT_PERMISSIONS.has("pricing:view_cost"), false);
  assert.equal(DEALER_DEFAULT_PERMISSIONS.has("catalog:read"), false);
  assert.equal(DEALER_DEFAULT_PERMISSIONS.has("users:manage"), false);
  assert.equal(DEALER_DEFAULT_PERMISSIONS.has("dealers:manage"), false);
});

// ── 4. hasPermission() Evaluation Logic ────────────────────────────────────
testCase("super_admin role has all permissions unconditionally", () => {
  for (const p of ALL_PERMISSIONS) {
    assert.equal(hasPermission("super_admin", null, p), true, `super_admin should have ${p}`);
  }
});

testCase("non-super-admin roles can NEVER possess super admin exclusive permissions", () => {
  const nonSuperRoles = ["admin", "sales_executive", "dealer", "configurable_admin", "company_owner"];
  for (const role of nonSuperRoles) {
    for (const exclusive of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
      assert.equal(
        hasPermission(role, [exclusive], exclusive),
        false,
        `${role} must never possess ${exclusive} even if assigned`
      );
    }
  }
});

testCase("admin role resolves default administrative permissions including users:manage", () => {
  assert.equal(hasPermission("admin", null, "users:manage"), true);
  assert.equal(hasPermission("admin", null, "catalog:create"), true);
  assert.equal(hasPermission("admin", null, "quotations:transition"), true);
  assert.equal(hasPermission("admin", null, "pricing:view_cost"), true);

  // Exclusive denied
  assert.equal(hasPermission("admin", null, "spaces:hard_delete"), false);
  assert.equal(hasPermission("admin", null, "admins:manage"), false);
  assert.equal(hasPermission("admin", null, "activity:view"), false);
});

testCase("sales_executive role resolves default permissions", () => {
  assert.equal(hasPermission("sales_executive", null, "quotations:create"), true);
  assert.equal(hasPermission("sales_executive", null, "catalog:read"), true);
  assert.equal(hasPermission("sales_executive", null, "company:read"), true);

  // Restrained operations
  assert.equal(hasPermission("sales_executive", null, "pricing:view_cost"), false);
  assert.equal(hasPermission("sales_executive", null, "quotations:read_all"), false);
  assert.equal(hasPermission("sales_executive", null, "quotations:transition"), false);
  assert.equal(hasPermission("sales_executive", null, "users:manage"), false);
});

testCase("dealer role resolves default dealer permissions", () => {
  assert.equal(hasPermission("dealer", null, "quotations:create"), true);
  assert.equal(hasPermission("dealer", null, "categories:read"), true);
  assert.equal(hasPermission("dealer", null, "company:read"), true);

  assert.equal(hasPermission("dealer", null, "pricing:view_cost"), false);
  assert.equal(hasPermission("dealer", null, "quotations:read_all"), false);
  assert.equal(hasPermission("dealer", null, "users:manage"), false);
});

testCase("legacy sales role fails closed (returns false for all permissions)", () => {
  for (const p of ALL_PERMISSIONS) {
    assert.equal(hasPermission("sales", null, p), false);
    assert.equal(hasPermission("sales", ["quotations:create"], p), false);
  }
});

testCase("configurable_admin respects explicit assigned permissions only (least privilege)", () => {
  // Without permissions
  assert.equal(hasPermission("configurable_admin", [], "catalog:read"), false);
  assert.equal(hasPermission("configurable_admin", null, "catalog:read"), false);

  // With granted permission
  assert.equal(hasPermission("configurable_admin", ["catalog:read"], "catalog:read"), true);
  assert.equal(hasPermission("configurable_admin", ["catalog:read"], "catalog:create"), false);

  // Cannot gain super admin exclusive
  assert.equal(hasPermission("configurable_admin", ["admins:manage"], "admins:manage"), false);
});

testCase("company_owner backward compatibility is preserved", () => {
  assert.equal(hasPermission("company_owner", null, "catalog:create"), true);
  assert.equal(hasPermission("company_owner", null, "users:manage"), true);
  assert.equal(hasPermission("company_owner", null, "admins:manage"), false);
});

// ── 5. getEffectivePermissions() Verification ─────────────────────────────
testCase("getEffectivePermissions returns complete filtered arrays", () => {
  const superPerms = getEffectivePermissions("super_admin", null);
  assert.equal(superPerms.length, 25);

  const adminPerms = getEffectivePermissions("admin", null);
  assert.equal(adminPerms.length, 22);
  assert.ok(adminPerms.includes("users:manage"));

  const salesPerms = getEffectivePermissions("sales_executive", null);
  assert.equal(salesPerms.length, 5);
  assert.ok(salesPerms.includes("quotations:create"));

  const dealerPerms = getEffectivePermissions("dealer", null);
  assert.equal(dealerPerms.length, 4);

  const legacySalesPerms = getEffectivePermissions("sales", null);
  assert.equal(legacySalesPerms.length, 0);

  // Configurable admin with attempted privilege escalation
  const cfgPerms = getEffectivePermissions("configurable_admin", [
    "catalog:read",
    "admins:manage", // exclusive
    "invalid_permission",
  ]);
  assert.deepEqual(cfgPerms, ["catalog:read"]);
});

// ── 6. Permission Alias Reconciliation & Resolution ───────────────────────
testCase("resolvePermission transparently resolves compatibility aliases", () => {
  assert.equal(resolvePermission("quotations:read"), "quotations:read_all");
  assert.equal(resolvePermission("quotations:update"), "quotations:edit_all");
  assert.equal(resolvePermission("quotations:approve"), "quotations:transition");
  assert.equal(resolvePermission("catalog:update"), "catalog:edit");
  assert.equal(resolvePermission("company:update"), "company:edit");
  assert.equal(resolvePermission("unknown:perm"), null);
  assert.equal(resolvePermission("quotations:read_all"), "quotations:read_all");
});

testCase("hasPermission and sanitizePermissions evaluate aliases transparently", () => {
  // admin holds quotations:read_all, catalog:edit, company:edit, quotations:transition
  assert.equal(hasPermission("admin", null, "quotations:read"), true);
  assert.equal(hasPermission("admin", null, "quotations:update"), true);
  assert.equal(hasPermission("admin", null, "quotations:approve"), true);
  assert.equal(hasPermission("admin", null, "catalog:update"), true);
  assert.equal(hasPermission("admin", null, "company:update"), true);

  // sales_executive does not hold quotations:edit_all / quotations:update or company:edit
  assert.equal(hasPermission("sales_executive", null, "quotations:update"), false);
  assert.equal(hasPermission("sales_executive", null, "company:update"), false);

  // sanitizePermissions normalizes aliases to their canonical keys
  const sanitized = sanitizePermissions([
    "quotations:read",
    "catalog:update",
    "company:update",
    "bogus_perm",
  ]);
  assert.deepEqual(sanitized, ["quotations:read_all", "catalog:edit", "company:edit"]);
});

console.log(`\nAll ${passed} Phase 2 & Phase 3 Stage 1 tests PASSED successfully!\n`);
