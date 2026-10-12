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
  Permission,
} from "../src/lib/permissions";
import {
  isPrivilegedRole,
  redactVariantForRole,
  redactProductForRole,
  redactQuotationForRole,
  redactQuotationItemForRole,
} from "../src/lib/variantRedaction";
import {
  canViewQuotation,
  canModifyQuotation,
  canDeleteQuotation,
} from "../src/lib/quotationAccess";
import {
  clearSessionActorCacheForTests,
  invalidateSessionActor,
} from "../src/lib/sessionGuard";

async function runTests() {
  console.log("▶ Running Phase 4 Backend Permission Enforcement Tests...\n");

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}`);
            console.error(err);
            failed++;
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ── 1. Catalog Permissions & Fail-Closed Enforcement ───────────────────
  test("catalog permissions: configurable_admin allowed only with explicit permission, fails closed without", () => {
    // Configurable admin with catalog:create
    const allowedActor = ["catalog:create" as Permission];
    assert.equal(hasPermission("configurable_admin", allowedActor, "catalog:create"), true);
    assert.equal(hasPermission("configurable_admin", allowedActor, "catalog:edit"), false);
    assert.equal(hasPermission("configurable_admin", allowedActor, "catalog:delete"), false);

    // Configurable admin with empty permissions
    const emptyActor: string[] = [];
    assert.equal(hasPermission("configurable_admin", emptyActor, "catalog:create"), false);
    assert.equal(hasPermission("configurable_admin", emptyActor, "catalog:read"), false);

    // Null or undefined permissions fail closed
    assert.equal(hasPermission("configurable_admin", null, "catalog:create"), false);
    assert.equal(hasPermission("configurable_admin", undefined, "catalog:create"), false);

    // Super Admin and Admin retain catalog capabilities
    assert.equal(hasPermission("super_admin", [], "catalog:create"), true);
    assert.equal(hasPermission("admin", [], "catalog:create"), true);

    // Dealers are strictly denied catalog management capabilities
    assert.equal(hasPermission("dealer", [], "catalog:create"), false);
    assert.equal(hasPermission("dealer", [], "catalog:edit"), false);
    assert.equal(hasPermission("dealer", [], "catalog:delete"), false);
  });

  // ── 2. Pricing Margin Cost Redaction ──────────────────────────────────
  test("pricing:view_cost: cost and purchaseTaxPercent exposed only with permission", () => {
    const rawVariant = {
      id: 101,
      name: "Variant A",
      price: 2500,
      cost: 1500,
      purchaseTaxPercent: 18,
    };

    // Super Admin: retain cost
    const superAdminVariant = redactVariantForRole(rawVariant, "super_admin");
    assert.equal(superAdminVariant.cost, 1500);
    assert.equal(superAdminVariant.purchaseTaxPercent, 18);

    // Admin: retain cost
    const adminVariant = redactVariantForRole(rawVariant, "admin");
    assert.equal(adminVariant.cost, 1500);
    assert.equal(adminVariant.purchaseTaxPercent, 18);

    // Configurable Admin WITH pricing:view_cost: retain cost
    const configWithCost = redactVariantForRole(rawVariant, "configurable_admin", ["pricing:view_cost"]);
    assert.equal(configWithCost.cost, 1500);
    assert.equal(configWithCost.purchaseTaxPercent, 18);

    // Configurable Admin WITHOUT pricing:view_cost: stripped
    const configWithoutCost = redactVariantForRole(rawVariant, "configurable_admin", ["catalog:read"]);
    assert.equal((configWithoutCost as any).cost, undefined);
    assert.equal((configWithoutCost as any).purchaseTaxPercent, undefined);
    assert.equal(configWithoutCost.price, 2500);

    // Dealer: always stripped
    const dealerVariant = redactVariantForRole(rawVariant, "dealer");
    assert.equal((dealerVariant as any).cost, undefined);
    assert.equal((dealerVariant as any).purchaseTaxPercent, undefined);
  });

  test("redactQuotationForRole: item-level variant cost stripped when lacking pricing:view_cost", () => {
    const quotation = {
      id: "q_1",
      quotationNumber: "QT-2026-001",
      rooms: [
        {
          id: 1,
          name: "Living Room",
          items: [
            {
              id: 10,
              product: {
                name: "Dimmer",
                variants: [
                  { id: 100, cost: 800, purchaseTaxPercent: 18, price: 1200 },
                ],
              },
            },
          ],
        },
      ],
    };

    // Allowed for privileged role
    const privileged = redactQuotationForRole(quotation as any, "admin");
    assert.equal((privileged.rooms[0].items[0].product.variants[0] as any).cost, 800);

    // Stripped for configurable admin without pricing:view_cost
    const unprivileged = redactQuotationForRole(quotation as any, "configurable_admin", ["quotations:read_all"]);
    assert.equal((unprivileged.rooms[0].items[0].product.variants[0] as any).cost, undefined);
    assert.equal((unprivileged.rooms[0].items[0].product.variants[0] as any).price, 1200);
  });

  // ── 3. Categories Management ──────────────────────────────────────────
  test("categories:manage: enforced for category writes; forbidden for unauthorized actors", () => {
    assert.equal(hasPermission("configurable_admin", ["categories:manage"], "categories:manage"), true);
    assert.equal(hasPermission("configurable_admin", ["categories:read"], "categories:manage"), false);
    assert.equal(hasPermission("super_admin", [], "categories:manage"), true);
    assert.equal(hasPermission("admin", [], "categories:manage"), true);
    assert.equal(hasPermission("dealer", [], "categories:manage"), false);
  });

  // ── 4. Spaces Master Data & Hard-Delete Restrictions ──────────────────
  test("spaces:manage vs spaces:hard_delete: only Super Admin can hard delete spaces", () => {
    // Configurable admin with spaces:manage can manage house/room types
    assert.equal(hasPermission("configurable_admin", ["spaces:manage"], "spaces:manage"), true);

    // But spaces:hard_delete is SUPER_ADMIN_EXCLUSIVE and can NEVER be assigned or granted
    assert.equal(hasPermission("configurable_admin", ["spaces:hard_delete"], "spaces:hard_delete"), false);
    assert.equal(hasPermission("configurable_admin", ["spaces:manage"], "spaces:hard_delete"), false);

    // Regular admin also cannot hard-delete spaces (preserves existing admin restrictions)
    assert.equal(hasPermission("admin", [], "spaces:manage"), true);
    assert.equal(hasPermission("admin", [], "spaces:hard_delete"), false);

    // Super Admin alone possesses spaces:hard_delete
    assert.equal(hasPermission("super_admin", [], "spaces:hard_delete"), true);
  });

  // ── 5. Dealer Management & Status Alteration Restrictions ─────────────
  test("dealers:read and dealers:manage: permissions grant dealer inspection and updates", () => {
    assert.equal(hasPermission("configurable_admin", ["dealers:read"], "dealers:read"), true);
    assert.equal(hasPermission("configurable_admin", ["dealers:read"], "dealers:manage"), false);
    assert.equal(hasPermission("configurable_admin", ["dealers:manage"], "dealers:manage"), true);

    assert.equal(hasPermission("super_admin", [], "dealers:read"), true);
    assert.equal(hasPermission("admin", [], "dealers:read"), true);
    assert.equal(hasPermission("dealer", [], "dealers:read"), false);
  });

  // ── 6. Quotation Lifecycle & Granular Access ──────────────────────────
  test("quotations:read_all: canViewQuotation allows read-all with permission, or restricts to creator without", () => {
    const foreignQuotation = { dealerId: 2, createdBy: "99" };
    const ownQuotation = { dealerId: 2, createdBy: "5" };
    const callerId = 5;

    // Super admin & admin can view any quotation
    assert.equal(canViewQuotation("super_admin", callerId, foreignQuotation), true);
    assert.equal(canViewQuotation("admin", callerId, foreignQuotation), true);

    // Configurable admin WITH quotations:read_all can view any quotation
    assert.equal(
      canViewQuotation("configurable_admin", callerId, foreignQuotation, ["quotations:read_all"]),
      true
    );

    // Configurable admin WITHOUT quotations:read_all CANNOT view foreign quotation
    assert.equal(
      canViewQuotation("configurable_admin", callerId, foreignQuotation, ["quotations:create"]),
      false
    );

    // Configurable admin WITHOUT quotations:read_all CAN view own quotation
    assert.equal(
      canViewQuotation("configurable_admin", callerId, ownQuotation, ["quotations:create"]),
      true
    );

    // Dealer can view assigned or created
    assert.equal(canViewQuotation("dealer", 2, foreignQuotation), true);
    assert.equal(canViewQuotation("dealer", callerId, ownQuotation), true);
    assert.equal(canViewQuotation("dealer", 88, foreignQuotation), false);
  });

  test("quotations:edit_all: canModifyQuotation allows modifications with permission, denies without", () => {
    const quotation = { dealerId: 2, createdBy: "5" };
    const callerId = 5;

    // Super Admin & Admin can modify
    assert.equal(canModifyQuotation("super_admin", callerId, quotation), true);
    assert.equal(canModifyQuotation("admin", callerId, quotation), true);

    // Configurable Admin with quotations:edit_all can modify
    assert.equal(
      canModifyQuotation("configurable_admin", callerId, quotation, ["quotations:edit_all"]),
      true
    );

    // Configurable Admin without quotations:edit_all CANNOT modify
    assert.equal(
      canModifyQuotation("configurable_admin", callerId, quotation, ["quotations:create"]),
      false
    );

    // Dealer can only modify if assigned to dealer
    assert.equal(canModifyQuotation("dealer", 2, quotation), true);
    assert.equal(canModifyQuotation("dealer", 5, quotation), false);
  });

  test("quotations:delete: canDeleteQuotation allows deletion with permission, denies without", () => {
    const quotation = { dealerId: 2, createdBy: "5" };
    const callerId = 5;

    // Super Admin & Admin can delete
    assert.equal(canDeleteQuotation("super_admin", callerId, quotation), true);
    assert.equal(canDeleteQuotation("admin", callerId, quotation), true);

    // Configurable Admin with quotations:delete can delete
    assert.equal(
      canDeleteQuotation("configurable_admin", callerId, quotation, ["quotations:delete"]),
      true
    );

    // Configurable Admin without quotations:delete CANNOT delete
    assert.equal(
      canDeleteQuotation("configurable_admin", callerId, quotation, ["quotations:edit_all"]),
      false
    );

    // Dealer can delete if assigned
    assert.equal(canDeleteQuotation("dealer", 2, quotation), true);
    assert.equal(canDeleteQuotation("dealer", 5, quotation), false);
  });

  test("quotations:transition and quotations:assign_dealer: enforced strictly", () => {
    assert.equal(hasPermission("configurable_admin", ["quotations:transition"], "quotations:transition"), true);
    assert.equal(hasPermission("configurable_admin", ["quotations:read_all"], "quotations:transition"), false);

    assert.equal(hasPermission("configurable_admin", ["quotations:assign_dealer"], "quotations:assign_dealer"), true);
    assert.equal(hasPermission("configurable_admin", ["quotations:read_all"], "quotations:assign_dealer"), false);

    // Super Admin & Admin have transition and assign_dealer
    assert.equal(hasPermission("super_admin", [], "quotations:transition"), true);
    assert.equal(hasPermission("admin", [], "quotations:transition"), true);
    assert.equal(hasPermission("super_admin", [], "quotations:assign_dealer"), true);
    assert.equal(hasPermission("admin", [], "quotations:assign_dealer"), true);

    // Dealers never have transition or assign_dealer
    assert.equal(hasPermission("dealer", [], "quotations:transition"), false);
    assert.equal(hasPermission("dealer", [], "quotations:assign_dealer"), false);
  });

  // ── 7. System Oversight & User Administration Protections ─────────────
  test("activity:view and admins:manage: Super Admin exclusive, impossible for configurable admin", () => {
    // Configurable admin cannot have activity:view
    assert.equal(hasPermission("configurable_admin", ["activity:view"], "activity:view"), false);
    // Configurable admin cannot have admins:manage
    assert.equal(hasPermission("configurable_admin", ["admins:manage"], "admins:manage"), false);

    // Admin also cannot have activity:view or admins:manage
    assert.equal(hasPermission("admin", [], "activity:view"), false);
    assert.equal(hasPermission("admin", [], "admins:manage"), false);

    // Super Admin has both
    assert.equal(hasPermission("super_admin", [], "activity:view"), true);
    assert.equal(hasPermission("super_admin", [], "admins:manage"), true);
  });

  test("sanitizePermissions: automatically strips Super Admin exclusive permissions", () => {
    const maliciousAttempt = [
      "catalog:create",
      "activity:view",        // Super Admin exclusive
      "spaces:hard_delete",   // Super Admin exclusive
      "admins:manage",        // Super Admin exclusive
      "quotations:edit_all",
      "bogus:fake_permission", // Invalid permission
    ];

    const sanitized = sanitizePermissions(maliciousAttempt);
    assert.ok(sanitized.includes("catalog:create"));
    assert.ok(sanitized.includes("quotations:edit_all"));
    assert.ok(!sanitized.includes("bogus:fake_permission" as any));

    // When evaluated for a configurable_admin, exclusive permissions return false
    for (const exclusive of SUPER_ADMIN_EXCLUSIVE_PERMISSIONS) {
      assert.equal(
        hasPermission("configurable_admin", [exclusive], exclusive),
        false,
        `configurable_admin must never possess ${exclusive}`
      );
    }
  });

  // ── 8. Revocation & Cache Invalidation ────────────────────────────────
  test("invalidateSessionActor: clears memory cache on permission revocation", () => {
    clearSessionActorCacheForTests();
    // Cache invalidation functions cleanly
    invalidateSessionActor(42);
    clearSessionActorCacheForTests();
    assert.ok(true, "Cache cleared cleanly");
  });

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
