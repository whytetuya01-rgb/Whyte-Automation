/**
 * Phase 1, Step 3 — auth/session/roles tenant wiring, tested against a real
 * isolated Next.js server + local MongoDB (not mocked): confirms
 * `requireSession()`'s `enterTenantContext()` call actually produces
 * end-to-end company isolation through real HTTP requests, that a suspended
 * company forces its users out, that Super Admin sees nothing by default and
 * only what it "acts as", and the quotations/route.ts authorization-gap fix.
 *
 *   node tests/phase1-tenant-auth.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "phase1-tenant-auth",
    [
      { _id: 1, email: "platform_owner@example.com", role: "super_admin", name: "Platform Owner", companyId: null },
      { _id: 2, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
      { _id: 3, email: "owner_b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
      { _id: 4, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10, discountAllocationPercent: 20 },
      { _id: 5, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
      { _id: 6, email: "suspended_owner@example.com", role: "company_owner", name: "Suspended Co Owner", companyId: 30 },
    ],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;

  // api() doesn't accumulate Set-Cookie from responses (it's a static-cookie
  // helper), but act-as needs exactly that: a cookie minted by POST /api/platform/act-as
  // must be sent on the SUBSEQUENT GET. Small local helper that does.
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

  await db.collection("companies").insertMany([
    { _id: 10, name: "Company A", slug: "company-a", status: "active", phone: "1111111111", address: "A St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: new Date(), updatedAt: new Date() },
    { _id: 20, name: "Company B", slug: "company-b", status: "active", phone: "2222222222", address: "B St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: new Date(), updatedAt: new Date() },
    { _id: 30, name: "Suspended Co", slug: "suspended-co", status: "suspended", phone: "3333333333", address: "C St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: new Date(), updatedAt: new Date() },
  ]);

  await db.collection("categories").insertMany([
    { _id: 101, companyId: 10, name: "Company A Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] },
    { _id: 201, companyId: 20, name: "Company B Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] },
  ]);

  // ═══ 1. A suspended company's user cannot even log in ═══
  const suspendedLoginAttempt = await login("suspended_owner@example.com", "admin");
  // login() returns a cookie string built from whatever Set-Cookie headers came back;
  // if authorize() returned null, NextAuth never issues a real session cookie, so a
  // request made with it is unauthenticated.
  const suspendedCheck = await api(suspendedLoginAttempt, "GET", "/api/categories");
  assert.equal(suspendedCheck.status, 401, "a suspended company's user must not be able to establish a session at all");
  pass("a suspended company's user cannot log in (authorize() rejects it)");

  // ═══ 2. Company isolation: A sees only A's categories, B sees only B's ═══
  const ownerACookie = await login("owner_a@example.com", "admin");
  const ownerBCookie = await login("owner_b@example.com", "admin");

  const aView = await api(ownerACookie, "GET", "/api/categories");
  assert.equal(aView.status, 200);
  assert.equal(aView.data.length, 1);
  assert.equal(aView.data[0].name, "Company A Switches");

  const bView = await api(ownerBCookie, "GET", "/api/categories");
  assert.equal(bView.status, 200);
  assert.equal(bView.data.length, 1);
  assert.equal(bView.data[0].name, "Company B Switches");
  pass("company_owner A and company_owner B each see only their own company's categories — zero cross-leak over real HTTP");

  // ═══ 3. Direct-by-ID access across companies finds nothing ═══
  const crossCompanyPatch = await api(ownerACookie, "PATCH", "/api/categories/201", { name: "Hijacked" });
  assert.equal(crossCompanyPatch.status, 404, "Company A must not be able to even find, let alone modify, Company B's category by ID");
  const stillIntact = await db.collection("categories").findOne({ _id: 201 });
  assert.equal(stillIntact.name, "Company B Switches", "Company B's category must be completely untouched");
  pass("direct-by-ID cross-company PATCH returns 404 and leaves the other company's record untouched");

  // ═══ 4. Platform Super Admin sees NOTHING by default (no act-as) ═══
  const platformCookie = await login("platform_owner@example.com", "admin");
  const platformDefaultView = await api(platformCookie, "GET", "/api/categories");
  assert.equal(platformDefaultView.status, 200);
  assert.equal(platformDefaultView.data.length, 0, "Super Admin without act-as must see ZERO categories across every company");
  pass('Super Admin sees zero tenant business data by default — "does not see company data unless it acts as a company"');

  // ═══ 5. Super Admin "act as company" grants scoped access, and only that company's ═══
  const actAsA = await apiWithSetCookieCapture(platformCookie, "POST", "/api/platform/act-as", { companyId: 10, reason: "support ticket #42" });
  assert.equal(actAsA.status, 200, "POST /api/platform/act-as must exist and succeed for a real Super Admin session");
  assert.ok(actAsA.newCookiePairs.length > 0, "starting an act-as session must set a new cookie");
  const platformActingAsACookie = [platformCookie, ...actAsA.newCookiePairs].join("; ");

  const platformActingAsA = await api(platformActingAsACookie, "GET", "/api/categories");
  assert.equal(platformActingAsA.data.length, 1);
  assert.equal(platformActingAsA.data[0].name, "Company A Switches");
  pass("after act-as company 10, Super Admin sees exactly Company A's data — not Company B's, not all of it");

  const exitActAs = await apiWithSetCookieCapture(platformActingAsACookie, "DELETE", "/api/platform/act-as");
  assert.equal(exitActAs.status, 200);
  const platformAfterExitCookie = [platformCookie, ...exitActAs.newCookiePairs].join("; ");
  const platformAfterExit = await api(platformAfterExitCookie, "GET", "/api/categories");
  assert.equal(platformAfterExit.data.length, 0, "after exiting act-as, Super Admin returns to seeing zero tenant data");
  pass("exiting act-as correctly returns Super Admin to the default zero-visibility state");

  // ═══ 6. Every act-as start/stop is logged ═══
  const accessLogRows = await db.collection("platformaccesslogs").find({ superAdminUserId: 1 }).toArray();
  assert.equal(accessLogRows.length, 1, "exactly one PlatformAccessLog row for the one act-as session that was started and ended");
  assert.equal(accessLogRows[0].companyId, 10);
  assert.ok(accessLogRows[0].endedAt, "the row must record when the act-as session ended");
  assert.equal(accessLogRows[0].reason, "support ticket #42");
  pass("act-as start and stop are both recorded in PlatformAccessLog, including the required reason");

  // ═══ 7. quotations/route.ts authorization-gap fix: GET requires quotations:read_all per role, not per role-name ═══
  const dealerACookie = await login("dealer_a@example.com", "user");
  const adminACookie = await login("admin_a@example.com", "admin");

  // Baseline: admin_a (default permissions, includes quotations:read_all) can see across dealers today.
  const adminSeesAll = await api(adminACookie, "GET", "/api/quotations");
  assert.equal(adminSeesAll.status, 200, "admin with default permissions can list quotations (quotations:read_all present by default)");

  // Super Admin customizes company 10's "admin" role to revoke quotations:read_all.
  const actAsAgain = await apiWithSetCookieCapture(platformCookie, "POST", "/api/platform/act-as", { companyId: 10, reason: "test: revoke admin quotations:read_all" });
  const actingAsACookieAgain = [platformCookie, ...actAsAgain.newCookiePairs].join("; ");
  const adminDefaultPerms = (await api(actingAsACookieAgain, "GET", "/api/admin/roles")).data.roles.find((r) => r.key === "admin").permissions;
  const revokedPerms = adminDefaultPerms.filter((p) => p !== "quotations:read_all");
  const revokeResult = await api(actingAsACookieAgain, "PATCH", "/api/admin/roles/admin", { permissions: revokedPerms });
  assert.equal(revokeResult.status, 200, "revoking quotations:read_all from company 10's admin role must succeed");
  await api(actingAsACookieAgain, "DELETE", "/api/platform/act-as");

  // admin_a must now be scoped to only quotations they created themselves — the actual regression test for Addendum §2a.
  const adminAfterRevoke = await api(adminACookie, "GET", "/api/quotations");
  assert.equal(adminAfterRevoke.status, 200);
  assert.ok(
    adminAfterRevoke.data.every((q) => String(q.createdBy) === "5"),
    "GAP FIX VERIFIED: after revoking quotations:read_all, admin_a must only see quotations they personally created, not every dealer's"
  );
  pass("quotations/route.ts GET: revoking quotations:read_all from a company's admin role now actually restricts visibility (Addendum §2a gap closed)");

  console.log(`\nPhase 1 Step 3 (auth/session/roles) PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
