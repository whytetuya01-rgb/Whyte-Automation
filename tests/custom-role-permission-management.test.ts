import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  ADMIN_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  hasPermission,
  getEffectivePermissions,
  isValidPermission,
  type Permission,
} from "../src/lib/permissions";
import { createUserSchema, updateUserSchema, adminRoleEnum } from "../src/lib/validation/admin-user";
import { isPrivilegedRole, redactVariantForRole } from "../src/lib/variantRedaction";
import { canViewQuotation, canModifyQuotation, canDeleteQuotation } from "../src/lib/quotationAccess";

async function runTests() {
  console.log("▶ Running Custom Role & Permission Management Tests...\n");

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}`);
            console.error(err);
            failed++;
          });
      } else {
        console.log(`  ✓ ${name}`);
        passed++;
      }
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ── 1. Default Role Behaviors & Immutability ─────────────────────────────
  test("super_admin has all 23 permissions and is immutable", () => {
    assert.equal(SUPER_ADMIN_PERMISSIONS.size, 23);
    for (const p of ALL_PERMISSIONS) {
      assert.equal(hasPermission("super_admin", null, p), true);
      assert.equal(hasPermission("super_admin", [], p), true);
    }
  });

  test("admin defaults to 20 permissions and excludes super_admin exclusives", () => {
    assert.equal(ADMIN_DEFAULT_PERMISSIONS.size, 20);
    for (const exclusive of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
      assert.equal(ADMIN_DEFAULT_PERMISSIONS.has(exclusive), false);
      assert.equal(hasPermission("admin", null, exclusive), false);
    }
    assert.equal(hasPermission("admin", null, "catalog:read"), true);
    assert.equal(hasPermission("admin", null, "catalog:delete"), true);
    assert.equal(hasPermission("admin", null, "pricing:view_cost"), true);
  });

  test("dealer defaults to 4 permissions and excludes cost/administrative features", () => {
    assert.equal(DEALER_DEFAULT_PERMISSIONS.size, 4);
    assert.equal(hasPermission("dealer", null, "quotations:create"), true);
    assert.equal(hasPermission("dealer", null, "categories:read"), true);
    assert.equal(hasPermission("dealer", null, "spaces:read"), true);
    assert.equal(hasPermission("dealer", null, "company:read"), true);

    // Dealer defaults must not have catalog write, pricing cost, or admin permissions
    assert.equal(hasPermission("dealer", null, "catalog:create"), false);
    assert.equal(hasPermission("dealer", null, "catalog:delete"), false);
    assert.equal(hasPermission("dealer", null, "pricing:view_cost"), false);
    assert.equal(hasPermission("dealer", null, "admins:read"), false);
  });

  // ── 2. Dynamic Permission Customization for Admin ─────────────────────────
  test("customized admin permissions are strictly enforced when permissions list is provided", () => {
    // Super Admin customized admin role to revoke catalog:delete and pricing:view_cost
    const customizedAdminPerms = Array.from(ADMIN_DEFAULT_PERMISSIONS).filter(
      (p) => p !== "catalog:delete" && p !== "pricing:view_cost"
    );

    // Allowed actions
    assert.equal(hasPermission("admin", customizedAdminPerms, "catalog:read"), true);
    assert.equal(hasPermission("admin", customizedAdminPerms, "quotations:create"), true);

    // Revoked actions MUST be blocked
    assert.equal(hasPermission("admin", customizedAdminPerms, "catalog:delete"), false);
    assert.equal(hasPermission("admin", customizedAdminPerms, "pricing:view_cost"), false);
  });

  test("revoked pricing:view_cost on customized admin triggers variant cost redaction", () => {
    const rawVariant = {
      sku: "SWITCH-01",
      name: "Smart Switch 1-Gang",
      price: 1500,
      cost: 900,
      purchaseTaxPercent: 18,
    };

    // Default admin sees cost
    assert.equal(isPrivilegedRole("admin", null), true);
    const defaultRedacted = redactVariantForRole(rawVariant, "admin", null);
    assert.equal(defaultRedacted.cost, 900);
    assert.equal(defaultRedacted.purchaseTaxPercent, 18);

    // Admin with pricing:view_cost revoked must have cost redacted
    const withoutCostPerms = Array.from(ADMIN_DEFAULT_PERMISSIONS).filter((p) => p !== "pricing:view_cost");
    assert.equal(isPrivilegedRole("admin", withoutCostPerms), false);
    const redacted = redactVariantForRole(rawVariant, "admin", withoutCostPerms);
    assert.equal((redacted as any).cost, undefined);
    assert.equal((redacted as any).purchaseTaxPercent, undefined);
    assert.equal(redacted.price, 1500);
  });

  // ── 3. Dynamic Permission Customization for Dealer ────────────────────────
  test("dealer role customization allows granting safe permissions while blocking exclusives", () => {
    // Super Admin grants catalog:read to dealer
    const customizedDealerPerms = [...Array.from(DEALER_DEFAULT_PERMISSIONS), "catalog:read"];

    assert.equal(hasPermission("dealer", customizedDealerPerms, "catalog:read"), true);
    assert.equal(hasPermission("dealer", customizedDealerPerms, "quotations:create"), true);

    // Even if malicious payload included super admin exclusives, hasPermission MUST reject them
    const maliciousDealerPerms = [...customizedDealerPerms, "admins:manage", "spaces:hard_delete"];
    assert.equal(hasPermission("dealer", maliciousDealerPerms, "admins:manage"), false);
    assert.equal(hasPermission("dealer", maliciousDealerPerms, "spaces:hard_delete"), false);
  });

  test("dealer quotation ownership constraints remain strictly enforced", () => {
    const dealerId = 42;
    const ownQuotation = { dealerId: 42, createdBy: "42" };
    const otherDealerQuotation = { dealerId: 99, createdBy: "99" };

    // Dealer can view and modify own quotation
    assert.equal(canViewQuotation("dealer", dealerId, ownQuotation, null), true);
    assert.equal(canModifyQuotation("dealer", dealerId, ownQuotation, null), true);
    assert.equal(canDeleteQuotation("dealer", dealerId, ownQuotation, null), true);

    // Dealer cannot view or modify other dealer's quotation
    assert.equal(canViewQuotation("dealer", dealerId, otherDealerQuotation, null), false);
    assert.equal(canModifyQuotation("dealer", dealerId, otherDealerQuotation, null), false);
    assert.equal(canDeleteQuotation("dealer", dealerId, otherDealerQuotation, null), false);
  });

  // ── 4. Custom Roles Creation & Assignment ────────────────────────────────
  test("adminRoleEnum accepts custom role keys while rejecting sales or invalid strings", () => {
    assert.equal(adminRoleEnum.safeParse("catalog_specialist").success, true);
    assert.equal(adminRoleEnum.safeParse("sales_ops_lead").success, true);
    assert.equal(adminRoleEnum.safeParse("admin").success, true);
    assert.equal(adminRoleEnum.safeParse("dealer").success, true);

    // Deprecated sales role rejected
    assert.equal(adminRoleEnum.safeParse("sales").success, false);
    // Invalid characters rejected
    assert.equal(adminRoleEnum.safeParse("role with spaces").success, false);
    assert.equal(adminRoleEnum.safeParse("").success, false);
  });

  test("custom roles possess permitted permissions and reject super_admin exclusives", () => {
    const customPerms = ["catalog:read", "catalog:edit", "categories:read"];

    assert.equal(hasPermission("catalog_editor", customPerms, "catalog:read"), true);
    assert.equal(hasPermission("catalog_editor", customPerms, "catalog:edit"), true);
    assert.equal(hasPermission("catalog_editor", customPerms, "catalog:delete"), false);
    assert.equal(hasPermission("catalog_editor", customPerms, "admins:manage"), false);

    const effective = getEffectivePermissions("catalog_editor", customPerms);
    assert.deepEqual(effective, ["catalog:read", "catalog:edit", "categories:read"]);
  });

  test("user schemas support assigning custom roles", () => {
    const validCustomUser = createUserSchema.safeParse({
      firstName: "Alex",
      lastName: "Taylor",
      email: "alex.taylor@whyte.com",
      password: "StrongPassword123!",
      role: "catalog_manager",
    });
    assert.equal(validCustomUser.success, true);

    const validUpdateUser = updateUserSchema.safeParse({
      role: "sales_operations",
    });
    assert.equal(validUpdateUser.success, true);
  });

  // ── 5. Security & Invariant Protections ───────────────────────────────────
  test("super_admin exclusive permissions can never be assigned or evaluated on non-super_admin roles", () => {
    for (const exclusive of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
      assert.equal(hasPermission("admin", [exclusive], exclusive), false);
      assert.equal(hasPermission("dealer", [exclusive], exclusive), false);
      assert.equal(hasPermission("custom_role", [exclusive], exclusive), false);
      assert.equal(hasPermission("configurable_admin", [exclusive], exclusive), false);
    }
  });

  test("unknown permission strings are strictly rejected by isValidPermission", () => {
    assert.equal(isValidPermission("catalog:read"), true);
    assert.equal(isValidPermission("pricing:view_cost"), true);
    assert.equal(isValidPermission("unknown:hack"), false);
    assert.equal(isValidPermission(""), false);
    assert.equal(isValidPermission(123), false);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
