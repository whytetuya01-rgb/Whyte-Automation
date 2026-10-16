/**
 * No implicit "Company 1": an account's company comes only from its own explicit
 * companyId. Covers src/lib/auth.ts (sign-in) and src/lib/sessionGuard.ts
 * (per-request revalidation) over real HTTP against an isolated production
 * server + throwaway Mongo, plus the pure resolver.
 *
 *   node tests/account-company-resolution.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const { resolveAccountCompany } = await import("../src/lib/tenant/accountCompany.ts");

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  // ── pure resolver ──
  assert.deepEqual(resolveAccountCompany("super_admin", null), { ok: true, companyId: null });
  assert.deepEqual(resolveAccountCompany("super_admin", undefined), { ok: true, companyId: null });
  assert.deepEqual(resolveAccountCompany(" Super_Admin ", 5), { ok: true, companyId: null }, "a super admin never takes a stored company");
  for (const role of ["admin", "company_owner", "configurable_admin", "sales_executive", "dealer"]) {
    assert.deepEqual(resolveAccountCompany(role, 1), { ok: true, companyId: 1 }, role);
    assert.deepEqual(resolveAccountCompany(role, null), { ok: false, reason: "MISSING_COMPANY" }, `${role} null`);
    assert.deepEqual(resolveAccountCompany(role, undefined), { ok: false, reason: "MISSING_COMPANY" }, `${role} undefined`);
    for (const bad of [0, -1, 1.5, "1", NaN, {}, true]) {
      assert.deepEqual(resolveAccountCompany(role, bad), { ok: false, reason: "INVALID_COMPANY" }, `${role} ${String(bad)}`);
    }
  }
  assert.equal(resolveAccountCompany(null, 1).ok, true);
  assert.equal(resolveAccountCompany(undefined, null).ok, false, "an unknown role is not the platform account");
  pass("resolver: super admin => null; every other role needs a positive integer; nothing defaults to 1");

  const now = new Date();
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super", companyId: null },
    { _id: 2, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "admin_b@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 4, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 5, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", companyId: 20 },
    { _id: 6, email: "nocompany_admin@example.com", role: "admin", name: "No Company Admin" },
    { _id: 7, email: "nullcompany_dealer@example.com", role: "dealer", name: "Null Company Dealer", companyId: null },
    { _id: 8, email: "ghost_company@example.com", role: "admin", name: "Ghost Company", companyId: 999 },
    { _id: 9, email: "string_company@example.com", role: "admin", name: "String Company", companyId: "10" },
    { _id: 10, email: "zero_company@example.com", role: "admin", name: "Zero Company", companyId: 0 },
    { _id: 11, email: "later_a@example.com", role: "admin", name: "Loses Company Later", companyId: 10 },
    { _id: 12, email: "later_b@example.com", role: "dealer", name: "Moves To Deleted Company", companyId: 10 },
    { _id: 13, email: "super_stray@example.com", role: "super_admin", name: "Super With Stray Company", companyId: 10 },
  ];
  server = await startIsolatedServer("acct-co", USERS, { production: true });
  const { db, login, api } = server;
  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: id === 10 ? "pending" : "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now,
    }))
  );
  await db.collection("categories").insertMany([
    { _id: 101, companyId: 10, name: "Company A Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] },
    { _id: 201, companyId: 20, name: "Company B Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] },
    { _id: 301, name: "Legacy no-company category", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] },
  ]);
  const categories = async (cookie) => {
    const res = await api(cookie, "GET", "/api/categories");
    return { status: res.status, names: Array.isArray(res.data) ? res.data.map((c) => c.name).sort() : [] };
  };
  const signedIn = async (cookie) => (await api(cookie, "GET", "/api/categories")).status !== 401;

  // 1. super admin with companyId null
  const superCookie = await login("super@example.com", "admin");
  assert.deepEqual(await categories(superCookie), { status: 200, names: [] }, "super admin sees no company data without act-as");
  const act = await fetch(`${server.baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: superCookie }, body: JSON.stringify({ companyId: 20, reason: "resolution test" }) });
  assert.equal(act.status, 200);
  const actingCookie = [superCookie, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  assert.deepEqual(await categories(actingCookie), { status: 200, names: ["Company B Switches"] }, "acting as 20 shows only company 20, never legacy/no-company or company 10 rows");
  pass("Super Admin (companyId null): nothing without act-as; only the chosen company's data while acting");

  // 2. company admin with companyId 10 (pending company is allowed)
  const adminA = await login("admin_a@example.com", "admin");
  assert.deepEqual(await categories(adminA), { status: 200, names: ["Company A Switches"] }, "company 10 only: not company 20, not the no-company legacy row");
  const adminB = await login("admin_b@example.com", "admin");
  assert.deepEqual(await categories(adminB), { status: 200, names: ["Company B Switches"] });
  pass("company Admin with companyId 10 sees exactly company 10's data (legacy rows without a company stay invisible)");

  // 3. dealer with the correct company
  const dealerA = await login("dealer_a@example.com", "user");
  assert.equal(await signedIn(dealerA), true);
  const dealerB = await login("dealer_b@example.com", "user");
  assert.equal(await signedIn(dealerB), true);
  pass("dealers with an explicit, existing company can sign in");

  // 4. missing / invalid company context: login refused, never defaulted to Company 1
  for (const [email, portal] of [
    ["nocompany_admin@example.com", "admin"], // field absent
    ["nullcompany_dealer@example.com", "user"], // null
    ["ghost_company@example.com", "admin"], // no such company
    ["string_company@example.com", "admin"], // wrong type
    ["zero_company@example.com", "admin"], // not a positive id
  ]) {
    const cookie = await login(email, portal);
    assert.equal(await signedIn(cookie), false, `${email} must not obtain a session`);
  }
  pass("accounts with a missing, null, non-numeric, zero or non-existent company cannot sign in (no default company)");

  // 5. a stray companyId on a super admin is ignored: still no company data without act-as
  const strayCookie = await login("super_stray@example.com", "admin");
  assert.deepEqual(await categories(strayCookie), { status: 200, names: [] });
  pass("a super admin with a stray stored companyId still sees no company data");

  // 6. an already-issued session is invalidated if the account loses its company / its company is deleted
  const laterA = await login("later_a@example.com", "admin");
  const laterB = await login("later_b@example.com", "user");
  await db.collection("adminusers").updateOne({ _id: 11 }, { $unset: { companyId: "" } });
  assert.equal(await signedIn(laterA), false, "a live session of an account that lost its company is refused");
  await db.collection("companies").updateOne({ _id: 10 }, { $set: { isDeleted: true } });
  assert.equal(await signedIn(laterB), false, "a live session of an account whose company was soft-deleted is refused");
  pass("live sessions are revalidated: no company or a deleted company => 401, never Company 1");
  await db.collection("companies").updateOne({ _id: 10 }, { $set: { isDeleted: false } });

  // 7. cross-company access attempts
  const crossRead = await api(adminA, "GET", "/api/categories/201/deletion-impact");
  assert.ok(crossRead.status === 404 || crossRead.status === 403, `cross-company read -> ${crossRead.status}`);
  assert.equal((await api(adminA, "PATCH", "/api/categories/201", { name: "Hijacked" })).status, 404);
  assert.equal((await api(adminA, "PATCH", "/api/categories/301", { name: "Hijacked legacy" })).status, 404, "a record with no company belongs to nobody");
  assert.equal((await api(dealerA, "PATCH", "/api/categories/201", { name: "Dealer hijack" })).status >= 400, true);
  assert.equal((await db.collection("categories").findOne({ _id: 201 })).name, "Company B Switches");
  assert.equal((await db.collection("categories").findOne({ _id: 301 })).name, "Legacy no-company category");
  pass("cross-company and no-company records cannot be read or modified by a company admin or dealer");

  console.log(`\nAccount company resolution PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
