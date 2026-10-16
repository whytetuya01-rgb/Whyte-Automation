/**
 * Only a Super Admin may create a company `admin` or promote an account to it.
 * Real HTTP against an isolated production server + throwaway Mongo.
 *
 *   - company_owner / company `admin` cannot create `admin` (any case/whitespace)
 *   - they cannot promote configurable_admin / sales_executive / custom-role
 *     accounts to `admin`, nor touch an existing admin
 *   - dealers cannot be promoted through the user routes
 *   - normal company-scoped management of permitted roles still works
 *   - a Super Admin acting as the company still can create/promote admins
 *   - nothing is written by any refused request
 *
 *   node tests/admin-role-escalation.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 4, email: "cfg_a@example.com", role: "configurable_admin", name: "Cfg A", companyId: 10, permissions: ["catalog:read"] },
    { _id: 5, email: "sales_a@example.com", role: "sales_executive", name: "Sales A", companyId: 10 },
    { _id: 6, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 7, email: "other_admin_a@example.com", role: "admin", name: "Other Admin A", companyId: 10 },
    { _id: 8, email: "owner_b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
  ];
  server = await startIsolatedServer("adm-escal", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null,
      createdAt: now, updatedAt: now,
    }))
  );
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const c = {
    super: await login("super@example.com", "admin"),
    ownerA: await login("owner_a@example.com", "admin"),
    ownerB: await login("owner_b@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
  };
  const userDoc = (email) => db.collection("adminusers").findOne({ email });
  const userById = (id) => db.collection("adminusers").findOne({ _id: id });
  const newUser = (email, extra = {}) => ({ firstName: "New", lastName: "User", email, password: "Password123!", role: "sales_executive", ...extra });
  const postUser = (who, body) => api(c[who], "POST", "/api/admin/users", body);
  const patchUser = (who, id, body) => api(c[who], "PATCH", `/api/admin/users/${id}`, body);
  const countUsers = () => db.collection("adminusers").countDocuments({});

  const baselineCount = await countUsers();

  // 1. creating an admin
  for (const who of ["ownerA", "adminA"]) {
    for (const role of ["admin", "Admin", " ADMIN ", "AdMiN"]) {
      const email = `blocked_${who}_${role.trim().toLowerCase()}_${role.length}@example.com`;
      const res = await postUser(who, newUser(email, { role }));
      assert.equal(res.status, 403, `${who} creating '${role}' -> ${res.status}`);
      assert.equal(await userDoc(email), null);
    }
  }
  assert.equal(await countUsers(), baselineCount, "no refused create wrote an account");
  pass("company_owner and company admin cannot create an admin (case/whitespace variants, direct API)");

  // 2. promoting existing accounts to admin
  const targets = { configurable_admin: 4, sales_executive: 5 };
  for (const who of ["ownerA", "adminA"]) {
    for (const [roleName, id] of Object.entries(targets)) {
      for (const role of ["admin", "ADMIN"]) {
        assert.equal((await patchUser(who, id, { role })).status, 403, `${who} promoting ${roleName} to ${role}`);
        assert.equal((await userById(id)).role, roleName, "role unchanged after refused promotion");
      }
    }
  }
  pass("company_owner and company admin cannot promote configurable_admin / sales_executive to admin");

  // 3. dealers are unreachable and cannot be promoted
  for (const who of ["ownerA", "adminA"]) {
    const status = (await patchUser(who, 6, { role: "admin" })).status;
    assert.ok(status === 403 || status === 404, `${who} promoting a dealer -> ${status}`);
  }
  assert.equal((await userById(6)).role, "dealer");
  pass("a dealer cannot be promoted to admin through the user routes");

  // 4. peers and the admin tier stay off-limits
  assert.equal((await patchUser("adminA", 7, { isActive: false })).status, 403, "admin cannot modify another admin");
  assert.equal((await patchUser("adminA", 3, { role: "admin" })).status, 403);
  assert.equal((await patchUser("ownerA", 7, { role: "configurable_admin", permissions: ["catalog:read"] })).status, 403, "owner cannot re-role an existing admin either");
  assert.equal((await userById(7)).role, "admin");
  assert.notEqual((await userById(7)).isActive, false);
  pass("existing admin accounts cannot be modified or demoted by a company admin/owner");

  // 5. cross-company: company B owner cannot reach company A accounts
  assert.equal((await patchUser("ownerB", 4, { role: "admin" })).status, 404);
  assert.equal((await userById(4)).role, "configurable_admin");
  pass("another company's owner cannot promote accounts either (404)");

  // 6. unknown/extra fields cannot smuggle the role
  const smuggled = await postUser("ownerA", { ...newUser("smuggle@example.com"), role: "configurable_admin", permissions: ["catalog:read"], isAdmin: true, roles: ["admin"] });
  if (smuggled.status === 201) assert.equal((await userDoc("smuggle@example.com")).role, "configurable_admin");
  else assert.equal(smuggled.status, 400);
  pass("extra fields cannot smuggle admin rights; stored role is exactly the validated one");

  // 7. unauthenticated
  assert.equal((await api("", "POST", "/api/admin/users", newUser("anon@example.com", { role: "admin" }))).status, 401);
  assert.equal((await api("", "PATCH", "/api/admin/users/4", { role: "admin" })).status, 401);
  pass("anonymous callers get 401");

  // 8. permitted management still works
  const okCreate = await postUser("ownerA", newUser("ok_sales@example.com"));
  assert.equal(okCreate.status, 201);
  assert.equal((await userDoc("ok_sales@example.com")).companyId, 10);
  assert.equal((await patchUser("ownerA", 5, { isActive: false })).status, 200);
  assert.equal((await patchUser("ownerA", 5, { isActive: true, role: "configurable_admin", permissions: ["catalog:read"] })).status, 200);
  assert.equal((await userById(5)).role, "configurable_admin");
  pass("owner can still create and update sales_executive / configurable_admin accounts in its company");

  // 9. Super Admin keeps the capability (acting as company 10)
  const actRes = await fetch(`${baseUrl}/api/platform/act-as`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: c.super },
    body: JSON.stringify({ companyId: 10, reason: "escalation test" }),
  });
  assert.equal(actRes.status, 200);
  const pairs = actRes.headers.getSetCookie().map((x) => x.split(";")[0]);
  c.superActing = [c.super, ...pairs].join("; ");
  const superCreate = await postUser("superActing", newUser("super_made_admin@example.com", { role: "admin" }));
  assert.equal(superCreate.status, 201);
  assert.equal((await userDoc("super_made_admin@example.com")).role, "admin");
  assert.equal((await userDoc("super_made_admin@example.com")).companyId, 10);
  assert.equal((await patchUser("superActing", 4, { role: "admin" })).status, 200);
  assert.equal((await userById(4)).role, "admin");
  pass("a Super Admin acting as the company can still create admins and promote to admin");

  console.log(`\nAdmin role escalation PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
