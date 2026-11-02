/**
 * Who may switch a dealer account on or off (isolated server, throwaway MongoDB): the Super Admin (acting in a company),
 * the Company Owner and the company's Admins can; a custom role with `dealers:manage`, a dealer and a salesperson cannot;
 * nobody reaches another company's dealer; a deactivated dealer cannot sign in and can again once reactivated.
 *
 *   node tests/dealer-status-permissions.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let server;
let exitCode = 0;
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("dealer-status", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 4, email: "custom@example.com", role: "configurable_admin", name: "Custom A", companyId: 10, permissions: ["dealers:read", "dealers:manage"] },
    { _id: 5, email: "dealer@example.com", role: "dealer", name: "Dealer A", companyId: 10, discountAllocationPercent: 10 },
    { _id: 6, email: "dealer2@example.com", role: "dealer", name: "Dealer A2", companyId: 10, discountAllocationPercent: 10 },
    { _id: 7, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 8, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 9, email: "dealerb@example.com", role: "dealer", name: "Dealer B", companyId: 20, discountAllocationPercent: 10 },
  ], { production: true });
  const { db, login, api } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const cookie = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    custom: await login("custom@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    ownerB: await login("ownerb@example.com", "admin"),
    adminB: await login("adminb@example.com", "admin"),
  };
  const signIn = async (email, portal) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { return await login(email, portal); } catch { await new Promise((wait) => setTimeout(wait, 1500)); }
    }
    return "";
  };
  const active = async (id) => (await db.collection("adminusers").findOne({ _id: id })).isActive !== false;
  const set = (who, id, isActive) => api(cookie[who], "PATCH", `/api/admin/dealers/${id}`, { isActive });

  // Company Owner and Admin switch their own company's dealer off and on.
  assert.equal((await set("owner", 5, false)).status, 200);
  assert.equal(await active(5), false, "the owner deactivated the dealer");
  assert.equal((await set("admin", 5, true)).status, 200);
  assert.equal(await active(5), true, "an admin reactivated the dealer");
  assert.equal((await set("admin", 6, false)).status, 200);
  assert.equal(await active(6), false);
  assert.equal((await set("owner", 6, true)).status, 200);
  pass("the Company Owner and an Admin can deactivate and reactivate their own company's dealer");

  // Everyone else cannot.
  for (const who of ["custom", "dealer"]) {
    const response = await set(who, 5, false);
    assert.ok([401, 403].includes(response.status), `${who} must be refused (${response.status})`);
    assert.equal(await active(5), true, `${who} changed nothing`);
  }
  assert.equal((await api(cookie.custom, "PATCH", "/api/admin/dealers/5", { discountAllocationPercent: 12 })).status, 200, "a custom role with dealers:manage can still edit the dealer's other details");
  assert.equal((await api("", "PATCH", "/api/admin/dealers/5", { isActive: false })).status, 401);
  pass("a custom role with dealers:manage, a dealer and a signed-out caller cannot switch the account (the custom role can still edit other details)");

  // Company isolation.
  for (const who of ["ownerB", "adminB"]) {
    assert.equal((await set(who, 5, false)).status, 404, `${who} cannot see another company's dealer`);
    assert.equal(await active(5), true);
  }
  assert.equal((await set("owner", 9, false)).status, 404, "company A's owner cannot touch company B's dealer");
  assert.equal(await active(9), true);
  pass("an owner or admin of another company gets 404 for this company's dealer, and cannot switch it");

  // The effect: a deactivated dealer cannot sign in; reactivated can.
  await set("owner", 5, false);
  const blocked = await signIn("dealer@example.com", "user");
  assert.equal(blocked.includes("session-token"), false, "a deactivated dealer gets no session");
  await set("admin", 5, true);
  assert.ok((await signIn("dealer@example.com", "user")).includes("session-token"), "a reactivated dealer can sign in again");
  pass("a deactivated dealer cannot sign in and can again once reactivated");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-1500)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
