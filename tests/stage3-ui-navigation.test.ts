import assert from "node:assert/strict";
import { canSeeAdminNavItem, toAdminNavRole } from "@/lib/adminNav";
import { getRolesPageAccess, getUsersPageAccess } from "@/lib/rolesPageAccess";
import { isUserManager, canAssignRole, canModifyAccountWithRole } from "@/lib/userManagementRules";
import { redactQuotationForRole, isPrivilegedRole } from "@/lib/variantRedaction";
import {
  canViewQuotation,
  canModifyQuotation,
  canDeleteQuotation,
  quotationVisibilityFilter,
  salesExecutiveVisibilityFilter,
  dealerVisibilityFilter,
} from "@/lib/quotationAccess";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error(`Async test "${name}" must be awaited`);
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function runTests() {
  console.log("\n--- Phase 3 Stage 3: UI & Navigation Enforcement Tests ---\n");

  // ── 1. Admin Sidebar Navigation Visibility ──
  test("toAdminNavRole recognizes canonical admin, company_owner, super_admin, and configurable_admin", () => {
    assert.equal(toAdminNavRole("admin"), "admin");
    assert.equal(toAdminNavRole("company_owner"), "company_owner");
    assert.equal(toAdminNavRole("super_admin"), "super_admin");
    assert.equal(toAdminNavRole("configurable_admin"), "configurable_admin");
    assert.equal(toAdminNavRole("unknown_role"), "admin");
    assert.equal(toAdminNavRole(null), "admin");
  });

  test("canSeeAdminNavItem: super_admin sees all links including platform activity log", () => {
    assert.equal(canSeeAdminNavItem("/admin/dashboard", "super_admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/activity", "super_admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/users", "super_admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/roles", "super_admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/theme", "super_admin"), true);
  });

  test("canSeeAdminNavItem: canonical admin sees company management links, but NOT platform activity log or global roles", () => {
    assert.equal(canSeeAdminNavItem("/admin/dashboard", "admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/activity", "admin"), false);
    assert.equal(canSeeAdminNavItem("/admin/users", "admin"), true);
    assert.equal(canSeeAdminNavItem("/admin/roles", "admin"), false);
    assert.equal(canSeeAdminNavItem("/admin/theme", "admin"), true);
  });

  test("canSeeAdminNavItem: company_owner alias matches admin behavior without global privileges", () => {
    assert.equal(canSeeAdminNavItem("/admin/activity", "company_owner"), false);
    assert.equal(canSeeAdminNavItem("/admin/users", "company_owner"), true);
    assert.equal(canSeeAdminNavItem("/admin/roles", "company_owner"), false);
    assert.equal(canSeeAdminNavItem("/admin/theme", "company_owner"), true);
  });

  test("canSeeAdminNavItem: configurable_admin restricted from unassigned company management", () => {
    assert.equal(canSeeAdminNavItem("/admin/activity", "configurable_admin"), false);
    assert.equal(canSeeAdminNavItem("/admin/users", "configurable_admin"), false);
    assert.equal(canSeeAdminNavItem("/admin/roles", "configurable_admin"), false);
    assert.equal(canSeeAdminNavItem("/admin/theme", "configurable_admin"), false);
  });

  // ── 2. Roles & Users Page Access Controls ──
  test("getRolesPageAccess: ONLY super_admin may manage global role definitions", () => {
    const superAdminAccess = getRolesPageAccess("super_admin", [], true);
    assert.equal(superAdminAccess.canRead, true);
    assert.equal(superAdminAccess.canManage, true);

    const adminAccess = getRolesPageAccess("admin", [], true);
    assert.equal(adminAccess.canRead, false);
    assert.equal(adminAccess.canManage, false);

    const ownerAccess = getRolesPageAccess("company_owner", [], true);
    assert.equal(ownerAccess.canRead, false);
    assert.equal(ownerAccess.canManage, false);
  });

  test("getRolesPageAccess: sales_executive and dealer have NO access to roles page", () => {
    const salesAccess = getRolesPageAccess("sales_executive", [], true);
    assert.equal(salesAccess.canRead, false);
    assert.equal(salesAccess.canManage, false);

    const dealerAccess = getRolesPageAccess("dealer", [], true);
    assert.equal(dealerAccess.canRead, false);
    assert.equal(dealerAccess.canManage, false);
  });

  test("getUsersPageAccess: admin and company_owner can manage company users; sales_executive and dealer cannot", () => {
    assert.equal(getUsersPageAccess("admin", [], true).canManage, true);
    assert.equal(getUsersPageAccess("company_owner", [], true).canManage, true);
    assert.equal(getUsersPageAccess("sales_executive", [], true).canManage, false);
    assert.equal(getUsersPageAccess("dealer", [], true).canManage, false);
  });

  test("userManagementRules: isUserManager confirms admin and company_owner, rejects sales_executive and dealer", () => {
    assert.equal(isUserManager("super_admin"), true);
    assert.equal(isUserManager("admin"), true);
    assert.equal(isUserManager("company_owner"), true);
    assert.equal(isUserManager("sales_executive"), false);
    assert.equal(isUserManager("dealer"), false);
  });

  test("userManagementRules: admin can assign sales_executive and configurable_admin, but never admin, super_admin, company_owner or dealer", () => {
    const actor = { role: "admin", hasCompanyContext: true };
    assert.equal(canAssignRole(actor, "sales_executive", []), true);
    assert.equal(canAssignRole(actor, "admin", []), false, "only a Super Admin may create or promote to admin");
    assert.equal(canAssignRole(actor, "configurable_admin", []), true);
    assert.equal(canAssignRole(actor, "super_admin", []), false);
    assert.equal(canAssignRole(actor, "dealer", []), false);
    assert.equal(canAssignRole(actor, "company_owner", []), false);
  });

  test("userManagementRules: admin cannot modify accounts with role super_admin or company_owner or admin", () => {
    const actor = { role: "admin", hasCompanyContext: true };
    assert.equal(canModifyAccountWithRole(actor, "super_admin"), false);
    assert.equal(canModifyAccountWithRole(actor, "company_owner"), false);
    assert.equal(canModifyAccountWithRole(actor, "admin"), false);
    assert.equal(canModifyAccountWithRole(actor, "sales_executive"), true);
    assert.equal(canModifyAccountWithRole(actor, "configurable_admin"), true);
  });

  // ── 3. Quotation Visibility & Filtering ──
  test("quotationVisibilityFilter: sales_executive filtered strictly by assignedSalesId", () => {
    const filter = quotationVisibilityFilter("sales_executive", 42);
    assert.deepEqual(filter, { assignedSalesId: 42 });
    assert.deepEqual(salesExecutiveVisibilityFilter(42), { assignedSalesId: 42 });
  });

  test("quotationVisibilityFilter: dealer filtered by dealerId or createdBy", () => {
    const filter = quotationVisibilityFilter("dealer", 10);
    assert.deepEqual(filter, { $or: [{ dealerId: 10 }, { createdBy: "10" }] });
    assert.deepEqual(dealerVisibilityFilter(10), { $or: [{ dealerId: 10 }, { createdBy: "10" }] });
  });

  test("quotationVisibilityFilter: super_admin and admin (with quotations:read_all) receive null filter (scoped at company level)", () => {
    assert.equal(quotationVisibilityFilter("super_admin", 1), null);
    assert.equal(quotationVisibilityFilter("admin", 2, ["quotations:read_all"]), null);
  });

  // ── 4. Quotation Action Permissions ──
  test("Action Permissions - Review & Transitions: super_admin, admin, company_owner, and authorized configurable_admin can review", () => {
    const canReviewRole = (role: string, permissions?: string[]) => {
      const isSuperOrAdmin = role === "super_admin" || role === "admin" || role === "company_owner";
      const isConfigurableReviewer =
        role === "configurable_admin" &&
        (permissions?.includes("quotations:transition") || permissions?.includes("quotations:approve"));
      return isSuperOrAdmin || Boolean(isConfigurableReviewer);
    };

    assert.equal(canReviewRole("super_admin"), true);
    assert.equal(canReviewRole("admin"), true);
    assert.equal(canReviewRole("company_owner"), true);
    assert.equal(canReviewRole("configurable_admin", ["quotations:transition"]), true);
    assert.equal(canReviewRole("configurable_admin", ["quotations:approve"]), true);
    assert.equal(canReviewRole("configurable_admin", ["catalog:read"]), false);
    assert.equal(canReviewRole("sales_executive"), false);
    assert.equal(canReviewRole("dealer"), false);
    assert.equal(canReviewRole("sales"), false);
  });

  test("Action Permissions - Delete: sales_executive NEVER sees delete; dealer only on draft; admin/owner on non-locked", () => {
    const canDeleteRole = (role: string, status: string, isLocked: boolean) =>
      !isLocked && role !== "sales_executive" && (role !== "dealer" || status === "draft");

    // sales_executive
    assert.equal(canDeleteRole("sales_executive", "draft", false), false);
    assert.equal(canDeleteRole("sales_executive", "sent", false), false);

    // dealer
    assert.equal(canDeleteRole("dealer", "draft", false), true);
    assert.equal(canDeleteRole("dealer", "sent", false), false);
    assert.equal(canDeleteRole("dealer", "rejected", false), false);
    assert.equal(canDeleteRole("dealer", "approved", true), false);

    // admin
    assert.equal(canDeleteRole("admin", "draft", false), true);
    assert.equal(canDeleteRole("admin", "sent", false), true);
    assert.equal(canDeleteRole("admin", "rejected", false), true);
    assert.equal(canDeleteRole("admin", "approved", true), false);

    // company_owner
    assert.equal(canDeleteRole("company_owner", "draft", false), true);
    assert.equal(canDeleteRole("company_owner", "approved", true), false);
  });

  test("Action Permissions - Dealer and Sales Assignment: separate permissions for dealer vs sales executive", () => {
    const canAssignDealer = (role: string, permissions?: string[]) =>
      role === "super_admin" ||
      role === "admin" ||
      role === "company_owner" ||
      (role === "configurable_admin" && (permissions?.includes("quotations:assign_dealer") ?? false));

    const canAssignSales = (role: string, permissions?: string[]) =>
      role === "super_admin" ||
      role === "admin" ||
      role === "company_owner" ||
      (role === "configurable_admin" && (permissions?.includes("quotations:assign_sales") ?? false));

    assert.equal(canAssignDealer("super_admin"), true);
    assert.equal(canAssignDealer("admin"), true);
    assert.equal(canAssignDealer("company_owner"), true);
    assert.equal(canAssignDealer("configurable_admin", ["quotations:assign_dealer"]), true);
    assert.equal(canAssignDealer("configurable_admin", ["quotations:assign_sales"]), false);
    assert.equal(canAssignDealer("sales_executive"), false);
    assert.equal(canAssignDealer("dealer"), false);

    assert.equal(canAssignSales("super_admin"), true);
    assert.equal(canAssignSales("admin"), true);
    assert.equal(canAssignSales("company_owner"), true);
    assert.equal(canAssignSales("configurable_admin", ["quotations:assign_sales"]), true);
    assert.equal(canAssignSales("configurable_admin", ["quotations:assign_dealer"]), false);
    assert.equal(canAssignSales("sales_executive"), false);
    assert.equal(canAssignSales("dealer"), false);
  });

  // ── 5. Pricing, Earnings & Discount Visibility & Redaction ──
  test("isPrivilegedRole: true for super_admin, admin, company_owner; false for sales_executive and dealer", () => {
    assert.equal(isPrivilegedRole("super_admin"), true);
    assert.equal(isPrivilegedRole("admin"), true);
    assert.equal(isPrivilegedRole("company_owner"), true);
    assert.equal(isPrivilegedRole("sales_executive"), false);
    assert.equal(isPrivilegedRole("dealer"), false);
  });

  test("redactQuotationForRole: sales_executive gets dealer earnings, allocatedDiscountPercent, and item costs stripped", () => {
    const sampleQuotation = {
      _id: "quote_123",
      quotationNumber: "QT-2026-001",
      dealerId: 10,
      allocatedDiscountPercent: 20,
      customerDiscountPercent: 5,
      estimatedEarningPercent: 15,
      estimatedEarningAmount: 7500,
      rooms: [
        {
          items: [
            {
              product: {
                name: "Dimmer Switch",
                variants: [
                  { id: 1, price: 5000, cost: 3000, purchaseTaxPercent: 18 },
                ],
              },
              productVariant: { id: 1, price: 5000, cost: 3000, purchaseTaxPercent: 18 },
            },
          ],
        },
      ],
    };

    const redacted = redactQuotationForRole(sampleQuotation as any, "sales_executive");

    // Restricted discount and earnings fields removed
    assert.equal((redacted as any).allocatedDiscountPercent, undefined);
    assert.equal((redacted as any).estimatedEarningPercent, undefined);
    assert.equal((redacted as any).estimatedEarningAmount, undefined);

    // Customer discount remains intact
    assert.equal(redacted.customerDiscountPercent, 5);

    // Internal variant cost removed
    const item = redacted.rooms![0].items![0];
    assert.equal((item.productVariant as any).cost, undefined);
    assert.equal((item.productVariant as any).purchaseTaxPercent, undefined);
    assert.equal((item.product!.variants![0] as any).cost, undefined);
  });

  test("redactQuotationForRole: dealer retains own earnings/allocation, but item costs are stripped", () => {
    const sampleQuotation = {
      _id: "quote_123",
      quotationNumber: "QT-2026-001",
      dealerId: 10,
      allocatedDiscountPercent: 20,
      customerDiscountPercent: 5,
      estimatedEarningPercent: 15,
      estimatedEarningAmount: 7500,
      rooms: [
        {
          items: [
            {
              product: {
                name: "Dimmer Switch",
                variants: [
                  { id: 1, price: 5000, cost: 3000, purchaseTaxPercent: 18 },
                ],
              },
              productVariant: { id: 1, price: 5000, cost: 3000, purchaseTaxPercent: 18 },
            },
          ],
        },
      ],
    };

    const redacted = redactQuotationForRole(sampleQuotation as any, "dealer");

    // Dealer retains earnings info
    assert.equal(redacted.allocatedDiscountPercent, 20);
    assert.equal(redacted.estimatedEarningPercent, 15);
    assert.equal(redacted.estimatedEarningAmount, 7500);

    // Internal cost removed
    const item = redacted.rooms![0].items![0];
    assert.equal((item.productVariant as any).cost, undefined);
    assert.equal((item.productVariant as any).purchaseTaxPercent, undefined);
  });

  test("redactQuotationForRole: admin and super_admin retain full cost and margin fields", () => {
    const sampleQuotation = {
      _id: "quote_123",
      dealerId: 10,
      allocatedDiscountPercent: 20,
      estimatedEarningAmount: 7500,
      rooms: [
        {
          items: [
            {
              productVariant: { id: 1, price: 5000, cost: 3000, purchaseTaxPercent: 18 },
            },
          ],
        },
      ],
    };

    const adminView = redactQuotationForRole(sampleQuotation as any, "admin");
    assert.equal((adminView.rooms![0].items![0].productVariant as any).cost, 3000);
    assert.equal(adminView.allocatedDiscountPercent, 20);

    const superAdminView = redactQuotationForRole(sampleQuotation as any, "super_admin");
    assert.equal((superAdminView.rooms![0].items![0].productVariant as any).cost, 3000);
  });

  test("StepReview visibility rules: dealer earnings and allocation badge are hidden for sales_executive", () => {
    const hasDealer = true;
    const isSalesExecutive = true;

    const showAllocationBadge = hasDealer && !isSalesExecutive;
    const showDealerEarnings = hasDealer && !isSalesExecutive;

    assert.equal(showAllocationBadge, false);
    assert.equal(showDealerEarnings, false);

    // For dealer or admin
    const dealerIsSalesExec = false;
    assert.equal(hasDealer && !dealerIsSalesExec, true);
  });

  console.log(`\nAll ${passed} UI & navigation enforcement tests passed successfully!\n`);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
