/**
 * Phase 3, Stage 2 — API Authorization and Record-Level Quotation Ownership Test
 *
 * Validates:
 * 1. Assigned vs unassigned Sales Executive quotation visibility and mutation guards.
 * 2. Cross-salesperson and cross-company quotation isolation.
 * 3. Dealer access to own vs another dealer's quotations.
 * 4. Tampering & IDOR prevention (manipulated salesperson IDs, dealer IDs, roles).
 * 5. Lifecycle & status-transition authorization (transition, delete, assign locked to admins).
 * 6. Fail-closed behavior on missing or invalid sales assignments.
 * 7. Server-side redaction of internal cost and margin fields for Sales Executive and Dealer.
 * 8. Non-regression of Stage 1 tenant-context (actAs null fallback) and permission aliases.
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/stage2-quotation-ownership.test.ts
 */

import assert from "node:assert/strict";
import {
  canViewQuotation,
  canModifyQuotation,
  canDeleteQuotation,
  salesExecutiveVisibilityFilter,
  dealerVisibilityFilter,
  quotationVisibilityFilter,
  type QuotationOwnershipFields,
} from "../src/lib/quotationAccess";
import {
  resolveNewQuotationOwnership,
} from "../src/lib/quotationOwnership";
import {
  redactQuotationForRole,
  redactProductForRole,
  redactVariantForRole,
  isPrivilegedRole,
} from "../src/lib/variantRedaction";
import {
  hasPermission,
  resolvePermission,
  PERMISSION_ALIASES,
  SALES_EXECUTIVE_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
} from "../src/lib/permissions";
import { runWithTenantContext, getTenantContext } from "../src/lib/tenant/context";
import { AdminUser } from "../src/models";
import {
  createQuotationSchema,
  updateQuotationSchema,
  assignQuotationSchema,
  duplicateQuotationSchema,
} from "../src/lib/validation/quotation";

let passed = 0;
const testCase = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

