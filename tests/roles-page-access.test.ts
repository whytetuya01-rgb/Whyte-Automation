/**
 * Table test for `getRolesPageAccess` — what the Roles & Permissions page
 * shows each kind of signed-in user. The HTTP suite
 * (phase1-roles-authz.test.mjs) separately proves these UI gates agree with
 * what the API actually enforces.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/roles-page-access.test.ts
 */
import assert from "node:assert/strict";
import { getRolesPageAccess } from "@/lib/rolesPageAccess";

const cases: Array<{ name: string; role: string | undefined; perms: string[] | undefined; canRead: boolean; canManage: boolean }> = [
  { name: "super_admin: can read and manage global roles", role: "super_admin", perms: [], canRead: true, canManage: true },
  { name: "company_owner alias for admin: no global role management", role: "company_owner", perms: [], canRead: false, canManage: false },
  { name: "canonical admin: no global role management", role: "admin", perms: [], canRead: false, canManage: false },
  { name: "configurable_admin WITH admins:read: can view, cannot manage", role: "configurable_admin", perms: ["admins:read"], canRead: true, canManage: false },
  { name: "configurable_admin WITHOUT admins:read: no access", role: "configurable_admin", perms: ["catalog:read"], canRead: false, canManage: false },
  { name: "configurable_admin holding admins:manage in its list is NOT a manager (platform-exclusive, API refuses it)", role: "configurable_admin", perms: ["admins:manage"], canRead: false, canManage: false },
  { name: "sales_executive: no access", role: "sales_executive", perms: [], canRead: false, canManage: false },
  { name: "dealer: no access", role: "dealer", perms: [], canRead: false, canManage: false },
  { name: "dealer cannot gain access through a permissions list (the API ignores it for non-configurable roles)", role: "dealer", perms: ["admins:read"], canRead: false, canManage: false },
  { name: "unknown role: no access", role: "sales", perms: [], canRead: false, canManage: false },
  { name: "missing role: no access", role: undefined, perms: undefined, canRead: false, canManage: false },
];

let passed = 0;
for (const c of cases) {
  const access = getRolesPageAccess(c.role, c.perms);
  assert.equal(access.canRead, c.canRead, `${c.name}: canRead`);
  assert.equal(access.canManage, c.canManage, `${c.name}: canManage`);
  assert.equal(access.needsCompanySelection, false, `${c.name}: has a company context by default`);
  passed += 1;
  console.log(`  ✓ ${c.name}`);
}

console.log(`\nRoles page access PASSED (${passed} checks).`);
