/**
 * Phase 1 regression: POST /api/admin/register (the public, unauthenticated
 * dealer self-registration endpoint) has no session, so no tenant context
 * exists when it runs — but `AdminUser` now requires a `companyId` via
 * `tenantScopePlugin`. Without a fix, every registration would crash with
 * `TenantScopeViolationError: no tenant context established` the moment it
 * tried to check for a duplicate email, reserve the next id, or save the new
 * document. The fix resolves the single default company (slug "whyte-automations",
 * created by the Phase 1 migration) via `runUnscoped("public-registration", ...)`
 * and stamps it explicitly onto the new dealer record.
 *
 *   node tests/phase1-public-registration.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "ph1-public-reg",
    [
      { _id: 1, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
    ],
    { production: true }
  );
  const { db, api, login } = server;
  const now = new Date();

  await db.collection("companies").insertOne({
    _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "active",
    phone: "1111111111", address: "Whyte HQ", gstNumber: null, email: null,
    logoUrl: null, tagline: null, createdAt: now, updatedAt: now,
  });

  // ═══ 1. A brand-new dealer can register with no session at all ═══
  const registerResp = await api("", "POST", "/api/admin/register", {
    firstName: "New",
    lastName: "Dealer",
    email: "new_dealer@example.com",
    password: "Password123!",
    companyName: "Acme Switches",
    gstNumber: "27AAPFU0939F1ZV",
    contactNumber: "9876543210",
    address: "123 Market Street",
  });
  assert.equal(registerResp.status, 201, `registration must succeed, got ${registerResp.status} ${registerResp.text?.slice(0, 300)}`);
  assert.equal(registerResp.data.role, "dealer");
  pass("POST /api/admin/register (no session) succeeds instead of throwing TenantScopeViolationError");

  // ═══ 2. The new dealer is stamped with the default ("whyte-automations") company's id ═══
  const saved = await db.collection("adminusers").findOne({ email: "new_dealer@example.com" });
  assert.ok(saved, "the new dealer must be persisted");
  assert.equal(saved.companyId, 1, "the new dealer must be stamped with the default company's id, not left unset");
  pass("the newly registered dealer is stamped with the default company's companyId");

  // ═══ 3. Duplicate email is still rejected — globally, not just within one company ═══
  const dupeResp = await api("", "POST", "/api/admin/register", {
    firstName: "Another",
    lastName: "Dealer",
    email: "new_dealer@example.com",
    password: "Password123!",
    companyName: "Someone Else Inc",
    gstNumber: "27AAPFU0939F1ZV",
    contactNumber: "9876500000",
    address: "456 Other Street",
  });
  assert.equal(dupeResp.status, 409, "a duplicate email must still be rejected (checked unscoped, across every company)");
  pass("duplicate-email rejection still works correctly now that the check runs unscoped");

  // ═══ 4. The new dealer can actually log in and is scoped to their company ═══
  const dealerLogin = await login("new_dealer@example.com", "user");
  const dealerSelf = await api(dealerLogin, "GET", "/api/dealer/profile");
  assert.equal(dealerSelf.status, 200, "the newly registered dealer must be able to log in and use their session");
  pass("the newly registered dealer can log in and use the resulting session normally");

  console.log(`\nPhase 1 public registration PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
