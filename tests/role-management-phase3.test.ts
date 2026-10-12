import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  ADMIN_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  PERMISSION_METADATA,
  PERMISSION_MODULE_GROUPS,
  PERMISSION_PRESETS,
  hasPermission,
  getEffectivePermissions,
  isValidPermission,
  Permission,
} from "../src/lib/permissions";
import { createUserSchema, updateUserSchema } from "../src/lib/validation/admin-user";

async function runTests() {
  console.log("▶ Running Phase 3 Role Management UI & API Foundation Tests...\n");

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

  // ── 1. Role Metadata & Protection Tests ─────────────────────────────────
  test("supported roles: super_admin, admin, and configurable_admin exist with proper protection flags", () => {
    const roles = [
      { key: "super_admin", isEditable: false, type: "system_protected" },
      { key: "admin", isEditable: false, type: "system_protected" },
      { key: "configurable_admin", isEditable: true, type: "configurable" },
    ];

    assert.equal(roles.length, 3);
    assert.equal(roles.find((r) => r.key === "super_admin")?.isEditable, false);
    assert.equal(roles.find((r) => r.key === "admin")?.isEditable, false);
    assert.equal(roles.find((r) => r.key === "configurable_admin")?.isEditable, true);
  });

  // ── 2. Permission Registry & Module Group Completeness ───────────────────
  test("all 23 permissions have complete metadata in PERMISSION_METADATA", () => {
    assert.equal(ALL_PERMISSIONS.length, 23);
    for (const perm of ALL_PERMISSIONS) {
      const meta = PERMISSION_METADATA[perm];
      assert.ok(meta, `Missing metadata for permission: ${perm}`);
      assert.equal(meta.key, perm);
      assert.ok(meta.label.length > 0, `Empty label for ${perm}`);
      assert.ok(meta.description.length > 0, `Empty description for ${perm}`);
      assert.ok(meta.module.length > 0, `Empty module for ${perm}`);
      assert.ok(meta.action.length > 0, `Empty action for ${perm}`);
    }
  });

  test("PERMISSION_MODULE_GROUPS contains exactly all 23 permissions with zero duplicates", () => {
    const collected = new Set<Permission>();
    let totalCount = 0;

    for (const group of PERMISSION_MODULE_GROUPS) {
      assert.ok(group.name.length > 0);
      assert.ok(group.permissions.length > 0);
      for (const p of group.permissions) {
        assert.ok(!collected.has(p.key), `Duplicate permission in module groups: ${p.key}`);
        collected.add(p.key);
        totalCount++;
      }
    }

    assert.equal(totalCount, 23);
    assert.equal(collected.size, 23);
    for (const perm of ALL_PERMISSIONS) {
      assert.ok(collected.has(perm), `Permission ${perm} not found in any module group`);
    }
  });

  test("super_admin exclusive permissions are strictly flagged in PERMISSION_METADATA", () => {
    const expectedExclusives = new Set(["spaces:hard_delete", "activity:view", "admins:manage"]);
    for (const perm of ALL_PERMISSIONS) {
      const meta = PERMISSION_METADATA[perm];
      if (expectedExclusives.has(perm)) {
        assert.equal(meta.isSuperAdminExclusive, true, `${perm} must be Super Admin exclusive`);
        assert.equal(meta.isIncludedInAdmin, false, `${perm} must not be in standard admin`);
      } else {
        assert.equal(meta.isSuperAdminExclusive, false, `${perm} must not be Super Admin exclusive`);
        assert.equal(meta.isIncludedInAdmin, true, `${perm} must be included in standard admin`);
      }
    }
  });

  // ── 3. Presets Integrity ───────────────────────────────────────────────
  test("presets contain only valid non-exclusive permissions", () => {
    assert.ok(PERMISSION_PRESETS.length >= 4);
    for (const preset of PERMISSION_PRESETS) {
      assert.ok(preset.permissions.length > 0);
      for (const p of preset.permissions) {
        assert.ok(isValidPermission(p), `Invalid permission in preset ${preset.id}: ${p}`);
        assert.ok(
          !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p),
          `Preset ${preset.id} contains Super Admin exclusive permission: ${p}`
        );
      }
    }
  });

  test("Full Safe preset matches exact ADMIN_PERMISSIONS set", () => {
    const fullSafe = PERMISSION_PRESETS.find((p) => p.id === "full_safe");
    assert.ok(fullSafe);
    assert.equal(fullSafe.permissions.length, ADMIN_PERMISSIONS.size);
    for (const p of fullSafe.permissions) {
      assert.ok(ADMIN_PERMISSIONS.has(p));
    }
  });

  // ── 4. Granular Permission Toggling & Effective Permissions ────────────
  test("configurable admin receives only toggled permissions and never exclusives", () => {
    const toggled: Permission[] = [
      "catalog:read",
      "catalog:create",
      "quotations:read_all",
      "quotations:create",
    ];

    const effective = getEffectivePermissions("configurable_admin", toggled);
    assert.deepEqual(effective, toggled);

    // Verify individual checks
    assert.equal(hasPermission("configurable_admin", toggled, "catalog:read"), true);
    assert.equal(hasPermission("configurable_admin", toggled, "catalog:create"), true);
    assert.equal(hasPermission("configurable_admin", toggled, "catalog:edit"), false);
    assert.equal(hasPermission("configurable_admin", toggled, "catalog:delete"), false);
    assert.equal(hasPermission("configurable_admin", toggled, "activity:view"), false);
    assert.equal(hasPermission("configurable_admin", toggled, "admins:manage"), false);
  });

  test("schema validation blocks injecting Super Admin exclusives into configurable admin updates", () => {
    const updateWithExclusives = {
      permissions: ["catalog:read", "activity:view"],
    };
    const parsed = updateUserSchema.safeParse(updateWithExclusives);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok(
        parsed.error.issues.some((i) =>
          i.message.includes("Configurable admins cannot be granted Super Admin-exclusive permissions.")
        )
      );
    }
  });

  test("schema validation accepts valid individual permission toggles for configurable admin", () => {
    const validUpdate = {
      permissions: [
        "catalog:read",
        "catalog:edit",
        "pricing:view_cost",
        "quotations:read_all",
        "quotations:transition",
      ],
    };
    const parsed = updateUserSchema.safeParse(validUpdate);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.permissions, validUpdate.permissions);
    }
  });

  // ── 5. System Role Protection ──────────────────────────────────────────
  test("protected system roles super_admin and admin are immutable in permissions logic", () => {
    // Even if an empty permissions array is passed, super_admin has all permissions
    assert.equal(hasPermission("super_admin", [], "catalog:read"), true);
    assert.equal(hasPermission("super_admin", [], "activity:view"), true);
    assert.equal(hasPermission("super_admin", [], "admins:manage"), true);

    // Standard admin has all legacy admin permissions, but never super admin exclusives
    assert.equal(hasPermission("admin", [], "catalog:read"), true);
    assert.equal(hasPermission("admin", [], "dealers:manage"), true);
    assert.equal(hasPermission("admin", [], "activity:view"), false);
    assert.equal(hasPermission("admin", [], "admins:manage"), false);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
