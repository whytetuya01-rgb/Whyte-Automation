/**
 * Role-management authorization, over real HTTP against an isolated
 * production server + throwaway Mongo. Covers:
 *
 *   - Platform level (Super Admin): sees only company-less system templates
 *     until it explicitly "acts as" a company; cannot write roles without one.
 *   - Company level (Company Owner): manages ITS OWN company's roles only.
 *   - Company Admin / configurable_admin / dealer, with and without the
 *     `admins:read` permission: read-only at most, never write.
 *   - Two companies: nothing one company does is visible to or alters the other.
 *   - Platform-exclusive capabilities stay out of a Company Owner's reach.
 *   - The Roles page's UI gate (`getRolesPageAccess`) never disagrees with
 *     what the API actually enforces.
 *
 *   node tests/phase1-roles-authz.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const { getRolesPageAccess } = await import("../src/lib/rolesPageAccess.ts");

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "owner_b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 5, email: "admin_b@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 6, email: "cfg_read_a@example.com", role: "configurable_admin", name: "Cfg Read A", companyId: 10, permissions: ["admins:read"] },
    { _id: 7, email: "cfg_noread_a@example.com", role: "configurable_admin", name: "Cfg NoRead A", companyId: 10, permissions: ["catalog:read"] },
    { _id: 8, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
  ];
  server = await startIsolatedServer("ph1-roles-authz", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();

  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null,
      createdAt: now, updatedAt: now,
    }))
  );

  async function apiWithSetCookieCapture(cookie, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, newCookiePairs: setCookies.map((c) => c.split(";")[0]) };
  }

  const cookies = {
    super: await login("super@example.com", "admin"),
    ownerA: await login("owner_a@example.com", "admin"),
    ownerB: await login("owner_b@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    adminB: await login("admin_b@example.com", "admin"),
    cfgReadA: await login("cfg_read_a@example.com", "admin"),
    cfgNoReadA: await login("cfg_noread_a@example.com", "admin"),
    dealerA: await login("dealer_a@example.com", "user"),
  };

  const roleDocs = (companyId) => db.collection("roledefinitions").find({ companyId }).toArray();
  const roleKeysOf = (res) => res.data.roles.map((r) => r.key);

  // Every write endpoint, as a list of [method, path, body] — used to prove a
  // non-manager is refused on ALL of them, and that nothing was written.
  const writeAttempts = [
    ["POST", "/api/admin/roles", { key: "sneaky_role", name: "Sneaky Role", permissions: ["catalog:read"] }],
    ["PATCH", "/api/admin/roles/admin", { permissions: ["catalog:read"] }],
    ["DELETE", "/api/admin/roles/some_custom", undefined],
    ["POST", "/api/admin/roles/admin/reset", {}],
  ];

  // ═══ 1. Unauthenticated: everything is refused ═══
  assert.equal((await api("", "GET", "/api/admin/roles")).status, 401);
  for (const [m, p, b] of writeAttempts) assert.equal((await api("", m, p, b)).status, 401, `${m} ${p} unauthenticated`);
  pass("unauthenticated requests are refused (401) on every role endpoint");

  // ═══ 2. Baseline read matrix, before any customization ═══
  const baselineRead = {
    super: 200, ownerA: 200, ownerB: 200, adminA: 200, adminB: 200, cfgReadA: 403, cfgNoReadA: 403, dealerA: 403,
  };
  for (const [who, expected] of Object.entries(baselineRead)) {
    const res = await api(cookies[who], "GET", "/api/admin/roles");
    assert.equal(res.status, expected, `${who}: GET /api/admin/roles`);
  }
  pass("read access: super, owners and admins can list roles; every configurable_admin (with or without admins:read) and a dealer cannot (403)");

  // ═══ 3. Non-managers can never write — all four endpoints, nothing persisted ═══
  for (const who of ["adminA", "adminB", "cfgReadA", "cfgNoReadA", "dealerA"]) {
    for (const [m, p, b] of writeAttempts) {
      const res = await api(cookies[who], m, p, b);
      assert.equal(res.status, 403, `${who}: ${m} ${p} must be refused`);
    }
  }
  assert.equal((await roleDocs(10)).length, 0, "no role rows may exist for company 10 after refused writes");
  assert.equal((await roleDocs(20)).length, 0, "no role rows may exist for company 20 after refused writes");
  pass("company Admins, configurable_admins and dealers are refused (403) on create, customize, delete and reset — and nothing was written");

  // ═══ 4. Platform level: Super Admin without act-as has no company, so no company roles ═══
  const superBare = await api(cookies.super, "GET", "/api/admin/roles");
  assert.ok(superBare.data.roles.every((r) => r.userCount === 0), "no company context => no company accounts are counted");
  for (const [m, p, b] of writeAttempts) {
    assert.equal((await api(cookies.super, m, p, b)).status, 403, `super (no act-as): ${m} ${p}`);
  }
  assert.equal((await roleDocs(10)).length + (await roleDocs(20)).length, 0);
  pass("Super Admin with no company selected sees system templates only (zero accounts) and cannot write any role");

  // Policy (route doc comments + rolesPageAccess): role DEFINITIONS are platform-level. Only a Super Admin
  // (acting as a company) may create / customize / delete / reset them. Company owners and admins get a
  // read-only, metadata-only list (to populate account assignment) and never see the permission matrix.
  const actAsCompany = async (companyId) => {
    const r = await apiWithSetCookieCapture(cookies.super, "POST", "/api/platform/act-as", { companyId, reason: "roles authz test" });
    assert.equal(r.status, 200);
    return [cookies.super, ...r.newCookiePairs].join("; ");
  };

  // ═══ 5. Company owners cannot write role definitions, on any endpoint ═══
  for (const who of ["ownerA", "ownerB"]) {
    for (const [m, p, b] of writeAttempts) {
      assert.equal((await api(cookies[who], m, p, b)).status, 403, `${who}: ${m} ${p} must be refused`);
    }
    for (const reserved of ["admin", "company_owner", "super_admin", "dealer", "configurable_admin"]) {
      assert.equal((await api(cookies[who], "POST", "/api/admin/roles", { key: reserved, name: "Reserved Attempt", permissions: [] })).status, 403, `${who} creating '${reserved}'`);
    }
    assert.equal((await api(cookies[who], "PATCH", "/api/admin/roles/dealer", { permissions: ["admins:manage", "activity:view", "spaces:hard_delete", "catalog:read"] })).status, 403);
  }
  assert.equal((await roleDocs(10)).length + (await roleDocs(20)).length, 0, "nothing was written by any refused owner request");
  pass("Company Owners are refused (403) on every role-definition write, including reserved keys and platform-exclusive permissions; nothing is written");

  // ═══ 6. Reads: owners and admins get metadata only; the permission matrix is Super Admin-only ═══
  const ownerRead = await api(cookies.ownerA, "GET", "/api/admin/roles");
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.data.modules, undefined, "permission modules are not exposed to a company owner");
  assert.equal(ownerRead.data.presets, undefined, "permission presets are not exposed to a company owner");
  const superRead = await api(cookies.super, "GET", "/api/admin/roles");
  assert.ok(Array.isArray(superRead.data.modules) && superRead.data.presets, "Super Admin gets the matrix");
  pass("owners/admins can list role metadata only; modules and presets are exposed to Super Admin alone");

  // ═══ 7. Super Admin acting as company A manages A's roles; B never sees them ═══
  let superA = await actAsCompany(10);
  const adminDefaults = (await api(superA, "GET", "/api/admin/roles")).data.roles.find((r) => r.key === "admin").permissions;
  assert.ok(adminDefaults.includes("quotations:delete"));
  const reduced = adminDefaults.filter((p) => p !== "quotations:delete");
  assert.equal((await api(superA, "PATCH", "/api/admin/roles/admin", { permissions: reduced })).status, 200);
  assert.equal((await api(superA, "POST", "/api/admin/roles", { key: "a_custom", name: "A Custom", permissions: ["catalog:read"] })).status, 201);
  const aView = await api(cookies.ownerA, "GET", "/api/admin/roles");
  assert.equal(aView.data.roles.find((r) => r.key === "admin").isCustomized, true);
  assert.ok(roleKeysOf(aView).includes("a_custom"));
  assert.ok(aView.data.roles.find((r) => r.key === "admin").userCount >= 1, "owner A sees company A's own accounts counted");
  const bView = await api(cookies.ownerB, "GET", "/api/admin/roles");
  assert.equal(bView.data.roles.find((r) => r.key === "admin").isCustomized, false, "B's admin role must still be the default");
  assert.deepEqual([...bView.data.roles.find((r) => r.key === "admin").permissions].sort(), [...adminDefaults].sort());
  assert.ok(!roleKeysOf(bView).includes("a_custom"));
  assert.ok(!roleKeysOf(await api(cookies.adminB, "GET", "/api/admin/roles")).includes("a_custom"));
  assert.equal((await roleDocs(10)).find((d) => d.key === "a_custom")?.companyId, 10);
  assert.equal((await roleDocs(20)).length, 0);
  pass("Super Admin acting as company A can customize/create roles stamped to A only; company B sees none of it");

  // ═══ 8. Company B's owner cannot reach A's roles by key; acting as B cannot either ═══
  const a1 = (await roleDocs(10)).find((d) => d.key === "a_custom");
  await api(cookies.ownerB, "DELETE", "/api/admin/roles/a_custom");
  await api(cookies.ownerB, "PATCH", "/api/admin/roles/a_custom", { permissions: ["catalog:read", "dealers:manage"] });
  const superB = await actAsCompany(20);
  assert.equal((await api(superB, "DELETE", "/api/admin/roles/a_custom")).status >= 400, true, "acting as B, A's custom role does not exist");
  assert.equal((await api(superB, "PATCH", "/api/admin/roles/a_custom", { permissions: ["dealers:manage"] })).status >= 400, true);
  const a2 = (await roleDocs(10)).find((d) => d.key === "a_custom");
  assert.ok(a2, "A's custom role survives");
  assert.deepEqual(a2.permissions, a1.permissions);
  assert.deepEqual([...(await roleDocs(10)).find((d) => d.key === "admin").permissions].sort(), [...reduced].sort());
  pass("company B's owner (403) and a Super Admin acting as B (not found) cannot delete or modify company A's roles");

  // (starting a new act-as session closes the previous one: one live grant per Super Admin)
  superA = await actAsCompany(10);

  // ═══ 9. Protected roles stay immutable, reserved keys stay reserved, platform-exclusive permissions never granted ═══
  assert.equal((await api(superA, "PATCH", "/api/admin/roles/company_owner", { permissions: ["catalog:read"] })).status, 403);
  assert.equal((await api(superA, "PATCH", "/api/admin/roles/super_admin", { permissions: ["catalog:read"] })).status, 403);
  assert.ok((await api(superA, "PATCH", "/api/admin/roles/configurable_admin", { permissions: [] })).status >= 400);
  for (const reserved of ["admin", "company_owner", "super_admin", "dealer", "configurable_admin"]) {
    const res = await api(superA, "POST", "/api/admin/roles", { key: reserved, name: "Reserved Attempt", permissions: [] });
    assert.ok(res.status >= 400, `creating reserved key '${reserved}' must fail, got ${res.status}`);
  }
  assert.equal((await api(superA, "PATCH", "/api/admin/roles/dealer", { permissions: ["admins:manage", "activity:view", "spaces:hard_delete", "catalog:read"] })).status, 200);
  const dealerPerms = (await api(superA, "GET", "/api/admin/roles")).data.roles.find((r) => r.key === "dealer").permissions;
  assert.deepEqual(dealerPerms, ["catalog:read"], "platform-exclusive permissions are stripped even for a Super Admin");
  pass("company_owner/super_admin/configurable_admin stay immutable, reserved keys cannot be created, platform-exclusive permissions are stripped");

  // ═══ 10. Reset + delete (Super Admin only) ═══
  assert.equal((await api(cookies.ownerA, "POST", "/api/admin/roles/admin/reset", {})).status, 403);
  assert.equal((await api(cookies.ownerA, "DELETE", "/api/admin/roles/a_custom")).status, 403);
  assert.ok((await roleDocs(10)).some((d) => d.key === "a_custom"), "owner's refused delete left the role");
  assert.equal((await api(superA, "POST", "/api/admin/roles/dealer/reset", {})).status, 200);
  assert.equal((await api(superA, "POST", "/api/admin/roles/admin/reset", {})).status, 200);
  assert.equal((await roleDocs(10)).some((d) => d.key === "admin" || d.key === "dealer"), false, "reset removes the company's override rows");
  assert.ok((await api(superA, "POST", "/api/admin/roles/a_custom/reset", {})).status >= 400, "custom roles cannot be 'reset'");
  assert.equal((await api(superA, "DELETE", "/api/admin/roles/a_custom")).status, 200);
  assert.equal((await roleDocs(10)).some((d) => d.key === "a_custom"), false);
  pass("only a Super Admin can reset system roles or delete custom roles; custom roles cannot be 'reset'");

  // ═══ 11. Company admin read access no longer depends on the company's admins:read policy, and never grants writes ═══
  const superB2 = await actAsCompany(20);
  assert.equal((await api(superB2, "PATCH", "/api/admin/roles/admin", { permissions: adminDefaults.filter((p) => p !== "admins:read") })).status, 200);
  assert.equal((await api(cookies.adminB, "GET", "/api/admin/roles")).status, 200, "company admins always get the read-only metadata list");
  assert.equal((await api(cookies.adminB, "PATCH", "/api/admin/roles/admin", { permissions: adminDefaults })).status, 403, "and can never edit the role");
  assert.equal((await api(cookies.cfgReadA, "GET", "/api/admin/roles")).status, 403, "a configurable_admin is refused even WITH admins:read");
  pass("company Admins read metadata only and can never edit their own role; configurable_admins are refused even with admins:read");

  // ═══ 12. Platform-exclusive capabilities remain out of a Company Owner's reach ═══
  assert.equal((await api(cookies.ownerA, "POST", "/api/platform/act-as", { companyId: 20, reason: "trying to cross over" })).status, 403, "owner cannot act as another company");
  assert.equal((await api(cookies.ownerA, "POST", "/api/admin/users", { firstName: "X", lastName: "Y", email: "x@example.com", password: "Password123!", role: "super_admin" })).status, 403);
  assert.equal((await api(cookies.ownerA, "GET", "/api/admin/activity")).status, 403);
  pass("a Company Owner cannot act as another company, create super_admin accounts, or read the platform activity log");

  // ═══ 13. The page's UI gate never over-promises writes ═══
  // WRITE: UI hides controls => API refuses. (READ is intentionally asymmetric: owners/admins are served a
  // metadata-only list for account assignment even though the Roles page itself is hidden from them.)
  const uiRoleOf = { super: "super_admin", ownerA: "company_owner", ownerB: "company_owner", adminA: "admin", adminB: "admin", cfgReadA: "configurable_admin", cfgNoReadA: "configurable_admin", dealerA: "dealer" };
  const uiPermsOf = { cfgReadA: ["admins:read"], cfgNoReadA: ["catalog:read"] };
  for (const who of Object.keys(cookies)) {
    const ui = getRolesPageAccess(uiRoleOf[who], uiPermsOf[who] ?? []);
    const write = (await api(cookies[who], "POST", "/api/admin/roles/dealer/reset", {})).status;
    assert.notEqual(write, 200, `${who}: reset without a company context must not succeed`);
    if (!ui.canManage) assert.equal(write, 403, `${who}: page hides the controls but the API would accept writes`);
  }
  for (const who of ["ownerA", "adminA", "cfgReadA", "cfgNoReadA", "dealerA"]) {
    assert.equal(getRolesPageAccess(uiRoleOf[who], uiPermsOf[who] ?? []).canManage, false, `${who} gets no management controls`);
  }
  assert.equal(getRolesPageAccess("super_admin", []).canManage, true);
  await api(superB2, "DELETE", "/api/platform/act-as");
  pass("the Roles page never offers write controls the API would refuse; only Super Admin gets them");

  console.log(`\nRole-management authorization PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
