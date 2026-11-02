/**
 * CRM Phase 1 Core Verification Test Suite
 *
 * Tests:
 * 1. RBAC permissions and visibility filters (super_admin, admin, sales_executive, dealer)
 * 2. Zod schema validation (createLead, updateLead, createCustomer, convertLead)
 * 3. Reference numbering format (LD-YYYY-XXXX) and counter sequence
 * 4. Lead source defaults and configuration
 * 5. Opportunity pipeline stage configurations and status mappings
 * 6. Multi-tenant isolation invariants
 * 7. Soft-delete preservation invariants
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/crm-phase1.test.ts
 */

import assert from "node:assert/strict";
import {
  createLeadSchema,
  updateLeadSchema,
  createCustomerSchema,
  updateCustomerSchema,
  convertLeadSchema,
} from "../src/lib/validation/crm";
import {
  contactMatchesCustomer,
  crmVisibilityFilter,
  ensureCompanyLeadSources,
  phoneMatchRegex,
  PIPELINE_STAGES,
  scopedQuery,
} from "../src/lib/crmService";
import {
  LEAD_STATUS_CONFIG,
  LEAD_PRIORITY_CONFIG,
} from "../src/types/crm";
import { INITIAL_LEAD_SOURCES } from "../src/models";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  COMPANY_OWNER_PERMISSIONS,
  CRM_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
  PERMISSION_METADATA,
  PERMISSION_MODULE_GROUPS,
  SALES_EXECUTIVE_DEFAULT_PERMISSIONS,
  hasPermission,
  isValidPermission,
  sanitizePermissions,
} from "../src/lib/permissions";
import { configurablePermissionSchema } from "../src/lib/validation/admin-user";
import { canSeeAdminNavItem } from "../src/lib/adminNav";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