async function runTests() {
  console.log("\n--- Phase 3, Stage 2: Quotation Authorization & Ownership Tests ---\n");

  // ── 1. Assigned vs Unassigned Sales Executive Quotations ───────────────────
  console.log("[1] Sales Executive Record-Level Ownership & Fail-Closed Behavior");

  testCase("Sales Executive can view quotation assigned to their userId", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: 101,
      createdBy: "999",
    };
    assert.equal(canViewQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), true);
  });

  testCase("Sales Executive CANNOT view quotation assigned to another salesperson", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: 102,
      createdBy: "999",
    };
    assert.equal(canViewQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Sales Executive FAILS CLOSED on unassigned quotation (assignedSalesId is null)", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: null,
      createdBy: "101", // even if created by them previously, unassigned fails closed
    };
    assert.equal(canViewQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Sales Executive FAILS CLOSED on quotation with undefined assignedSalesId", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: undefined,
    };
    assert.equal(canViewQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Sales Executive can modify assigned quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: 101,
    };
    assert.equal(canModifyQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), true);
  });

  testCase("Sales Executive CANNOT modify unassigned quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: null,
    };
    assert.equal(canModifyQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Sales Executive CANNOT delete any quotation, even their own assigned draft", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      assignedSalesId: 101,
    };
    assert.equal(canDeleteQuotation("sales_executive", 101, quote, [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
  });

  // ── 2. Dealer Record-Level Ownership ──────────────────────────────────────
  console.log("\n[2] Dealer Record-Level Ownership");

  testCase("Dealer can view quotation where dealerId === userId", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: 201,
      assignedSalesId: null,
    };
    assert.equal(canViewQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), true);
  });

  testCase("Dealer can view quotation where createdBy === String(userId)", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: null,
      createdBy: "201",
    };
    assert.equal(canViewQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), true);
  });

  testCase("Dealer CANNOT view another dealer's quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: 202,
      createdBy: "202",
    };
    assert.equal(canViewQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Dealer CANNOT modify another dealer's quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: 202,
    };
    assert.equal(canModifyQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), false);
  });

  testCase("Dealer can delete their own quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: 201,
    };
    assert.equal(canDeleteQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), true);
  });

  testCase("Dealer CANNOT delete another dealer's quotation", () => {
    const quote: QuotationOwnershipFields = {
      dealerId: 202,
    };
    assert.equal(canDeleteQuotation("dealer", 201, quote, [...DEALER_DEFAULT_PERMISSIONS]), false);
  });

  // ── 3. Database Query Visibility Filters ──────────────────────────────────
  console.log("\n[3] Database Query Visibility Filters");

  testCase("salesExecutiveVisibilityFilter produces strict { assignedSalesId: userId } query", () => {
    const filter = salesExecutiveVisibilityFilter(101);
    assert.deepEqual(filter, { assignedSalesId: 101 });
  });

  testCase("dealerVisibilityFilter produces { $or: [{ dealerId }, { createdBy }] } query", () => {
    const filter = dealerVisibilityFilter(201);
    assert.deepEqual(filter, {
      $or: [{ dealerId: 201 }, { createdBy: "201" }],
    });
  });

  testCase("quotationVisibilityFilter routes accurately by role", () => {
    assert.deepEqual(quotationVisibilityFilter("sales_executive", 101), { assignedSalesId: 101 });
    assert.deepEqual(quotationVisibilityFilter("dealer", 201), {
      $or: [{ dealerId: 201 }, { createdBy: "201" }],
    });
    // Admin has no extra user-level filter (company scope is added by tenant plugin)
    assert.deepEqual(quotationVisibilityFilter("admin", 1), null);
    assert.deepEqual(quotationVisibilityFilter("super_admin", 1), null);
  });

  // ── 4. Parameter Manipulation & IDOR Protection ───────────────────────────
  console.log("\n[4] Parameter Manipulation & IDOR Protection");

  await testCase("Sales Executive assigning dealer throws FORBIDDEN", async () => {
    await assert.rejects(
      () =>
        resolveNewQuotationOwnership({
          role: "sales_executive",
          userId: 101,
          requestedDealerId: 205, // Attacker tries to set dealer
        }),
      /Sales Executives cannot assign a quotation to a dealer/
    );
  });

  await testCase("Sales Executive attempting to assign another sales executive throws FORBIDDEN", async () => {
    await assert.rejects(
      () =>
        resolveNewQuotationOwnership({
          role: "sales_executive",
          userId: 101,
          requestedDealerId: null,
          requestedSalesId: 999, // Attacker tries to assign to someone else
        }),
      /Sales Executives cannot assign a quotation to another sales executive/
    );
  });

  await testCase("Sales Executive creating quotation binds assignedSalesId to authenticated userId", async () => {
    const ownership = await resolveNewQuotationOwnership({
      role: "sales_executive",
      userId: 101,
      requestedDealerId: null,
    });

    assert.equal(ownership.assignedSalesId, 101);
    assert.equal(ownership.dealerId, null);
    assert.equal(ownership.assignedBy, null);
  });

  await testCase("Dealer attempting to assign quotation to another dealer throws FORBIDDEN", async () => {
    await assert.rejects(
      () =>
        resolveNewQuotationOwnership({
          role: "dealer",
          userId: 201,
          requestedDealerId: 999, // Attacker tries to assign to another dealer
        }),
      /Dealers cannot assign a quotation to another dealer/
    );
  });

  await testCase("Dealer quotation creation strictly binds dealerId to authenticated userId and clears salesId", async () => {
    const origFindById = AdminUser.findById;
    try {
      const mockDealer = {
        _id: 201,
        discountAllocationPercent: 10,
        isActive: true,
        role: "dealer",
        companyId: 1,
      };
      AdminUser.findById = ((id: any) => ({
        select: () => ({
          lean: async () => mockDealer,
        }),
        lean: async () => mockDealer,
      })) as any;

      await runWithTenantContext({ companyId: 1, userId: 201, role: "dealer", actingAsCompany: false }, async () => {
        const ownership = await resolveNewQuotationOwnership({
          role: "dealer",
          userId: 201,
          requestedDealerId: 201,
          requestedSalesId: 101, // Attacker tries to assign sales executive
        });

        assert.equal(ownership.dealerId, 201);
        assert.equal(ownership.assignedSalesId, null);
      });
    } finally {
      AdminUser.findById = origFindById;
    }
  });

  await testCase("Admin creating quotation with validated Sales Executive succeeds", async () => {
    const origFindOne = AdminUser.findOne;
    try {
      AdminUser.findOne = ((query: any) => {
        const fn = async () => {
          if (query?._id === 105 && query?.role === "sales_executive") {
            return { _id: 105, role: "sales_executive", isActive: true, companyId: 1 };
          }
          return null;
        };
        return {
          select: () => ({ lean: fn }),
          lean: fn,
        };
      }) as any;

      await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
        const ownership = await resolveNewQuotationOwnership({
          role: "admin",
          userId: 1,
          requestedSalesId: 105,
        });
        assert.equal(ownership.assignedSalesId, 105);
      });
    } finally {
      AdminUser.findOne = origFindOne;
    }
  });

  await testCase("Admin creating quotation with non-existent or invalid Sales Executive throws VALIDATION_ERROR", async () => {
    const origFindOne = AdminUser.findOne;
    try {
      AdminUser.findOne = (() => ({
        select: () => ({ lean: async () => null }),
        lean: async () => null,
      })) as any;

      await runWithTenantContext({ companyId: 1, userId: 1, role: "admin", actingAsCompany: true }, async () => {
        await assert.rejects(
          () =>
            resolveNewQuotationOwnership({
              role: "admin",
              userId: 1,
              requestedSalesId: 999,
            }),
          /Sales executive not found/i
        );
      });
    } finally {
      AdminUser.findOne = origFindOne;
    }
  });

  testCase("createQuotationSchema validates assignedSalesId as nullable positive integer", () => {
    const valid = createQuotationSchema.parse({
      clientName: "Acme Corp",
      assignedSalesId: 105,
    });
    assert.equal(valid.assignedSalesId, 105);

    const validNull = createQuotationSchema.parse({
      clientName: "Acme Corp",
      assignedSalesId: null,
    });
    assert.equal(validNull.assignedSalesId, null);

    assert.throws(() => {
      createQuotationSchema.parse({
        clientName: "Acme Corp",
        assignedSalesId: -5,
      });
    });
  });

  testCase("assignQuotationSchema accepts assignedSalesId alongside dealerId", () => {
    const parsed = assignQuotationSchema.parse({
      dealerId: 201,
      assignedSalesId: 105,
    });
    assert.equal(parsed.dealerId, 201);
    assert.equal(parsed.assignedSalesId, 105);
  });

  // ── 5. Status-Transition & Lifecycle Permissions ──────────────────────────
  console.log("\n[5] Status Transition & Lifecycle Permissions");

  testCase("Sales Executive LACKS quotations:transition permission", () => {
    assert.equal(hasPermission("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS], "quotations:transition"), false);
  });

  testCase("Dealer LACKS quotations:transition permission", () => {
    assert.equal(hasPermission("dealer", [...DEALER_DEFAULT_PERMISSIONS], "quotations:transition"), false);
  });

  testCase("Admin HAS quotations:transition permission", () => {
    assert.equal(hasPermission("admin", [...ADMIN_PERMISSIONS], "quotations:transition"), true);
  });

  testCase("Sales Executive LACKS quotations:assign_dealer permission", () => {
    assert.equal(hasPermission("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS], "quotations:assign_dealer"), false);
  });

  testCase("Dealer LACKS quotations:assign_dealer permission", () => {
    assert.equal(hasPermission("dealer", [...DEALER_DEFAULT_PERMISSIONS], "quotations:assign_dealer"), false);
  });

  testCase("Sales Executive LACKS quotations:assign_sales permission", () => {
    assert.equal(hasPermission("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS], "quotations:assign_sales"), false);
  });

  testCase("Dealer LACKS quotations:assign_sales permission", () => {
    assert.equal(hasPermission("dealer", [...DEALER_DEFAULT_PERMISSIONS], "quotations:assign_sales"), false);
  });

  testCase("Admin HAS quotations:assign_sales permission", () => {
    assert.equal(hasPermission("admin", [...ADMIN_PERMISSIONS], "quotations:assign_sales"), true);
  });

  testCase("configurable_admin with assign_dealer alone CANNOT assign sales executive", () => {
    assert.equal(hasPermission("configurable_admin", ["quotations:assign_dealer"], "quotations:assign_sales"), false);
    assert.equal(hasPermission("configurable_admin", ["quotations:assign_dealer"], "quotations:assign_dealer"), true);
  });

  testCase("configurable_admin with assign_sales alone CANNOT assign dealer", () => {
    assert.equal(hasPermission("configurable_admin", ["quotations:assign_sales"], "quotations:assign_dealer"), false);
    assert.equal(hasPermission("configurable_admin", ["quotations:assign_sales"], "quotations:assign_sales"), true);
  });

  // ── 6. Restricted Cost & Margin Field Redaction ───────────────────────────
  console.log("\n[6] Cost & Margin Field Redaction");

  testCase("isPrivilegedRole denies pricing:view_cost to sales_executive and dealer", () => {
    assert.equal(isPrivilegedRole("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]), false);
    assert.equal(isPrivilegedRole("dealer", [...DEALER_DEFAULT_PERMISSIONS]), false);
    assert.equal(isPrivilegedRole("admin", [...ADMIN_PERMISSIONS]), true);
    assert.equal(isPrivilegedRole("super_admin"), true);
  });

  testCase("redactVariantForRole removes cost and purchaseTaxPercent for unprivileged roles", () => {
    const rawVariant = {
      _id: 1,
      sku: "WHYTE-DIM-01",
      surfaceFinish: "Matte Black",
      cost: 1500,
      purchaseTaxPercent: 18,
      price: 2500,
    };

    const redacted = redactVariantForRole(rawVariant, "sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]);
    assert.equal((redacted as any).cost, undefined);
    assert.equal((redacted as any).purchaseTaxPercent, undefined);
    assert.equal((redacted as any).price, 2500);

    const privileged = redactVariantForRole(rawVariant, "admin", [...ADMIN_PERMISSIONS]);
    assert.equal((privileged as any).cost, 1500);
    assert.equal((privileged as any).purchaseTaxPercent, 18);
  });

  testCase("redactQuotationForRole removes nested product/variant cost and purchaseTaxPercent", () => {
    const rawQuotation = {
      id: "q_test1",
      quotationNumber: "QT-2026-001",
      rooms: [
        {
          id: 1,
          customName: "Living Room",
          items: [
            {
              id: 10,
              quantity: 2,
              unitPrice: 3000,
              product: {
                name: "Smart Touch Switch",
                variants: [
                  {
                    id: 101,
                    cost: 1200,
                    purchaseTaxPercent: 18,
                    price: 3000,
                  },
                ],
              },
              productVariant: {
                id: 101,
                cost: 1200,
                purchaseTaxPercent: 18,
                surfaceFinish: "Matte Black",
              },
            },
          ],
        },
      ],
    };

    const redactedSales = redactQuotationForRole(rawQuotation as any, "sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS]);
    const itemSales = redactedSales.rooms![0].items![0] as any;
    assert.equal(itemSales.product.variants[0].cost, undefined);
    assert.equal(itemSales.product.variants[0].purchaseTaxPercent, undefined);
    assert.equal(itemSales.productVariant.cost, undefined);
    assert.equal(itemSales.productVariant.purchaseTaxPercent, undefined);
    assert.equal(itemSales.unitPrice, 3000);

    const redactedDealer = redactQuotationForRole(rawQuotation as any, "dealer", [...DEALER_DEFAULT_PERMISSIONS]);
    const itemDealer = redactedDealer.rooms![0].items![0] as any;
    assert.equal(itemDealer.product.variants[0].cost, undefined);
    assert.equal(itemDealer.product.variants[0].purchaseTaxPercent, undefined);

    const adminView = redactQuotationForRole(rawQuotation as any, "admin", [...ADMIN_PERMISSIONS]);
    const itemAdmin = adminView.rooms![0].items![0] as any;
    assert.equal(itemAdmin.product.variants[0].cost, 1200);
    assert.equal(itemAdmin.product.variants[0].purchaseTaxPercent, 18);
  });

  // ── 7. Regression Checks: Tenant Context & Permission Aliases ─────────────
  console.log("\n[7] Regression Protections: Stage 1 Tenant Context & Permission Aliases");

  await testCase("Super Admin without actAs session has null companyId in tenant context", async () => {
    await runWithTenantContext({ companyId: null, userId: 99, role: "super_admin", actingAsCompany: false }, async () => {
      const ctx = getTenantContext();
      assert.equal(ctx?.companyId, null, "Unassigned super_admin must NOT default to companyId 1");
      assert.equal(ctx?.actingAsCompany, false);
    });
  });

  testCase("Permission key aliases resolve correctly and bi-directionally in hasPermission", () => {
    assert.equal(resolvePermission("quotations:read"), "quotations:read_all");
    assert.equal(resolvePermission("quotations:update"), "quotations:edit_all");
    assert.equal(resolvePermission("quotations:approve"), "quotations:transition");
    assert.equal(resolvePermission("catalog:update"), "catalog:edit");
    assert.equal(resolvePermission("company:update"), "company:edit");

    // An admin with quotations:read_all automatically satisfies quotations:read checks
    assert.equal(hasPermission("admin", ["quotations:read_all"], "quotations:read"), true);
    assert.equal(hasPermission("admin", ["quotations:read"], "quotations:read_all"), true);

    // Sales Executive has quotations:create, but NOT quotations:read_all or quotations:read
    assert.equal(hasPermission("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS], "quotations:read_all"), false);
    assert.equal(hasPermission("sales_executive", [...SALES_EXECUTIVE_DEFAULT_PERMISSIONS], "quotations:read"), false);
  });

  console.log(`\nAll ${passed} Stage 2 authorization & ownership tests passed successfully!\n`);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
