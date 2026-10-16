/**
 * Reproduces a bug reported from the real dev server: GET /admin/dashboard
 * and GET /admin/roles (and GET /login) throwing TenantScopeViolationError
 * in the server console even though the page still returned 200 (Next.js
 * swallowing a Server Component render error and serving a degraded page).
 * None of the earlier Phase 1 tests actually rendered these page ROUTES
 * (only their underlying API routes), so this gap slipped through.
 *
 *   node tests/phase1-admin-pages.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "ph1-admin-pages",
    [
      { _id: 1, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api, baseUrl, getOutput } = server;
  const now = new Date();

  await db.collection("companies").insertOne({ _id: 1, name: "Company A", slug: "company-a", status: "active", phone: "1111111111", address: "A St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });

  const ownerCookie = await login("owner_a@example.com", "admin");

  async function fetchPage(cookie, path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
    return { status: res.status, text: await res.text() };
  }

  // ═══ 1. GET /admin/dashboard renders without a server-side tenant-context error ═══
  const dashboard = await fetchPage(ownerCookie, "/admin/dashboard");
  assert.equal(dashboard.status, 200, "the dashboard page must render");
  assert.ok(!dashboard.text.includes("TenantScopeViolationError"), "the dashboard HTML must not contain a leaked TenantScopeViolationError");
  pass("GET /admin/dashboard renders without a TenantScopeViolationError");

  // ═══ 2. GET /admin/roles renders without a server-side tenant-context error ═══
  const roles = await fetchPage(ownerCookie, "/admin/roles");
  assert.equal(roles.status, 200, "the roles page must render");
  assert.ok(!roles.text.includes("TenantScopeViolationError"), "the roles HTML must not contain a leaked TenantScopeViolationError");
  pass("GET /admin/roles renders without a TenantScopeViolationError");

  // ═══ 3. The SERVER's own console output must not show the error either ═══
  // This is the actual signal the bug report was made from — Next can serve
  // a 200 with a degraded/incomplete page while still logging a thrown
  // server-side error, which a plain status/text check on the response can miss.
  const serverLog = getOutput();
  assert.ok(!serverLog.includes("TenantScopeViolationError"), `the server's own console output must never log a TenantScopeViolationError for these requests. Log tail:\n${serverLog.slice(-3000)}`);
  pass("the server's own console output contains no TenantScopeViolationError for either page");

  console.log(`\nPhase 1 admin page loaders PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