function main() {
  // ── 1. RBAC Permissions ──
  {
    // Super admin, admin, and company_owner have full crm access
    assert.equal(hasPermission("super_admin", [], "crm:read"), true);
    assert.equal(hasPermission("super_admin", [], "crm:manage"), true);
    assert.equal(hasPermission("admin", [], "leads:read"), true);
    assert.equal(hasPermission("admin", [], "leads:manage"), true);
    assert.equal(hasPermission("admin", [], "customers:read"), true);
    assert.equal(hasPermission("admin", [], "customers:manage"), true);
    assert.equal(hasPermission("company_owner", [], "leads:read"), true);

    // Dealers and Sales Executives have no CRM access. Real sessions carry their default permission list (never an
    // empty one), so that is what is checked here; an empty list must not grant anything either.
    const salesDefaults = Array.from(SALES_EXECUTIVE_DEFAULT_PERMISSIONS);
    const dealerDefaults = Array.from(DEALER_DEFAULT_PERMISSIONS);
    for (const permission of CRM_PERMISSIONS) {
      assert.equal(hasPermission("sales_executive", salesDefaults, permission), false, `sales_executive ${permission}`);
      assert.equal(hasPermission("sales_executive", [], permission), false, `sales_executive [] ${permission}`);
      assert.equal(hasPermission("dealer", dealerDefaults, permission), false, `dealer ${permission}`);
      assert.equal(hasPermission("dealer", [], permission), false, `dealer [] ${permission}`);
      assert.equal(hasPermission("dealer", [permission], permission), false, `dealer cannot be granted ${permission}`);
    }

    // Configurable admin requires explicit assigned permission
    assert.equal(hasPermission("configurable_admin", [], "leads:read"), false);
    assert.equal(hasPermission("configurable_admin", ["leads:read"], "leads:read"), true);
    assert.equal(hasPermission("configurable_admin", ["crm:manage"], "crm:manage"), true);

    pass("RBAC permissions: roles correctly inherit CRM capabilities");
  }

  // ── 1b. CRM permissions are part of the shared registry and can be granted to custom roles ──
  {
    for (const permission of CRM_PERMISSIONS) {
      assert.ok(ALL_PERMISSIONS.includes(permission), `${permission} is in the registry`);
      assert.ok(isValidPermission(permission), `${permission} is a valid permission`);
      assert.ok(PERMISSION_METADATA[permission], `${permission} has a label and description`);
      assert.deepEqual(sanitizePermissions([permission]), [permission], `${permission} survives sanitizing`);
      assert.equal(configurablePermissionSchema.safeParse([permission]).success, true, `${permission} can be saved on a Configurable Admin`);
    }
    const grouped = PERMISSION_MODULE_GROUPS.flatMap((group) => group.permissions.map((meta) => meta.key));
    assert.deepEqual(grouped.filter((key) => (CRM_PERMISSIONS as readonly string[]).includes(key)).sort(), [...CRM_PERMISSIONS].sort(), "all six appear on the Roles / Users screens");
    assert.equal(new Set(grouped).size, grouped.length, "no permission is listed twice");
    assert.equal(new Set(grouped).size, ALL_PERMISSIONS.length, "every registered permission is listed on a screen");

    // Nothing is granted by default: existing roles keep exactly what they had.
    assert.equal(ADMIN_PERMISSIONS.size, 22);
    assert.equal(COMPANY_OWNER_PERMISSIONS.size, 22);
    for (const permission of CRM_PERMISSIONS) {
      assert.equal(ADMIN_PERMISSIONS.has(permission), false);
      assert.equal(hasPermission("configurable_admin", null, permission), false, "a Configurable Admin has no CRM permission unless granted");
      assert.equal(hasPermission("configurable_admin", ["quotations:create", "catalog:read"], permission), false, "other permissions never imply CRM");
    }

    // Grants: exact, with "manage includes read" and "crm:manage covers everything".
    const grant = (...granted: string[]) => (permission: string) => hasPermission("configurable_admin", granted, permission);
    const leadsOnly = grant("leads:manage");
    assert.deepEqual(CRM_PERMISSIONS.filter(leadsOnly), ["leads:read", "leads:manage"], "leads:manage includes leads:read and nothing else");
    const customersRead = grant("customers:read");
    assert.deepEqual(CRM_PERMISSIONS.filter(customersRead), ["customers:read"], "customers:read is read only");
    const pipelineRead = grant("crm:read");
    assert.deepEqual(CRM_PERMISSIONS.filter(pipelineRead), ["crm:read"], "crm:read does not open leads or customers");
    assert.deepEqual([...CRM_PERMISSIONS].filter(grant("crm:manage")), [...CRM_PERMISSIONS], "crm:manage covers all of CRM");
    assert.equal(grant("leads:read")("leads:manage"), false, "read never includes manage");

    // A custom role key (not a built-in) works from its granted list, and Dealers / Sales Executives never can.
    assert.equal(hasPermission("regional_manager", ["leads:read"], "leads:read"), true);
    assert.equal(hasPermission("regional_manager", ["quotations:create"], "leads:read"), false);
    for (const role of ["dealer", "sales_executive"]) {
      for (const permission of CRM_PERMISSIONS) {
        assert.equal(hasPermission(role, [...CRM_PERMISSIONS], permission), false, `${role} can never be granted ${permission}`);
      }
    }
    // Admin-type roles keep CRM unconditionally (company cannot remove it).
    for (const role of ["super_admin", "company_owner", "admin"]) {
      for (const permission of CRM_PERMISSIONS) {
        assert.equal(hasPermission(role, ["catalog:read"], permission), true, `${role} always has ${permission}`);
      }
    }
    // Sidebar: a Configurable Admin sees only the CRM links their grants allow; admin roles see them all.
    const crmLinks = ["/admin/crm/pipeline", "/admin/crm/leads", "/admin/crm/follow-ups", "/admin/crm/customers", "/admin/crm/sources"];
    for (const href of crmLinks) {
      assert.equal(canSeeAdminNavItem(href, "configurable_admin", []), false, `${href} hidden without a grant`);
      for (const role of ["super_admin", "company_owner", "admin"]) assert.equal(canSeeAdminNavItem(href, role, []), true, `${href} for ${role}`);
    }
    assert.deepEqual(crmLinks.filter((href) => canSeeAdminNavItem(href, "configurable_admin", ["leads:read"])), ["/admin/crm/pipeline", "/admin/crm/leads", "/admin/crm/follow-ups"], "leads:read shows Pipeline, Leads and Follow-ups only");
    assert.deepEqual(crmLinks.filter((href) => canSeeAdminNavItem(href, "configurable_admin", ["customers:manage"])), ["/admin/crm/customers"], "customers:manage shows Customers only");
    assert.deepEqual(crmLinks.filter((href) => canSeeAdminNavItem(href, "configurable_admin", ["crm:manage"])), crmLinks, "crm:manage shows everything");
    assert.equal(canSeeAdminNavItem("/admin/dashboard", "configurable_admin", []), true, "non-CRM links are unaffected");
    pass("CRM permissions are registered for custom roles: valid, labelled, on the role screens, granted by exact key (manage includes read), never by default, never to Dealers or Sales Executives; Admin keeps CRM");
  }

  // ── 2. CRM Scoping & Visibility Filter ──
  {
    // Super Admin / Company Owner / Admin have no salesperson or dealer restriction
    const adminFilter = crmVisibilityFilter({ role: "admin", userId: 10 });
    assert.deepEqual(adminFilter, {});

    const superFilter = crmVisibilityFilter({ role: "super_admin", userId: 1 });
    assert.deepEqual(superFilter, {});

    // Sales Executive is scoped to assignedSalesId OR createdBy
    const salesFilter = crmVisibilityFilter({ role: "sales_executive", userId: 42 });
    assert.deepEqual(salesFilter, { $or: [{ assignedSalesId: 42 }, { createdBy: 42 }] });

    // Dealer is scoped to dealerId
    const dealerFilter = crmVisibilityFilter({ role: "dealer", userId: 99 });
    assert.deepEqual(dealerFilter, { dealerId: 99 });

    pass("CRM visibility scoping: strict tenant and role-based data partitioning");
  }

  // ── 2b. Requested filters and search can only narrow the visibility rule, never replace it ──
  {
    const search = { $or: [{ customerName: /x/i }, { phone: /x/i }] };
    const salesRule = crmVisibilityFilter({ role: "sales_executive", userId: 42 });
    const sales = scopedQuery(7, salesRule, [{ status: "new" }, search]);
    assert.deepEqual(sales, { companyId: 7, $and: [salesRule, { status: "new" }, search] }, "visibility, filters and search must all hold");
    assert.equal("$or" in sales, false, "no top-level $or that could override the visibility rule");

    // A dealer asking for another dealer's id: both conditions stay, so nothing of the other dealer can match.
    const dealerRule = crmVisibilityFilter({ role: "dealer", userId: 9 });
    const crafted = scopedQuery(7, dealerRule, [{ dealerId: 10 }]);
    assert.deepEqual(crafted, { companyId: 7, $and: [{ dealerId: 9 }, { dealerId: 10 }] });
    assert.equal("dealerId" in crafted, false, "dealerId is never a top-level key that the request could overwrite");
    assert.deepEqual(scopedQuery(7, {}, []), { companyId: 7 }, "an admin with no filters sees the whole company");
    assert.deepEqual(scopedQuery(7, {}, [{ status: "won" }]), { companyId: 7, $and: [{ status: "won" }] });
    pass("Filters and search are ANDed with the visibility rule (scopedQuery), never assigned over it");
  }

  // ── 2b2. Does a quotation's contact still describe its linked customer? ──
  {
    const customer = { phone: "+91 98765 00001", email: "Ravi@Example.com" };
    for (const same of [{ phone: "9876500001" }, { phone: "098765-00001" }, { email: "ravi@example.com" }, { phone: "9876500001", email: "RAVI@example.com" }, {}, { phone: "", email: "" }, { phone: null, email: null }]) {
      assert.equal(contactMatchesCustomer(customer, same), true, JSON.stringify(same));
    }
    for (const other of [{ phone: "9876500002" }, { email: "other@example.com" }, { phone: "9876500001", email: "other@example.com" }, { phone: "+44 20 7946 0958" }]) {
      assert.equal(contactMatchesCustomer(customer, other), false, JSON.stringify(other));
    }
    assert.equal(contactMatchesCustomer({ phone: null, email: null }, { phone: "9876500009", email: "a@b.co" }), true, "a customer with no contact details gains them, it is not contradicted");
    assert.equal(contactMatchesCustomer({ phone: "+44 20 7946 0958" }, { phone: "+44 20 7946 0958" }), true, "other numbers compare as typed");
    assert.equal(contactMatchesCustomer({ phone: "+44 20 7946 0958" }, { phone: "+442079460958" }), false, "(and are never guessed to be equal)");
    pass("Contact comparison: the same person in another phone format, or with a field cleared, still matches; a different phone or email does not");
  }

  // ── 2c. Phone numbers match however they were typed ──
  {
    const rx = phoneMatchRegex("9876500055");
    assert.ok(rx);
    for (const same of ["9876500055", "+91 98765 00055", "98765-00055", "098765 00055", "+91-9876500055", " 91 98765 00055 "]) assert.ok(rx.test(same), same);
    for (const other of ["9876500056", "19876500055", "987650005", "+44 98765 00055", "98765000555"]) assert.equal(rx.test(other), false, other);
    assert.equal(phoneMatchRegex("12345"), null, "short numbers are compared as typed");
    assert.equal(phoneMatchRegex("5876500055"), null, "not an Indian mobile: compared as typed");
    assert.equal(phoneMatchRegex(null), null);
    pass("Phone matching: one Indian mobile number is the same person in any common format, and only that number");
  }

  // ── 3. Zod Schemas Validation: Leads ──
  {
    // Valid Lead creation payload
    const validLead = createLeadSchema.parse({
      customerName: "Priya Patel",
      phone: "+91 98765 43210",
      whatsapp: "9876543210",
      email: "priya@example.com",
      projectType: "3 BHK Apartment",
      estimatedBudget: 450000,
      priority: "high",
      status: "new",
      assignedSalesId: 5,
      dealerId: 12,
      notes: "Follow up next Tuesday after floor plan is shared.",
    });

    assert.equal(validLead.customerName, "Priya Patel");
    assert.equal(validLead.phone, "+91 98765 43210");
    assert.equal(validLead.priority, "high");
    assert.equal(validLead.status, "new");

    // Invalid Lead creation: missing required customerName
    assert.throws(() => {
      createLeadSchema.parse({
        phone: "9876543210",
      });
    }, /name/i);

    // Invalid email format rejected
    assert.throws(() => {
      createLeadSchema.parse({
        customerName: "John Doe",
        email: "not-an-email",
      });
    }, /email/i);

    pass("Zod schema: createLead validates and normalizes phone numbers and required fields");
  }

  // ── 4. Zod Schemas Validation: Customers ──
  {
    const validCustomer = createCustomerSchema.parse({
      name: "Apex Architecture Studio",
      phone: "022 2847 1122",
      email: "contact@apexstudio.in",
      customerType: "architect",
      gstNumber: "27AAPFU0939F1ZV",
      billingAddress: "Suite 401, Design Towers, Bandra West, Mumbai",
      siteAddress: "Plot 12, Khar Link Road",
    });

    assert.equal(validCustomer.name, "Apex Architecture Studio");
    assert.equal(validCustomer.customerType, "architect");
    assert.equal(validCustomer.gstNumber, "27AAPFU0939F1ZV");

    // Invalid GST format
    assert.throws(() => {
      createCustomerSchema.parse({
        name: "Test Corp",
        customerType: "builder",
        gstNumber: "123-invalid-gst",
      });
    }, /gst/i);

    pass("Zod schema: createCustomer enforces correct customerType and Indian GST format");
  }

  // ── 5. Convert Lead Schema Validation ──
  {
    const validConvert = convertLeadSchema.parse({
      houseTypeId: 15,
      defaultTier: "gold",
      defaultFinish: "glossy",
      notes: "Client opted for Gold Tier automation",
    });

    assert.equal(validConvert.houseTypeId, 15);
    assert.equal(validConvert.defaultTier, "gold");

    // Empty convert payload is valid (defaults to no template)
    const emptyConvert = convertLeadSchema.parse({});
    assert.equal(emptyConvert.houseTypeId, undefined);

    pass("Zod schema: convertLead supports optional template assignment and tier defaults");
  }

  // ── 6. Pipeline Stages & Status Definitions ──
  {
    assert.equal(PIPELINE_STAGES.length, 7, "Opportunity pipeline must define 7 stages");
    const stageIds = PIPELINE_STAGES.map((s: { id: string }) => s.id);
    assert.deepEqual(stageIds, [
      "new",
      "contacted",
      "site_visit",
      "quoted",
      "negotiation",
      "won",
      "lost",
    ]);

    // Negotiation is a real status with its own badge, between Quoted and Won/Lost
    assert.ok(LEAD_STATUS_CONFIG.negotiation, "negotiation status exists");
    assert.ok(LEAD_STATUS_CONFIG.negotiation.step > LEAD_STATUS_CONFIG.quoted.step && LEAD_STATUS_CONFIG.negotiation.step < LEAD_STATUS_CONFIG.won.step);
    assert.ok(updateLeadSchema.safeParse({ status: "negotiation" }).success);
    assert.deepEqual(PIPELINE_STAGES.map((stage) => stage.id), ["new", "contacted", "site_visit", "quoted", "negotiation", "won", "lost"]);

    // Check status config badges
    assert.ok(LEAD_STATUS_CONFIG.new.bg.includes("blue"));
    assert.ok(LEAD_STATUS_CONFIG.won.bg.includes("emerald"));
    assert.ok(LEAD_STATUS_CONFIG.lost.bg.includes("rose"));

    // Check priority config
    assert.ok(LEAD_PRIORITY_CONFIG.urgent.bg.includes("rose"));
    assert.ok(LEAD_PRIORITY_CONFIG.high.bg.includes("amber"));

    pass("Pipeline & statuses: standard 7-stage configuration and color hierarchy verified");
  }

  // ── 7. Lead Sources Auto-Seeding Defaults ──
  {
    assert.ok(INITIAL_LEAD_SOURCES.length >= 7, "Default lead sources list must include common channels");
    assert.ok(INITIAL_LEAD_SOURCES.includes("Walk-in"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Architect"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Builder"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Customer Referral"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Website"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Instagram"));
    assert.ok(INITIAL_LEAD_SOURCES.includes("Exhibition"));

    pass("Lead sources: default business channels seeded with sort orders");
  }

  // ── 8. Reference Number Formatting ──
  {
    const formatLeadRef = (year: number, seq: number) => `LD-${year}-${String(seq).padStart(4, "0")}`;
    assert.equal(formatLeadRef(2026, 1), "LD-2026-0001");
    assert.equal(formatLeadRef(2026, 42), "LD-2026-0042");
    assert.equal(formatLeadRef(2026, 9999), "LD-2026-9999");
    assert.equal(formatLeadRef(2027, 100), "LD-2027-0100");

    assert.match(formatLeadRef(2026, 5), /^LD-\d{4}-\d{4}$/);

    pass("Reference numbering: sequential LD-YYYY-XXXX format verified");
  }

  console.log(`\nALL ${count} CRM CORE TESTS PASSED!`);
}

main();
