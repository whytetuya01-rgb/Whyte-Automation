/**
 * An Admin can create the people who do the selling: Sales Executives and Dealers (isolated production server, throwaway
 * MongoDB). The accounts land in the Admin's own company whatever the request says; an Admin still cannot create or
 * change an Owner, another Admin or a Super Admin; the new accounts can sign in at /login; Sales Executives, Dealers and
 * signed-out callers cannot create accounts; another company's Admin cannot touch them.
 *
 *   node tests/admin-creates-users.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let server;
let exitCode = 0;
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("admin-creates", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "admin2@example.com", role: "admin", name: "Admin A2", companyId: 10 },
    { _id: 4, email: "sales@example.com", role: "sales_executive", name: "Sales A", companyId: 10 },
    { _id: 5, email: "dealer@example.com", role: "dealer", name: "Dealer A", companyId: 10, discountAllocationPercent: 10 },
    { _id: 6, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
  ], { production: true });
  const { db, login, api } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = {
    admin: await login("admin@example.com", "admin"),
    adminB: await login("adminb@example.com", "admin"),
    sales: await login("sales@example.com", "user"),
    dealer: await login("dealer@example.com", "user"),
  };
  const user = (email, extra = {}) => ({ firstName: "New", lastName: "Person", email, password: "Password123!", role: "sales_executive", ...extra });
  const dealer = (email, extra = {}) => ({ firstName: "New", lastName: "Dealer", email, password: "Password123!", contactNumber: "9876543210", ...extra });
  const stored = (email) => db.collection("adminusers").findOne({ email });

  // ── Sales Executives ──
  const made = await api(cookie.admin, "POST", "/api/admin/users", user("newsales@example.com"));
  assert.equal(made.status, 201, made.text?.slice(0, 300));
  const sales = await stored("newsales@example.com");
  assert.deepEqual([sales.role, sales.companyId], ["sales_executive", 10], "created in the Admin's own company");
  const wrongCompany = await api(cookie.admin, "POST", "/api/admin/users", user("elsewhere@example.com", { companyId: 20 }));
  assert.ok(wrongCompany.status >= 400 || (await stored("elsewhere@example.com"))?.companyId === 10, "a company in the request is refused or ignored");
  assert.notEqual((await stored("elsewhere@example.com"))?.companyId, 20, "never created in another company");
  assert.equal((await api(cookie.admin, "POST", "/api/admin/users", user("newsales@example.com"))).status >= 400, true, "the same email twice is refused");
  pass("an Admin creates a Sales Executive in their own company; another company or a repeated email is refused");

  // ── Dealers ──
  const madeDealer = await api(cookie.admin, "POST", "/api/admin/dealers", dealer("newdealer@example.com", { discountAllocationPercent: 5 }));
  assert.ok(madeDealer.status < 300, madeDealer.text?.slice(0, 300));
  const stored2 = await stored("newdealer@example.com");
  assert.deepEqual([stored2.role, stored2.companyId], ["dealer", 10]);
  assert.equal((await api(cookie.admin, "POST", "/api/admin/dealers", dealer("elsewhere-dealer@example.com", { companyId: 20 }))).status >= 400, true, "a dealer cannot be created in another company");
  assert.equal(await stored("elsewhere-dealer@example.com"), null);
  pass("an Admin creates a Dealer in their own company and cannot create one in another");

  // ── the company's own custom roles ──
  await db.collection("roledefinitions").insertMany([
    { _id: "role_a", companyId: 10, key: "site_supervisor", name: "Site Supervisor", permissions: ["catalog:read"], isSystem: false, createdAt: now, updatedAt: now },
    { _id: "role_b", companyId: 20, key: "other_only", name: "Other Only", permissions: ["catalog:read"], isSystem: false, createdAt: now, updatedAt: now },
  ]);
  const custom = await api(cookie.admin, "POST", "/api/admin/users", user("supervisor@example.com", { role: "site_supervisor" }));
  assert.equal(custom.status, 201, custom.text?.slice(0, 300));
  assert.deepEqual([(await stored("supervisor@example.com")).role, (await stored("supervisor@example.com")).companyId], ["site_supervisor", 10], "an Admin assigns the company's own custom role");
  const otherRole = await api(cookie.admin, "POST", "/api/admin/users", user("otherrole@example.com", { role: "other_only" }));
  assert.ok(otherRole.status === 403 || otherRole.status === 400, `another company's custom role is refused (${otherRole.status})`);
  assert.equal(await stored("otherrole@example.com"), null);
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/users/${sales._id}`, { role: "site_supervisor" })).status, 200, "an Admin can move a Sales Executive to a custom role");
  assert.equal((await stored("newsales@example.com")).role, "site_supervisor");
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/users/${sales._id}`, { role: "sales_executive" })).status, 200);
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/users/${sales._id}`, { role: "other_only" })).status >= 400, true, "and not to another company's");
  assert.equal((await stored("newsales@example.com")).role, "sales_executive");
  pass("an Admin assigns this company's custom roles on create and edit, and not another company's");

  // ── what an Admin still cannot create or change ──
  for (const role of ["admin", "company_owner", "super_admin", "dealer"]) {
    const refused = await api(cookie.admin, "POST", "/api/admin/users", user(`${role}-try@example.com`, { role }));
    assert.ok(refused.status === 403 || refused.status === 400, `${role} through the users API is refused (${refused.status})`);
    assert.equal(await stored(`${role}-try@example.com`), null, `no ${role} account was created`);
  }
  for (const id of [1, 3]) {
    const refused = await api(cookie.admin, "PATCH", `/api/admin/users/${id}`, { isActive: false });
    assert.equal(refused.status, 403, `the Owner or another Admin (${id}) cannot be changed by an Admin`);
  }
  assert.equal((await stored("owner@example.com")).isActive !== false, true);
  pass("an Admin cannot create an Admin, Owner, Super Admin or (through the users API) a Dealer, and cannot change the Owner or another Admin");

  // ── managing the accounts they made ──
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/users/${sales._id}`, { isActive: false })).status, 200);
  assert.equal((await stored("newsales@example.com")).isActive, false, "an Admin can deactivate a Sales Executive");
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/users/${sales._id}`, { isActive: true })).status, 200);
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/dealers/${stored2._id}`, { isActive: false })).status, 200);
  assert.equal((await stored("newdealer@example.com")).isActive, false, "an Admin can deactivate a Dealer");
  assert.equal((await api(cookie.admin, "PATCH", `/api/admin/dealers/${stored2._id}`, { isActive: true })).status, 200);
  assert.equal((await api(cookie.adminB, "PATCH", `/api/admin/users/${sales._id}`, { isActive: false })).status >= 400, true, "another company's Admin cannot");
  assert.equal((await api(cookie.adminB, "PATCH", `/api/admin/dealers/${stored2._id}`, { isActive: false })).status, 404);
  assert.equal((await stored("newsales@example.com")).isActive, true);
  pass("an Admin switches the accounts they made on and off; another company's Admin cannot reach them");

  // ── the new accounts work, and others cannot create accounts ──
  const signIn = async (email) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await login(email, "user"); } catch { await new Promise((wait) => setTimeout(wait, 1500)); }
    }
    return "";
  };
  assert.ok((await signIn("newsales@example.com")).includes("session-token"), "the new Sales Executive signs in at /login");
  assert.ok((await signIn("newdealer@example.com")).includes("session-token"), "the new Dealer signs in at /login");
  for (const who of ["sales", "dealer"]) {
    assert.ok([401, 403].includes((await api(cookie[who], "POST", "/api/admin/users", user(`by-${who}@example.com`))).status), `${who} cannot create users`);
    assert.ok([401, 403].includes((await api(cookie[who], "POST", "/api/admin/dealers", dealer(`dealer-by-${who}@example.com`))).status), `${who} cannot create dealers`);
    assert.equal(await stored(`by-${who}@example.com`), null);
  }
  assert.equal((await api("", "POST", "/api/admin/users", user("anon@example.com"))).status, 401);
  pass("the new Sales Executive and Dealer can sign in; Sales Executives, Dealers and signed-out callers cannot create accounts");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-1500)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
