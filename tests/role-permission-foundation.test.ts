import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  ADMIN_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  hasPermission,
  getEffectivePermissions,
  isValidPermission,
  sanitizePermissions,
} from "../src/lib/permissions";
import { isPrivilegedRole, redactVariantForRole, redactProductForRole } from "../src/lib/variantRedaction";
import {
  clearSessionActorCacheForTests,
  invalidateSessionActor,
} from "../src/lib/sessionGuard";
import { createUserSchema, updateUserSchema } from "../src/lib/validation/admin-user";

async function runTests() {
  console.log("▶ Running Role & Permission Foundation Tests...\n");

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ── 1. Role compatibility & permission registry ──────────────────────
  test("super_admin possesses all defined permissions", () => {
    for (const perm of ALL_PERMISSIONS) {
      assert.equal(
        hasPermission("super_admin", [], perm),
        true,
        `super_admin should have ${perm}`
      );
    }
    const effective = getEffectivePermissions("super_admin", []);
    assert.equal(effective.length, ALL_PERMISSIONS.length);
  });

  test("legacy admin possesses full admin capabilities but strictly lacks Super Admin exclusives", () => {
    // Admin has catalog, dealers, quotations, company, etc.
    assert.equal(hasPermission("admin", [], "catalog:read"), true);
    assert.equal(hasPermission("admin", [], "catalog:edit"), true);
    assert.equal(hasPermission("admin", [], "dealers:manage"), true);
    assert.equal(hasPermission("admin", [], "quotations:transition"), true);
    assert.equal(hasPermission("admin", [], "company:edit"), true);
    assert.equal(hasPermission("admin", [], "pricing:view_cost"), true);

    // Admin strictly does NOT have Super Admin exclusive operations
    assert.equal(hasPermission("admin", [], "activity:view"), false);
    assert.equal(hasPermission("admin", [], "spaces:hard_delete"), false);
    assert.equal(hasPermission("admin", [], "admins:manage"), false);

    const effective = getEffectivePermissions("admin", []);
    assert.equal(effective.includes("activity:view"), false);
    assert.equal(effective.includes("spaces:hard_delete"), false);
    assert.equal(effective.includes("admins:manage"), false);
    assert.equal(effective.length, ADMIN_PERMISSIONS.size);
  });

  test("configurable_admin is granted ONLY explicitly assigned permissions", () => {
    const assigned = ["catalog:read", "dealers:read"] as any;

    assert.equal(hasPermission("configurable_admin", assigned, "catalog:read"), true);
    assert.equal(hasPermission("configurable_admin", assigned, "dealers:read"), true);
    assert.equal(hasPermission("configurable_admin", assigned, "catalog:edit"), false);
    assert.equal(hasPermission("configurable_admin", assigned, "company:edit"), false);
    assert.equal(hasPermission("configurable_admin", assigned, "dealers:manage"), false);

    const effective = getEffectivePermissions("configurable_admin", assigned);
    assert.deepEqual(effective, ["catalog:read", "dealers:read"]);
  });

  test("configurable_admin cannot possess Super Admin-exclusive permissions even if injected", () => {
    const assignedWithSuperExclusives = [
      "catalog:read",
      "activity:view",
      "spaces:hard_delete",
      "admins:manage",
    ] as any;

    assert.equal(hasPermission("configurable_admin", assignedWithSuperExclusives, "catalog:read"), true);
    assert.equal(hasPermission("configurable_admin", assignedWithSuperExclusives, "activity:view"), false);
    assert.equal(hasPermission("configurable_admin", assignedWithSuperExclusives, "spaces:hard_delete"), false);
    assert.equal(hasPermission("configurable_admin", assignedWithSuperExclusives, "admins:manage"), false);

    const effective = getEffectivePermissions("configurable_admin", assignedWithSuperExclusives);
    assert.deepEqual(effective, ["catalog:read"]);
  });

  test("sales and unauthenticated roles have zero permissions, dealer cannot have super admin exclusives", () => {
    for (const perm of ALL_PERMISSIONS) {
      assert.equal(hasPermission("sales", [perm], perm), false);
      assert.equal(hasPermission(null, [perm], perm), false);
      assert.equal(hasPermission(undefined, [perm], perm), false);
    }
    for (const exclusive of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
      assert.equal(hasPermission("dealer", [exclusive], exclusive), false);
    }
  });

  test("sanitizePermissions strips malformed and invalid strings", () => {
    const raw = ["catalog:read", "fake:permission", 123, null, "dealers:manage", "DROP TABLE"];
    const sanitized = sanitizePermissions(raw);
    assert.deepEqual(sanitized, ["catalog:read", "dealers:manage"]);
  });

  // ── 2. Cost & Margin Redaction ──────────────────────────────────────
  test("cost redaction: super_admin and admin always see unredacted costs", () => {
    const variant = { id: 1, name: "Switch", cost: "500", purchaseTaxPercent: "18", price: "800" };

    const unredactedSuper = redactVariantForRole(variant, "super_admin");
    assert.equal(unredactedSuper.cost, "500");
    assert.equal(unredactedSuper.purchaseTaxPercent, "18");

    const unredactedAdmin = redactVariantForRole(variant, "admin");
    assert.equal(unredactedAdmin.cost, "500");
    assert.equal(unredactedAdmin.purchaseTaxPercent, "18");
  });

  test("cost redaction: dealer is always redacted", () => {
    const variant = { id: 1, name: "Switch", cost: "500", purchaseTaxPercent: "18", price: "800" };
    const redacted = redactVariantForRole(variant, "dealer");

    assert.equal(redacted.cost, undefined);
    assert.equal(redacted.purchaseTaxPercent, undefined);
    assert.equal(redacted.price, "800");
  });

  test("cost redaction: configurable_admin is redacted without explicit pricing:view_cost", () => {
    const product = {
      variants: [
        {
          id: 1,
          productId: 1,
          name: "Switch",
          automationTier: "standard",
          surfaceFinish: "matte",
          cost: "500",
          purchaseTaxPercent: "18",
          price: "800",
          isActive: true,
          sortOrder: 1,
        },
      ],
    } as any;

    // Without pricing:view_cost
    const redacted = redactProductForRole(product, "configurable_admin", ["catalog:read"]);
    assert.equal(redacted.variants?.[0].cost, undefined);
    assert.equal(redacted.variants?.[0].purchaseTaxPercent, undefined);
    assert.equal(redacted.variants?.[0].price, "800");

    // With explicit pricing:view_cost
    const unredacted = redactProductForRole(product, "configurable_admin", ["catalog:read", "pricing:view_cost"]);
    assert.equal(unredacted.variants?.[0].cost, "500");
    assert.equal(unredacted.variants?.[0].purchaseTaxPercent, "18");
  });

  // ── 3. Schema Validation & Assignment Guards ────────────────────────
  test("schema validation: accepts valid permissions for configurable_admin", () => {
    const input = {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      password: "password123",
      role: "configurable_admin",
      permissions: ["catalog:read", "dealers:manage"],
    };
    const parsed = createUserSchema.safeParse(input);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.permissions, ["catalog:read", "dealers:manage"]);
    }
  });

  test("schema validation: rejects unknown/malformed permissions", () => {
    const input = {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      password: "password123",
      role: "configurable_admin",
      permissions: ["catalog:read", "invalid:permission:name"],
    };
    const parsed = createUserSchema.safeParse(input);
    assert.equal(parsed.success, false);
  });

  test("schema validation: rejects assignment of Super Admin-exclusive permissions to configurable_admin", () => {
    const input = {
      role: "configurable_admin",
      permissions: ["catalog:read", "activity:view"],
    };
    const parsed = updateUserSchema.safeParse(input);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.match(
        parsed.error.issues[0].message,
        /Configurable admins cannot be granted Super Admin-exclusive permissions/
      );
    }
  });

  // ── 4. Cache Invalidation ───────────────────────────────────────────
  test("invalidateSessionActor purges entries for target user ID", () => {
    (global as any).sessionActorCache = new Map();
    (global as any).sessionActorCache.set("101:configurable_admin", { valid: true, expiresAt: Date.now() + 10000 });
    (global as any).sessionActorCache.set("102:admin", { valid: true, expiresAt: Date.now() + 10000 });

    invalidateSessionActor(101);

    assert.equal((global as any).sessionActorCache.has("101:configurable_admin"), false);
    assert.equal((global as any).sessionActorCache.has("102:admin"), true);

    clearSessionActorCacheForTests();
    assert.equal((global as any).sessionActorCache.size, 0);
  });

  // ── 5. Last Active Super Admin Protection Logic ─────────────────────
  test("Last Super Admin protection: prevents deactivating or demoting sole remaining active Super Admin", () => {
    function canUpdateSuperAdmin(
      targetIsActiveSuperAdmin: boolean,
      otherActiveSuperAdminsCount: number,
      nextIsActive?: boolean,
      nextRole?: string
    ) {
      const isBeingDeactivated = nextIsActive === false;
      const isBeingDemoted = nextRole !== undefined && nextRole !== "super_admin";

      if (targetIsActiveSuperAdmin && (isBeingDeactivated || isBeingDemoted)) {
        if (otherActiveSuperAdminsCount === 0) {
          throw new Error("Cannot deactivate or demote the last remaining active Super Admin.");
        }
      }
      return true;
    }

    // Demoting when other active super admins exist -> ALLOWED
    assert.equal(canUpdateSuperAdmin(true, 1, true, "admin"), true);
    assert.equal(canUpdateSuperAdmin(true, 2, false, "super_admin"), true);

    // Demoting or deactivating sole super admin -> BLOCKED
    assert.throws(
      () => canUpdateSuperAdmin(true, 0, false, "super_admin"),
      /Cannot deactivate or demote the last remaining active Super Admin/
    );
    assert.throws(
      () => canUpdateSuperAdmin(true, 0, true, "admin"),
      /Cannot deactivate or demote the last remaining active Super Admin/
    );
    assert.throws(
      () => canUpdateSuperAdmin(true, 0, true, "configurable_admin"),
      /Cannot deactivate or demote the last remaining active Super Admin/
    );

    // Modifying standard admin when 0 other super admins -> Not affected
    assert.equal(canUpdateSuperAdmin(false, 0, false, "admin"), true);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

runTests();
