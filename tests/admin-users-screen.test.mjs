/**
 * "Redesign Whyte Admin Panel user and role management into a dedicated
 * Users screen" — regression test for the new backend behavior the Users
 * screen depends on:
 *
 *   1. GET /api/admin/users now lists EVERY role (super_admin, admin,
 *      configurable_admin, dealer) in one place — previously it excluded
 *      dealers entirely.
 *   2. The role filter (`?role=dealer`) still works against the widened list.
 *   3. Search still works across the widened list.
 *   4. POST /api/admin/users still refuses to create a "dealer" account (no
 *      authenticated dealer-creation path exists; dealers register through
 *      the separate public /api/admin/register flow) — unchanged behavior.
 *   5. PATCH /api/admin/users/[id] still refuses to operate on a dealer
 *      account (dealers are edited through /api/admin/dealers/[id] instead,
 *      which the Users screen's Edit modal calls directly for dealer rows).
 *   6. A non-super_admin (plain "admin") can still READ the unified list
 *      (admins:read) but cannot create/edit accounts (admins:manage is
 *      super_admin-only) — unchanged authorization behavior, now exercised
 *      against the widened listing.
 *
 *   node tests/admin-users-screen.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "admin-users-screen",
    [
      { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 2, email: "plain_admin@example.com", role: "admin", name: "Plain Admin", companyId: 1 },
      { _id: 3, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyName: "Acme Co", companyId: 1 },
      { _id: 4, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", companyName: "Beta Co", companyId: 1 },
      { _id: 5, email: "config_admin@example.com", role: "configurable_admin", name: "Config Admin", permissions: ["catalog:read"], companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;

  await db.collection("companies").insertOne({ _id: 1, name: "Company A", slug: "company-a", status: "active", phone: "1111111111", address: "A St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: new Date(), updatedAt: new Date() });

  // api() doesn't accumulate Set-Cookie from responses, but establishing an
  // "act as company" session needs exactly that — see tests/phase1-tenant-auth.test.mjs.
  async function apiWithSetCookieCapture(cookie, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    const data = json && typeof json === "object" && "data" in json ? json.data : json;
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const newPairs = setCookies.map((c) => c.split(";")[0]);
    return { status: res.status, json, data, text, newCookiePairs: newPairs };
  }

  const bareSuperCookie = await login("super_admin@example.com", "admin");
  const adminCookie = await login("plain_admin@example.com", "admin");

  // This screen manages a single company's administrative accounts — like
  // every other piece of company business data, a platform Super Admin only
  // sees/manages it by explicitly "acting as" that company (see Phase 1's
  // tenant-isolation decisions, verified end-to-end in phase1-tenant-auth.test.mjs).
  const actAs = await apiWithSetCookieCapture(bareSuperCookie, "POST", "/api/platform/act-as", { companyId: 1, reason: "admin-users-screen test" });
  assert.equal(actAs.status, 200, "Super Admin must be able to act as company 1 to manage its accounts");
  const superCookie = [bareSuperCookie, ...actAs.newCookiePairs].join("; ");

  // ═══ 1. GET /api/admin/users lists every role, including dealer — but ═══
  // only within the acting company; the platform Super Admin's own account
  // has no companyId and is correctly excluded from any one company's list.
  // The route returns the standard paginated envelope directly:
  // `{ data: User[], pagination: { total, totalPages, ... } }`.
  const all = await api(superCookie, "GET", "/api/admin/users?pageSize=100");
  assert.equal(all.status, 200);
  const roles = new Set(all.json.data.map((u) => u.role));
  assert.ok(!roles.has("super_admin"), "the platform Super Admin's own account is not part of any company and must not appear in a company's Users list");
  assert.ok(roles.has("admin"), "admin must be present");
  assert.ok(roles.has("dealer"), "dealer must now be present (previously excluded)");
  assert.ok(roles.has("configurable_admin"), "configurable_admin must be present");
  assert.equal(all.json.pagination.total, 4, "the 4 seeded accounts belonging to this company are counted — the platform Super Admin's own account is not one of them");
  pass("GET /api/admin/users lists every role in one place, including dealers, scoped to the acting company");

  // ═══ 2. Role filter still works, now including "dealer" ═══
  const dealersOnly = await api(superCookie, "GET", "/api/admin/users?role=dealer");
  assert.equal(dealersOnly.json.pagination.total, 2);
  assert.ok(dealersOnly.json.data.every((u) => u.role === "dealer"));
  pass("role filter correctly narrows to just dealer accounts");

  // ═══ 3. Search still works across the widened list ═══
  const searched = await api(superCookie, "GET", "/api/admin/users?search=Dealer+A");
  assert.equal(searched.json.pagination.total, 1);
  assert.equal(searched.json.data[0].email, "dealer_a@example.com");
  pass("search still finds the right account across the widened (all-roles) list");

  // ═══ 4. POST /api/admin/users still refuses to create a dealer ═══
  const createDealerAttempt = await api(superCookie, "POST", "/api/admin/users", {
    firstName: "New",
    lastName: "Dealer",
    email: "new_dealer@example.com",
    password: "Password123!",
    role: "dealer",
  });
  assert.equal(createDealerAttempt.status, 400, "creating a dealer through this endpoint must still be rejected");
  pass("POST /api/admin/users still refuses to create dealer accounts (unchanged)");

  // Sanity: creating a configurable_admin through the same endpoint still works.
  const createAdminAttempt = await api(superCookie, "POST", "/api/admin/users", {
    firstName: "New",
    lastName: "Admin",
    email: "new_admin@example.com",
    password: "Password123!",
    role: "admin",
  });
  assert.equal(createAdminAttempt.status, 201);
  pass("POST /api/admin/users still creates non-dealer accounts correctly");

  // ═══ 5. PATCH /api/admin/users/[id] still refuses to touch a dealer record ═══
  const patchDealerAttempt = await api(superCookie, "PATCH", "/api/admin/users/3", { isActive: false });
  assert.equal(patchDealerAttempt.status, 404, "editing a dealer through the admin-users PATCH route must still 404");
  const dealerStillActive = await db.collection("adminusers").findOne({ _id: 3 });
  assert.equal(dealerStillActive.isActive, true, "the dealer record must be untouched");
  pass("PATCH /api/admin/users/[id] still refuses to modify dealer accounts (Edit modal must route dealers to /api/admin/dealers/[id] instead)");

  // The dealer-specific endpoint is the correct path for the same edit.
  const patchDealerCorrectly = await api(superCookie, "PATCH", "/api/admin/dealers/3", { isActive: false });
  assert.equal(patchDealerCorrectly.status, 200);
  const dealerNowInactive = await db.collection("adminusers").findOne({ _id: 3 });
  assert.equal(dealerNowInactive.isActive, false);
  pass("PATCH /api/admin/dealers/[id] is the correct path the Users screen uses for dealer edits, and it works");

  // ═══ 6. Authorization: plain "admin" can read, cannot manage ═══
  const adminRead = await api(adminCookie, "GET", "/api/admin/users?pageSize=100");
  assert.equal(adminRead.status, 200, "admin role has admins:read and can view the unified Users list");
  assert.equal(adminRead.json.pagination.total, 5, "sees the account created earlier in this test too");

  const adminCreateAttempt = await api(adminCookie, "POST", "/api/admin/users", {
    firstName: "Should",
    lastName: "Fail",
    email: "should_fail@example.com",
    password: "Password123!",
    role: "admin",
  });
  assert.equal(adminCreateAttempt.status, 403, "a plain admin (not super_admin) must not be able to create accounts");
  pass("a non-super_admin can read the Users list but cannot create accounts (admins:manage is super_admin-only, unchanged)");

  console.log(`\nAdmin Users screen backend behavior PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
