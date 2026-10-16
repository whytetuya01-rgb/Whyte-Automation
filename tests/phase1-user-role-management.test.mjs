/**
 * Company-scoped user and role management, over real HTTP against an isolated
 * production server + throwaway Mongo.
 *
 *   Phase B  Company Owner manages ITS OWN company's accounts (never another
 *            company's, never super_admin/company_owner roles, never
 *            platform-exclusive permissions); client-supplied companyId is
 *            rejected; Super Admin keeps its capabilities inside a company.
 *   Phase C  PATCH /api/admin/roles/[key] no longer upserts unknown keys;
 *            creation validation, duplicates and cross-company keys.
 *   Phase D  A Super Admin with no company selected cannot write
 *            company-specific data and is told why; GET /api/platform/act-as.
 *   Sidebar  What each role SEES never promises something the API refuses, and
 *            platform-wide links stay super_admin-only.
 *
 *   node tests/phase1-user-role-management.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const { canSeeAdminNavItem } = await import("../src/lib/adminNav.ts");
const { getUsersPageAccess } = await import("../src/lib/rolesPageAccess.ts");
const { canAssignRole } = await import("../src/lib/userManagementRules.ts");

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
    { _id: 9, email: "target_a@example.com", role: "sales_executive", name: "Target A", companyId: 10 },
    { _id: 10, email: "target_b@example.com", role: "sales_executive", name: "Target B", companyId: 20 },
    { _id: 11, email: "owner_a2@example.com", role: "company_owner", name: "Owner A2", companyId: 10 },
  ];
  server = await startIsolatedServer("ph1-user-role-mgmt", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();

  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null,
      createdAt: now, updatedAt: now,
    }))
  );
  // Production already has this counter. Seeding it here keeps id allocation
  // independent of which company's (scoped) max-id check runs first.
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 11 });

  async function apiWithSetCookieCapture(cookie, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, newCookiePairs: setCookies.map((c) => c.split(";")[0]) };
  }

  const c = {
    super: await login("super@example.com", "admin"),
    ownerA: await login("owner_a@example.com", "admin"),
    ownerB: await login("owner_b@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    adminB: await login("admin_b@example.com", "admin"),
    cfgReadA: await login("cfg_read_a@example.com", "admin"),
    cfgNoReadA: await login("cfg_noread_a@example.com", "admin"),
    dealerA: await login("dealer_a@example.com", "user"),
  };

  const userDoc = (email) => db.collection("adminusers").findOne({ email });
  const userById = (id) => db.collection("adminusers").findOne({ _id: id });
  const roleRow = (companyId, key) => db.collection("roledefinitions").findOne({ companyId, key });
  const newUser = (email, extra = {}) => ({ firstName: "New", lastName: "User", email, password: "Password123!", role: "sales_executive", ...extra });

  // ───────────────────────── Phase D: company context endpoint ─────────────────────────
  assert.equal((await api("", "GET", "/api/platform/act-as")).status, 401);
  assert.equal((await api(c.ownerA, "GET", "/api/platform/act-as")).status, 403, "only a Super Admin may query act-as state");
  const noCtx = await api(c.super, "GET", "/api/platform/act-as");
  assert.equal(noCtx.status, 200);
  assert.equal(noCtx.data.actingAsCompany, false);
  pass("GET /api/platform/act-as: Super Admin only; reports no company until one is selected");

  // ───────────────────────── Phase C: roles ─────────────────────────
  // Policy: role DEFINITIONS are managed by a Super Admin acting as the company. Owners/admins cannot write them.
  // Starting an act-as session closes the previous one (one live grant), so each helper call mints a fresh cookie.
  const actAsFresh = async (companyId) => {
    const r = await apiWithSetCookieCapture(c.super, "POST", "/api/platform/act-as", { companyId, reason: "user/role management test" });
    assert.equal(r.status, 200);
    return [c.super, ...r.newCookiePairs].join("; ");
  };
  const patchRoleAs = (cookie, key, body = { permissions: ["catalog:read"] }) => api(cookie, "PATCH", `/api/admin/roles/${encodeURIComponent(key)}`, body);
  const patchRole = (who, key, body = { permissions: ["catalog:read"] }) => patchRoleAs(c[who], key, body);

  let sa = await actAsFresh(10);
  assert.equal((await patchRoleAs(sa, "ghost_role")).status, 404, "unknown key must be 404, not silently created");
  assert.equal(await roleRow(10, "ghost_role"), null);
  assert.equal(await roleRow(20, "ghost_role"), null);
  for (const bad of ["x", "bad key!", "a".repeat(51), "bad.key", "UPPER CASE"]) {
    assert.equal((await patchRoleAs(sa, bad)).status, 400, `malformed key '${bad}' must be 400`);
  }
  assert.equal(await db.collection("roledefinitions").countDocuments({}), 0, "no malformed/unknown PATCH may write anything");
  pass("PATCH of an unknown role key (Super Admin acting as a company) returns 404 and writes nothing; malformed keys return 400");

  for (const who of ["ownerA", "adminA", "cfgReadA", "cfgNoReadA", "dealerA"]) {
    assert.equal((await patchRole(who, "ghost_role")).status, 403, `${who} is refused before the key is even looked up`);
    assert.equal((await patchRole(who, "admin")).status, 403, `${who} cannot customize a real role either`);
  }
  assert.equal((await api("", "PATCH", "/api/admin/roles/ghost_role", { permissions: [] })).status, 401);
  assert.equal(await db.collection("roledefinitions").countDocuments({}), 0);
  pass("owners, admins, configurable_admins and dealers get 403 (anonymous 401) on role PATCH, never a 404 that reveals which keys exist");

  // creation validation (Super Admin acting as company A)
  const post = (body) => api(sa, "POST", "/api/admin/roles", body);
  assert.equal((await post({ key: "no_name", permissions: [] })).status, 400, "missing name");
  assert.equal((await post({ key: "short_name", name: "x", permissions: [] })).status, 400, "1-char name");
  assert.equal((await post({ key: "Bad Key", name: "Bad Key", permissions: [] })).status, 400, "malformed key");
  assert.equal((await post({ key: "x", name: "Too Short Key", permissions: [] })).status, 400, "key too short");
  for (const reserved of ["admin", "company_owner", "super_admin", "dealer", "configurable_admin", "sales"]) {
    assert.equal((await post({ key: reserved, name: "Reserved", permissions: [] })).status, 400, `reserved key '${reserved}'`);
  }
  assert.equal((await post({ key: "bad_perm", name: "Bad Perm", permissions: ["not:a:permission"] })).status, 400, "unknown permission");
  assert.equal((await post({ key: "excl_perm", name: "Excl Perm", permissions: ["admins:manage"] })).status, 400, "platform-exclusive permission");
  assert.equal(await db.collection("roledefinitions").countDocuments({}), 0, "rejected creations write nothing");
  assert.equal((await post({ key: "a_custom", name: "A Custom", permissions: ["catalog:read"] })).status, 201);
  assert.equal((await post({ key: "a_custom", name: "Duplicate", permissions: [] })).status, 409, "duplicate key within the company");
  assert.equal((await roleRow(10, "a_custom")).companyId, 10);
  for (const who of ["ownerA", "adminA", "cfgReadA"]) {
    assert.equal((await api(c[who], "POST", "/api/admin/roles", { key: `by_${who}`.toLowerCase(), name: "Nope Nope", permissions: [] })).status, 403, `${who} cannot create roles`);
  }
  pass("role creation enforces name, key format, reserved keys, permission validity and uniqueness; direct API calls by non-Super-Admins are 403");

  // cross-company
  const before = await roleRow(10, "a_custom");
  const sb = await actAsFresh(20);
  assert.equal((await patchRoleAs(sb, "a_custom", { permissions: ["catalog:read", "dealers:manage"] })).status, 404, "acting as B cannot PATCH A's custom role");
  assert.equal((await api(sb, "DELETE", "/api/admin/roles/a_custom")).status, 404, "acting as B cannot DELETE A's custom role");
  assert.equal((await patchRole("ownerB", "a_custom", { permissions: ["dealers:manage"] })).status, 403, "B's owner is refused outright");
  assert.deepEqual((await roleRow(10, "a_custom")).permissions, before.permissions, "A's role untouched");
  assert.equal(await roleRow(20, "a_custom"), null, "and B did not get a copy of it");
  // B may create its OWN role with the same key — keys are unique per company
  assert.equal((await api(sb, "POST", "/api/admin/roles", { key: "a_custom", name: "B's Own", permissions: [] })).status, 201);
  assert.equal((await roleRow(20, "a_custom")).name, "B's Own");
  assert.equal((await roleRow(10, "a_custom")).name, "A Custom");
  pass("cross-company role PATCH/DELETE return 404 (or 403 for an owner) and change nothing; the same key can exist independently per company");

  // legit updates still work (Super Admin acting as A)
  sa = await actAsFresh(10);
  assert.equal((await patchRoleAs(sa, "a_custom", { permissions: ["catalog:read", "catalog:edit"] })).status, 200);
  assert.deepEqual([...(await roleRow(10, "a_custom")).permissions].sort(), ["catalog:edit", "catalog:read"]);
  assert.equal((await patchRoleAs(sa, "admin", { permissions: ["catalog:read"] })).status, 200, "first customization of a system role still creates the company's override");
  assert.equal((await roleRow(10, "admin")).isSystem, true);
  assert.equal((await patchRoleAs(sa, "company_owner")).status, 403);
  assert.equal((await patchRoleAs(sa, "super_admin")).status, 403);
  assert.equal((await patchRoleAs(sa, "configurable_admin", { permissions: [] })).status, 400);
  assert.equal((await api(sa, "DELETE", "/api/admin/roles/admin")).status, 403, "system roles cannot be deleted");
  assert.equal((await api(sa, "DELETE", "/api/admin/roles/never_existed")).status, 404);
  assert.equal((await api(sa, "POST", "/api/admin/roles/a_custom/reset", {})).status, 400);
  pass("existing company roles still update; system-role override still created on first save; protected roles stay protected; delete of unknown key is 404");
  // Undo the admin-role restriction so later account/sidebar checks run against the default admin policy.
  assert.equal((await api(sa, "POST", "/api/admin/roles/admin/reset", {})).status, 200);

  // ───────────────────────── Phase B: users ─────────────────────────
  const postUser = (who, body) => api(c[who], "POST", "/api/admin/users", body);
  const patchUser = (who, id, body) => api(c[who], "PATCH", `/api/admin/users/${id}`, body);

  const madeAdmin = await postUser("ownerA", newUser("made_admin@example.com"));
  assert.equal(madeAdmin.status, 201);
  assert.equal((await userDoc("made_admin@example.com")).companyId, 10, "stamped from the owner's session company");
  assert.equal((await userDoc("made_admin@example.com")).role, "sales_executive");

  const madeCfg = await postUser("ownerA", newUser("made_cfg@example.com", { role: "configurable_admin", permissions: ["catalog:read"] }));
  assert.equal(madeCfg.status, 201);
  assert.deepEqual((await userDoc("made_cfg@example.com")).permissions, ["catalog:read"]);

  const madeCustom = await postUser("ownerA", newUser("made_custom@example.com", { role: "a_custom" }));
  assert.equal(madeCustom.status, 201, "a company's own custom role may be assigned");
  assert.equal((await userDoc("made_custom@example.com")).companyId, 10);
  pass("Company Owner creates sales_executive, configurable_admin and custom-role accounts, always stamped with its own company");

  // client-supplied companyId is never honored
  assert.equal((await postUser("ownerA", newUser("sneaky_company@example.com", { companyId: 20 }))).status, 400);
  assert.equal(await userDoc("sneaky_company@example.com"), null);
  assert.equal((await patchUser("ownerA", 9, { companyId: 20 })).status, 400);
  assert.equal((await userById(9)).companyId, 10);
  pass("a client-supplied companyId is rejected on create and update (company comes only from the session)");

  // Only a Super Admin may create or promote to company `admin` (every case variant, every route).
  for (const who of ["ownerA", "adminA"]) {
    for (const role of ["admin", "Admin", " ADMIN "]) {
      const email = `blocked_${who}_${role.trim().toLowerCase()}_${role.length}@example.com`;
      assert.equal((await postUser(who, newUser(email, { role }))).status, 403, `${who} creating '${role}'`);
      assert.equal(await userDoc(email), null, "no account may be created by the refused request");
    }
  }
  // promotion of an existing non-admin account (configurable_admin / sales_executive / custom) to admin
  for (const who of ["ownerA"]) {
    for (const target of [madeCfg.json.data._id ?? (await userDoc("made_cfg@example.com"))._id, (await userDoc("made_custom@example.com"))._id, (await userDoc("made_admin@example.com"))._id, 6]) {
      const before = (await userById(target)).role;
      for (const role of ["admin", "ADMIN"]) {
        assert.equal((await patchUser(who, target, { role })).status, 403, `${who} promoting ${target} to ${role}`);
      }
      assert.equal((await userById(target)).role, before, "role unchanged after refused promotion");
    }
  }
  // dealers cannot be promoted by PATCH at all (dealer accounts are invisible to the admin-user route)
  assert.equal((await patchUser("ownerA", 8, { role: "admin" })).status, 404, "dealer promotion via the user route");
  assert.equal((await userById(8)).role, "dealer");
  // a company Admin cannot touch (or demote/replace) another admin, and cannot reach admin creation through the manager gate
  assert.equal((await patchUser("adminA", 4, { role: "admin" })).status, 403);
  assert.equal((await patchUser("adminA", 9, { role: "admin" })).status, 403);
  assert.equal((await userById(4)).role, "admin");
  // extra fields that hint at admin rights are ignored: the stored role is exactly the validated one
  const smuggled = await postUser("ownerA", { ...newUser("smuggle@example.com"), role: "configurable_admin", permissions: ["catalog:read"], isAdmin: true, roles: ["admin"] });
  if (smuggled.status === 201) assert.equal((await userDoc("smuggle@example.com")).role, "configurable_admin", "unknown fields must not grant admin");
  else assert.equal(smuggled.status, 400);
  pass("Company Owner and company Admin cannot create an admin or promote anyone to admin (case variants, direct API calls, dealers, peers); roles unchanged");

  // forbidden roles / permissions
  for (const [role, expected] of [["super_admin", 403], ["company_owner", 403], ["dealer", 400], ["no_such_role", 403]]) {
    const res = await postUser("ownerA", newUser(`role_${role}@example.com`, { role }));
    assert.equal(res.status, expected, `owner creating role '${role}'`);
    assert.equal(await userDoc(`role_${role}@example.com`), null, `no '${role}' account may exist`);
  }
  assert.equal((await postUser("ownerA", newUser("Role_Mixed@example.com", { role: "Super_Admin" }))).status, 403, "role check is case-insensitive");
  assert.equal((await postUser("ownerA", newUser("excl@example.com", { role: "configurable_admin", permissions: ["admins:manage"] }))).status, 400);
  assert.equal((await postUser("ownerA", newUser("excl2@example.com", { role: "configurable_admin", permissions: ["activity:view", "spaces:hard_delete"] }))).status, 400);
  assert.equal(await userDoc("excl@example.com"), null);
  assert.equal((await postUser("ownerB", newUser("b_uses_a_role@example.com", { role: "a_custom" }))).status, 201, "B has its OWN a_custom role, so this is B's role, not A's");
  assert.equal((await userDoc("b_uses_a_role@example.com")).companyId, 20);
  pass("Company Owner cannot create super_admin/company_owner/dealer/unknown-role accounts or grant platform-exclusive permissions");

  // email uniqueness is global
  assert.equal((await postUser("ownerA", newUser("made_admin@example.com"))).status, 409, "same company duplicate");
  assert.equal((await postUser("ownerB", newUser("made_admin@example.com"))).status, 409, "another company's email is still taken");
  pass("account emails stay globally unique across companies");

  // PATCH own company
  assert.equal((await patchUser("ownerA", 9, { isActive: false })).status, 200);
  assert.equal((await userById(9)).isActive, false);
  assert.equal((await patchUser("ownerA", 9, { isActive: true, firstName: "Renamed" })).status, 200);
  assert.equal((await userById(9)).name.startsWith("Renamed"), true);
  assert.equal((await patchUser("ownerA", 9, { role: "configurable_admin", permissions: ["catalog:read"] })).status, 200);
  assert.equal((await userById(9)).role, "configurable_admin");
  assert.equal((await patchUser("ownerA", 9, { permissions: ["activity:view"] })).status, 400, "platform-exclusive permission on update");
  assert.deepEqual((await userById(9)).permissions, ["catalog:read"]);
  pass("Company Owner can update, deactivate and re-role accounts in its own company (configurable_admin permissions validated)");

  // PATCH forbidden / cross-company
  for (const role of ["super_admin", "company_owner"]) {
    assert.equal((await patchUser("ownerA", 9, { role })).status, 403, `promotion to ${role}`);
  }
  assert.equal((await userById(9)).role, "configurable_admin", "role unchanged after refused promotions");
  assert.equal((await patchUser("ownerA", 11, { isActive: false })).status, 403, "another Company Owner is off-limits");
  assert.equal((await patchUser("ownerA", 2, { isActive: false })).status, 403, "and so is oneself");
  assert.equal((await userById(11)).isActive, true);
  assert.equal((await userById(2)).isActive, true);
  assert.equal((await patchUser("ownerA", 10, { isActive: false })).status, 404, "company B's account is invisible to A");
  assert.equal((await userById(10)).isActive, true);
  assert.equal((await patchUser("ownerA", 1, { isActive: false })).status, 404, "the platform Super Admin account is invisible to a company");
  assert.equal((await userById(1)).isActive, true);
  assert.equal((await patchUser("ownerB", 9, { isActive: false })).status, 404, "and A's accounts are invisible to B");
  assert.equal((await userById(9)).isActive, true);
  assert.equal((await patchUser("ownerA", 99999, { isActive: false })).status, 404);
  const aList = await api(c.ownerA, "GET", "/api/admin/users?pageSize=100");
  const aEmails = aList.json.data.map((u) => u.email);
  assert.ok(aEmails.includes("target_a@example.com") && !aEmails.includes("target_b@example.com") && !aEmails.includes("super@example.com"));
  pass("cross-company, platform and peer-owner account changes are refused (404/403) and nothing changes; the user list is company-scoped");

  // non-managers
  for (const who of ["cfgReadA", "cfgNoReadA", "dealerA"]) {
    assert.equal((await postUser(who, newUser(`by_${who}@example.com`))).status, 403, `${who} create`);
    assert.equal((await patchUser(who, 9, { isActive: false })).status, 403, `${who} update`);
    assert.equal(await userDoc(`by_${who}@example.com`), null);
  }
  assert.equal((await api("", "POST", "/api/admin/users", newUser("anon@example.com"))).status, 401);
  assert.equal((await userById(9)).isActive, true);
  pass("configurable_admin (with and without admins:read), dealer and anonymous callers cannot create or modify accounts");

  // a company Admin IS a user manager (normal company-scoped management), just never of admin-level accounts
  const adminMade = await postUser("adminA", newUser("by_admin_a@example.com"));
  assert.equal(adminMade.status, 201);
  assert.equal((await userDoc("by_admin_a@example.com")).companyId, 10);
  assert.equal((await patchUser("adminA", 9, { isActive: false })).status, 200);
  assert.equal((await patchUser("adminA", 9, { isActive: true })).status, 200);
  assert.equal((await patchUser("adminA", 10, { isActive: false })).status, 404, "another company's account is invisible to a company admin");
  for (const id of [2, 11, 4]) assert.equal((await patchUser("adminA", id, { isActive: false })).status, 403, `company admin modifying owner/admin account ${id}`);
  assert.equal((await userById(2)).isActive !== false, true);
  pass("a company Admin manages permitted accounts in its own company, but never owner/admin accounts or another company's");

  // ───────────────────────── Super Admin: with and without a company ─────────────────────────
  const superNoCompanyAdmin = await postUser("super", newUser("super_no_ctx@example.com"));
  assert.equal(superNoCompanyAdmin.status, 403, "no company selected => cannot create a company account");
  assert.match(superNoCompanyAdmin.json.error.message, /select a company/i);
  assert.equal(await userDoc("super_no_ctx@example.com"), null);
  assert.equal((await patchUser("super", 9, { isActive: false })).status, 403);
  assert.match((await patchUser("super", 9, { isActive: false })).json.error.message, /select a company/i);
  const platformAccount = await postUser("super", newUser("platform_super@example.com", { role: "super_admin" }));
  assert.equal(platformAccount.status, 201, "creating another Super Admin is platform-level and needs no company");
  assert.equal((await userDoc("platform_super@example.com")).companyId ?? null, null);
  assert.equal((await api(c.super, "POST", "/api/admin/roles", { key: "no_ctx_role", name: "No Ctx", permissions: [] })).status, 403);
  assert.equal(await roleRow(10, "no_ctx_role"), null);
  pass("Super Admin with no company selected is refused company-specific writes with a 'select a company' message; platform Super Admin creation still works");

  const actAs = await apiWithSetCookieCapture(c.super, "POST", "/api/platform/act-as", { companyId: 10, reason: "user/role management test" });
  assert.equal(actAs.status, 200);
  c.superActing = [c.super, ...actAs.newCookiePairs].join("; ");
  const ctxNow = await api(c.superActing, "GET", "/api/platform/act-as");
  assert.deepEqual([ctxNow.data.actingAsCompany, ctxNow.data.companyId, ctxNow.data.companyName], [true, 10, "Company 10"]);
  const actingCreate = await postUser("superActing", newUser("super_acting_admin@example.com"));
  assert.equal(actingCreate.status, 201);
  assert.equal((await userDoc("super_acting_admin@example.com")).companyId, 10);
  assert.equal((await patchUser("superActing", 9, { isActive: false })).status, 200);
  assert.equal((await patchUser("superActing", 9, { isActive: true })).status, 200);
  assert.equal((await patchUser("superActing", 10, { isActive: false })).status, 404, "acting as A still cannot touch B's accounts");
  assert.equal((await userById(10)).isActive, true);
  assert.equal((await postUser("superActing", newUser("acting_owner@example.com", { role: "company_owner" }))).status, 201, "Super Admin keeps the ability to create a company's owner");
  assert.equal((await userDoc("acting_owner@example.com")).companyId, 10);
  pass("Super Admin acting as company A keeps its capabilities there (create/update, owners included) and still cannot reach company B");

  // ───────────────────────── UI vs API alignment ─────────────────────────
  // For each (actor, role): the shared rule must predict exactly whether the API accepts the create.
  const customKeysA = ["a_custom"];
  const alignActors = [
    ["ownerA", { role: "company_owner", hasCompanyContext: true }, customKeysA],
    ["adminA", { role: "admin", hasCompanyContext: true }, []],
    ["superActing", { role: "super_admin", hasCompanyContext: true }, []],
    ["super", { role: "super_admin", hasCompanyContext: false }, []],
  ];
  for (const [who, actor, customKeys] of alignActors) {
    for (const key of ["admin", "configurable_admin", "company_owner", "super_admin", "a_custom", "no_such_role"]) {
      const email = `align_${who}_${key}@example.com`;
      const res = await postUser(who, newUser(email, { role: key }));
      const allowed = canAssignRole(actor, key, customKeys);
      assert.equal(res.status === 201, allowed, `${who} creating '${key}': rule says ${allowed}, API said ${res.status}`);
      if (!allowed) assert.equal(res.status, 403);
    }
  }
  const ownerCreated = await db.collection("adminusers").find({ email: /^align_ownera_/ }).toArray();
  assert.ok(ownerCreated.length >= 2 && ownerCreated.every((u) => u.companyId === 10), "every account the owner created belongs to its company");
  pass("which roles the Users page offers (canAssignRole) matches exactly which creates the API accepts, per actor");

  const uiActors = [
    ["super", "super_admin", [], false], ["superActing", "super_admin", [], true], ["ownerA", "company_owner", [], true],
    ["adminA", "admin", [], true], ["cfgReadA", "configurable_admin", ["admins:read"], true],
    ["cfgNoReadA", "configurable_admin", ["catalog:read"], true], ["dealerA", "dealer", [], true],
  ];
  for (const [who, role, perms, ctx] of uiActors) {
    const ui = getUsersPageAccess(role, perms, ctx);
    const read = (await api(c[who], "GET", "/api/admin/users?pageSize=5")).status;
    const write = (await postUser(who, newUser(`probe_${who}@example.com`, { role: "sales_executive" }))).status;
    if (read === 200) assert.equal(ui.canRead, true, `${who}: API serves the list but the page would hide it`);
    if (!ui.canRead) assert.equal(read, 403, `${who}: page hides the screen but the API would serve it`);
    if (write === 201) assert.equal(ui.canManage, true, `${who}: API accepts writes but the page hides the controls`);
    if (!ui.canManage) assert.equal(write, 403, `${who}: page hides the controls but the API would accept writes`);
  }
  pass("the Users page's read/manage visibility never contradicts the API for any role");

  // ───────────────────────── Sidebar visibility vs API ─────────────────────────
  const navApis = { "/admin/roles": "/api/admin/roles", "/admin/users": "/api/admin/users?pageSize=5", "/admin/activity": "/api/admin/activity" };
  const navActors = [["super", "super_admin"], ["ownerA", "company_owner"], ["adminA", "admin"], ["cfgReadA", "configurable_admin"], ["cfgNoReadA", "configurable_admin"]];
  for (const [who, role] of navActors) {
    for (const [href, apiPath] of Object.entries(navApis)) {
      const visible = canSeeAdminNavItem(href, role);
      const status = (await api(c[who], "GET", apiPath)).status;
      if (visible) assert.equal(status, 200, `${who}: sidebar shows ${href} but its API answered ${status}`);
      if (href === "/admin/activity") assert.equal(visible, status === 200, `${who}: Activity Log visibility must equal platform-only access`);
    }
  }
  assert.equal((await api(c.ownerA, "GET", "/api/admin/activity")).status, 403, "a visible link elsewhere never grants platform-wide Activity Log access");
  assert.equal(canSeeAdminNavItem("/admin/activity", "company_owner"), false);
  // and a hidden link is not a lock: the API is what decides.
  assert.equal((await api(c.ownerA, "POST", "/api/admin/roles/admin/reset", {})).status, 403, "an owner cannot reset role definitions");
  assert.equal(canSeeAdminNavItem("/admin/roles", "admin"), false);
  assert.equal((await api(c.adminA, "GET", "/api/admin/roles")).status, 200, "hiding the link is cosmetic: the API alone authorizes (metadata-only read for company admins)");
  assert.equal((await api(c.adminA, "POST", "/api/admin/roles", { key: "hidden_link_bypass", name: "Hidden Link", permissions: [] })).status, 403, "...and it still refuses role-definition writes");
  pass("sidebar links shown to a role are always backed by an API that serves it; Activity Log stays super_admin-only; hidden links are not what protects anything");

  await api(c.superActing, "DELETE", "/api/platform/act-as");
  assert.equal((await api(c.superActing, "GET", "/api/platform/act-as")).data?.actingAsCompany ?? false, false, "act-as ended");

  console.log(`\nUser & role management PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
