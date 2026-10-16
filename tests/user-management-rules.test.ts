/**
 * Table tests for the pure rules the Users/Roles pages and the sidebar share
 * with the API: who may assign which role, who may modify which account,
 * what each page shows with and without a company context, and which sidebar
 * links each role sees. The HTTP suite (phase1-user-role-management.test.mjs)
 * proves these agree with what the API actually enforces.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/user-management-rules.test.ts
 */
import assert from "node:assert/strict";
import { canAssignRole, canModifyAccountWithRole, isUserManager } from "@/lib/userManagementRules";
import { getRolesPageAccess, getUsersPageAccess } from "@/lib/rolesPageAccess";
import { canSeeAdminNavItem } from "@/lib/adminNav";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

const ctx = (role: string, hasCompanyContext = true) => ({ role, hasCompanyContext });
const custom = ["catalog_editor"];

check("only super_admin, company_owner and admin manage company accounts", () => {
  assert.equal(isUserManager("super_admin"), true);
  assert.equal(isUserManager("company_owner"), true);
  assert.equal(isUserManager("admin"), true);
  for (const r of ["sales_executive", "configurable_admin", "dealer", "sales", "", undefined, null]) assert.equal(isUserManager(r), false, String(r));
});

check("company_owner and admin can assign configurable_admin, sales_executive and its own custom roles", () => {
  for (const actorRole of ["company_owner", "admin"]) {
    for (const key of ["configurable_admin", "sales_executive", "catalog_editor", "CATALOG_EDITOR"]) {
      assert.equal(canAssignRole(ctx(actorRole), key, custom), true, `${actorRole} assigning ${key}`);
    }
  }
});

check("company_owner and admin can NEVER assign admin (create or promote), super_admin, company_owner, dealer, sales, or an unknown role", () => {
  for (const actorRole of ["company_owner", "admin", " ADMIN ", "Company_Owner"]) {
    for (const key of ["admin", "Admin", " admin ", "ADMIN", "super_admin", "company_owner", "dealer", "sales", "not_a_role", "Super_Admin"]) {
      assert.equal(canAssignRole(ctx(actorRole), key, custom), false, `${actorRole} assigning ${key}`);
    }
  }
});

check("company_owner cannot assign a custom role that belongs to another company (not in its own list)", () => {
  assert.equal(canAssignRole(ctx("company_owner"), "other_company_role", custom), false);
});

check("super_admin with a company can assign any role except dealer/sales", () => {
  for (const key of ["admin", "configurable_admin", "company_owner", "super_admin", "catalog_editor"]) {
    assert.equal(canAssignRole(ctx("super_admin"), key, []), true, key);
  }
  for (const key of ["dealer", "sales"]) assert.equal(canAssignRole(ctx("super_admin"), key, []), false, key);
});

check("super_admin with NO company can only create another super_admin", () => {
  assert.equal(canAssignRole(ctx("super_admin", false), "super_admin", []), true);
  for (const key of ["admin", "configurable_admin", "company_owner", "catalog_editor"]) {
    assert.equal(canAssignRole(ctx("super_admin", false), key, custom), false, key);
  }
});

check("non-managers can assign nothing", () => {
  for (const r of ["sales_executive", "configurable_admin", "dealer", "sales"]) assert.equal(canAssignRole(ctx(r), "admin", custom), false, r);
});

check("company_owner and admin can modify sales_executive/configurable_admin/custom accounts, never admin, company_owner or super_admin", () => {
  for (const actorRole of ["company_owner", "admin"]) {
    for (const t of ["sales_executive", "configurable_admin", "catalog_editor"]) assert.equal(canModifyAccountWithRole(ctx(actorRole), t), true, `${actorRole} modifying ${t}`);
    for (const t of ["admin", "company_owner", "super_admin"]) assert.equal(canModifyAccountWithRole(ctx(actorRole), t), false, `${actorRole} modifying ${t}`);
  }
});

check("super_admin can modify company accounts only inside a company context", () => {
  assert.equal(canModifyAccountWithRole(ctx("super_admin"), "admin"), true);
  assert.equal(canModifyAccountWithRole(ctx("super_admin", false), "admin"), false);
});

check("page access: super_admin can manage global roles, but company_owner and admin cannot", () => {
  assert.deepEqual(getRolesPageAccess("super_admin", [], true), { canRead: true, canManage: true, needsCompanySelection: false });
  assert.deepEqual(getRolesPageAccess("company_owner", [], true), { canRead: false, canManage: false, needsCompanySelection: false });
  assert.deepEqual(getRolesPageAccess("admin", [], true), { canRead: false, canManage: false, needsCompanySelection: false });
});

check("page access: Users page offers management controls to managers (super_admin, company_owner, admin)", () => {
  assert.deepEqual(getUsersPageAccess("super_admin", [], false), { canRead: true, canManage: false, needsCompanySelection: true });
  assert.deepEqual(getUsersPageAccess("super_admin", [], true), { canRead: true, canManage: true, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("company_owner", [], true), { canRead: true, canManage: true, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("admin", [], true), { canRead: true, canManage: true, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("configurable_admin", ["admins:read"], true), { canRead: true, canManage: false, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("configurable_admin", ["catalog:read"], true), { canRead: false, canManage: false, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("sales_executive", [], true), { canRead: false, canManage: false, needsCompanySelection: false });
  assert.deepEqual(getUsersPageAccess("dealer", [], true), { canRead: false, canManage: false, needsCompanySelection: false });
});

check("sidebar: Roles and Activity Log to super_admin only; Users visible to super_admin, company_owner, and admin", () => {
  const expectVisible: Record<string, Record<string, boolean>> = {
    "/admin/roles": { super_admin: true, company_owner: false, admin: false, configurable_admin: false },
    "/admin/users": { super_admin: true, company_owner: true, admin: true, configurable_admin: false },
    "/admin/activity": { super_admin: true, company_owner: false, admin: false, configurable_admin: false },
  };
  for (const [href, byRole] of Object.entries(expectVisible)) {
    for (const [role, visible] of Object.entries(byRole)) assert.equal(canSeeAdminNavItem(href, role), visible, `${href} for ${role}`);
  }
});

check("sidebar: unrestricted links stay visible to every admin-panel role", () => {
  for (const role of ["super_admin", "company_owner", "admin", "configurable_admin"]) {
    for (const href of ["/admin/dashboard", "/admin/products", "/admin/quotations", "/admin/company"]) {
      assert.equal(canSeeAdminNavItem(href, role), true, `${href} for ${role}`);
    }
  }
});

console.log(`\nUser-management rules PASSED (${passed} checks).`);
