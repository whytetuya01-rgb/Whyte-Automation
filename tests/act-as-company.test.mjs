/**
 * Super Admin "Act as company": start / state / list / exit, expiry, validation,
 * authorization, audit logging and downgraded-session handling.
 * Real HTTP against an isolated production server + throwaway Mongo.
 *
 *   node tests/act-as-company.test.mjs
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
    { _id: 2, email: "super2@example.com", role: "super_admin", name: "Super Two" },
    { _id: 3, email: "owner_a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 4, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 5, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 7, email: "super3@example.com", role: "super_admin", name: "Super Three" },
    { _id: 6, email: "cfg_a@example.com", role: "configurable_admin", name: "Cfg A", companyId: 10, permissions: ["catalog:read"] },
  ];
  server = await startIsolatedServer("act-as", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany(
    [10, 20].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: id === 10 ? "pending" : "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null,
      createdAt: now, updatedAt: now,
    }))
  );
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const c = {
    super: await login("super@example.com", "admin"),
    super2: await login("super2@example.com", "admin"),
    super3: await login("super3@example.com", "admin"),
    ownerA: await login("owner_a@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    cfgA: await login("cfg_a@example.com", "admin"),
    dealerA: await login("dealer_a@example.com", "user"),
  };
  const logs = () => db.collection("platformaccesslogs");
  const start = async (cookie, body) => {
    const res = await fetch(`${baseUrl}/api/platform/act-as`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    const pairs = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((x) => x.split(";")[0]);
    return { status: res.status, json, pairs };
  };

  const visibleUsers = async (cookie) => {
    const res = await api(cookie, "GET", "/api/admin/users?pageSize=50");
    return res.status === 200 ? res.json.data.length : 0;
  };

  // 1. unauthorized callers cannot list companies or start / read / end a session
  const startBody = { companyId: 10, reason: "test" };
  for (const who of ["ownerA", "adminA", "cfgA", "dealerA"]) {
    assert.equal((await start(c[who], startBody)).status, 403, `${who} POST act-as`);
    assert.equal((await api(c[who], "GET", "/api/platform/act-as")).status, 403, `${who} GET act-as`);
    assert.equal((await api(c[who], "DELETE", "/api/platform/act-as")).status, 403, `${who} DELETE act-as`);
    assert.equal((await api(c[who], "GET", "/api/platform/companies")).status, 403, `${who} GET companies`);
  }
  assert.equal((await start("", startBody)).status, 401);
  assert.equal((await api("", "GET", "/api/platform/companies")).status, 401);
  assert.equal((await api("", "DELETE", "/api/platform/act-as")).status, 401);
  assert.equal(await logs().countDocuments({}), 0, "no refused request wrote an audit row");
  pass("only super_admin can list companies or start / read / end a session (403 for others, 401 anonymous); nothing is logged");

  // 2. company list
  const list = await api(c.super, "GET", "/api/platform/companies");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.map((x) => [x.id, x.name, x.slug, x.status]), [[10, "Company 10", "company-10", "pending"], [20, "Company 20", "company-20", "active"]]);
  assert.deepEqual(Object.keys(list.data[0]).sort(), ["id", "name", "slug", "status"], "no other company fields are exposed");
  pass("super_admin gets the minimal company list (id, name, slug, status), pending company included");

  // 3. validation: missing/blank reason, invalid company ids
  for (const [label, body] of [
    ["missing reason", { companyId: 10 }],
    ["empty reason", { companyId: 10, reason: "" }],
    ["blank reason", { companyId: 10, reason: "    " }],
    ["reason too long", { companyId: 10, reason: "x".repeat(501) }],
    ["string company id", { companyId: "10", reason: "r" }],
    ["float company id", { companyId: 1.5, reason: "r" }],
    ["zero company id", { companyId: 0, reason: "r" }],
    ["negative company id", { companyId: -1, reason: "r" }],
    ["missing company id", { reason: "r" }],
    ["null company id", { companyId: null, reason: "r" }],
  ]) {
    const res = await start(c.super, body);
    assert.equal(res.status, 400, `${label} -> ${res.status}`);
    assert.equal(res.pairs.some((p) => p.startsWith("whyte_act_as=")), false, `${label}: no grant cookie`);
  }
  assert.equal((await start(c.super, { companyId: 999, reason: "no such company" })).status, 404, "unknown company");
  assert.equal(await logs().countDocuments({}), 0, "no failed start wrote an audit row");
  pass("blank/missing reason, malformed company ids and unknown companies are refused with no cookie and no audit row");

  // 4. start: grant cookie + audit row + state
  const ok = await start(c.super, { companyId: 10, reason: "  migration rehearsal  " });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.companyId, 10);
  assert.equal(ok.json.data.companyName, "Company 10");
  const cookiePair = ok.pairs.find((p) => p.startsWith("whyte_act_as="));
  assert.ok(cookiePair, "act-as cookie issued");
  const acting = `${c.super}; ${cookiePair}`;
  const rows = await logs().find({}).toArray();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].superAdminUserId, rows[0].companyId, rows[0].reason, rows[0].endedAt], [1, 10, "migration rehearsal", null]);
  assert.ok(rows[0].startedAt instanceof Date);
  const state = await api(acting, "GET", "/api/platform/act-as");
  assert.equal(state.data.actingAsCompany, true);
  assert.equal(state.data.companyName, "Company 10");
  assert.equal(state.data.reason, "migration rehearsal");
  const expiresMs = new Date(state.data.expiresAt).getTime() - rows[0].startedAt.getTime();
  assert.equal(expiresMs, 4 * 60 * 60 * 1000, "expiry is start + 4h");
  pass("start writes exactly one audit row (user, company, trimmed reason, startedAt) and reports state with reason + expiry");

  // 5. the grant is bound to the super admin who started it
  const stolen = `${c.super2}; ${cookiePair}`;
  assert.equal((await api(stolen, "GET", "/api/platform/act-as")).data.actingAsCompany, false, "another super admin cannot use the cookie");
  pass("a grant cookie is useless to any other Super Admin");

  // 6. context actually applies to company-scoped APIs
  assert.ok((await visibleUsers(acting)) >= 4, "with the grant, the company's accounts are visible");
  assert.equal(await visibleUsers(c.super), 0, "without a grant, no company data is visible");
  pass("company-scoped APIs work with the grant and are refused without it");

  // 7. exit
  const exit = await fetch(`${baseUrl}/api/platform/act-as`, { method: "DELETE", headers: { Cookie: acting } });
  assert.equal(exit.status, 200);
  const cleared = exit.headers.getSetCookie().find((x) => x.startsWith("whyte_act_as="));
  assert.ok(cleared && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cleared), "cookie cleared");
  const endedRow = await logs().findOne({ _id: rows[0]._id });
  assert.ok(endedRow.endedAt instanceof Date, "audit row closed");
  assert.equal((await api(acting, "GET", "/api/platform/act-as")).data.actingAsCompany, false, "the old cookie no longer grants anything");
  assert.equal(await visibleUsers(acting), 0, "after exit the old cookie shows no company data");
  assert.equal((await api(c.super, "DELETE", "/api/platform/act-as")).status, 200, "exit with no active session is safe");
  pass("exit clears the cookie, closes the audit row and the old cookie is dead; exiting twice is safe");

  // 8. expiry (server side) even though the browser still sends the cookie
  const again = await start(c.super, { companyId: 20, reason: "expiry check" });
  const againCookie = again.pairs.find((p) => p.startsWith("whyte_act_as="));
  const acting2 = `${c.super}; ${againCookie}`;
  assert.equal((await api(acting2, "GET", "/api/platform/act-as")).data.actingAsCompany, true);
  await logs().updateOne({ _id: againCookie.split("=")[1] }, { $set: { startedAt: new Date(Date.now() - (4 * 60 * 60 * 1000 + 60 * 1000)) } });
  assert.equal((await api(acting2, "GET", "/api/platform/act-as")).data.actingAsCompany, false, "expired grant is not honored");
  assert.equal(await visibleUsers(acting2), 0, "expired grant gives no company data");
  assert.equal((await api(acting2, "POST", "/api/admin/users", { firstName: "A", lastName: "B", email: "late@example.com", password: "Password123!", role: "sales_executive" })).status, 403);
  assert.equal(await db.collection("adminusers").countDocuments({ email: "late@example.com" }), 0);
  // 59 minutes before expiry is still valid
  await logs().updateOne({ _id: againCookie.split("=")[1] }, { $set: { startedAt: new Date(Date.now() - (4 * 60 * 60 * 1000 - 60 * 1000)) } });
  assert.equal((await api(acting2, "GET", "/api/platform/act-as")).data.actingAsCompany, true, "one minute before expiry it is still valid");
  pass("grants expire server-side at start + 4h regardless of the cookie, and an expired grant cannot write");

  // 9. starting another session closes the previous audit row (one live grant)
  const third = await start(acting2, { companyId: 10, reason: "switch company" });
  assert.equal(third.status, 200);
  const live = await logs().find({ superAdminUserId: 1, endedAt: null }).toArray();
  assert.equal(live.length, 1, "exactly one live grant after switching");
  assert.equal(live[0].companyId, 10);
  const all = await logs().find({ superAdminUserId: 1 }).toArray();
  assert.equal(all.length, 3, "history is preserved: nothing is deleted");
  pass("switching company closes the previous audit row and keeps the history");

  // 10. downgraded / deactivated users lose access immediately (API) and are bounced (pages)
  // Next may stream a layout-level redirect() inside a 200 response (meta refresh + NEXT_REDIRECT),
  // so a page "bounces" if it answers 3xx OR its body redirects to the login page and renders no panel.
  const pageStatus = async (cookie, path) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    const streamed = /NEXT_REDIRECT|http-equiv="refresh"[^>]*\/admin\/login/.test(body) && /\/admin\/login/.test(body);
    return { status: res.status, location: res.headers.get("location"), bounced: res.status >= 300 && res.status < 400 || streamed, body };
  };
  const before = await pageStatus(c.super2, "/admin/users");
  assert.equal(before.status, 200, "valid super admin reaches the admin panel");
  assert.equal(before.bounced, false);
  // super3 has never touched the server, so the in-process 30s actor cache cannot mask the DB change
  // (the real PATCH route also calls invalidateSessionActor).
  await db.collection("adminusers").updateOne({ _id: 7 }, { $set: { role: "admin", companyId: 10 } });
  assert.equal((await api(c.super3, "GET", "/api/platform/companies")).status, 401, "stale super_admin token: companies list refused");
  assert.equal((await start(c.super3, { companyId: 10, reason: "stale token" })).status, 401, "stale super_admin token: cannot start act-as");
  assert.equal((await api(c.super3, "GET", "/api/platform/act-as")).status, 401);
  const after = await pageStatus(c.super3, "/admin/users");
  assert.equal(after.bounced, true, `downgraded session must be redirected to login (status ${after.status})`);
  assert.equal(await logs().countDocuments({ superAdminUserId: 7 }), 0, "the stale token wrote no audit row");
  pass("a downgraded super admin's stale token is refused by every act-as API (401) and bounced from admin pages");


  console.log(`\nAct-as company PASSED (${results.length} checks).`);
} catch (error) {
  console.error("VERIFICATION FAILED:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
