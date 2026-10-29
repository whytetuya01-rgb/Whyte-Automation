/**
 * Dealers always belong to the company being worked in (isolated production server + throwaway local MongoDB):
 * a company admin's own company, or the company a Super Admin is acting as. A Super Admin in platform mode gets a
 * clear 403 (not a 500), asking for another company is refused with a clear 400 and creates nothing, and a dealer's
 * company can never be changed afterwards. The dealer screen no longer offers a company picker.
 *
 *   node tests/dealer-company-assignment.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  // ── static guards: no company picker, no default-company fallback ──
  const page = readFileSync(join(root, "src", "app", "admin", "(panel)", "dealers", "page.tsx"), "utf8");
  assert.ok(!/Assigned Tenant Organization \(Super Admin Control\)/.test(page) && !/payload\.companyId\s*=/.test(page), "the dealer forms neither show a company picker nor send a company id");
  assert.ok(/dealers-platform-notice/.test(page) && /disabled=\{!hasCompany\}/.test(page), "platform mode explains why dealers cannot be added");
  const route = readFileSync(join(root, "src", "app", "api", "admin", "dealers", "route.ts"), "utf8");
  assert.ok(!/DEFAULT_COMPANY_SLUG|\?\? 1/.test(route), "no silent fallback to the default company or to id 1");
  pass("static guards: no company picker in the dealer forms, no default-company fallback in the API");

  server = await startIsolatedServer("dealer-company", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admina@example.com", role: "admin", name: "Admin A", companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  const company = (id, slug) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, isDeleted: false, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([company(1, "whyte-automations"), company(10, "alpha"), company(20, "beta")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const superCookie = await login("super@example.com", "admin");
  const adminA = await login("admina@example.com", "admin");
  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: superCookie }, body: JSON.stringify({ companyId: 20, reason: "dealer assignment test" }) });
  assert.equal(act.status, 200, await act.text());
  const actingAsBeta = [superCookie, ...act.headers.getSetCookie().map((cookie) => cookie.split(";")[0])].join("; ");

  let n = 0;
  const dealer = (extra = {}) => {
    n += 1;
    return { firstName: "Dealer", lastName: `No ${n}`, email: `dealer${n}@example.com`, password: "Password123!", contactNumber: "9876543210", ...extra };
  };
  const stored = (email) => db.collection("adminusers").findOne({ email });
  const create = (cookie, body) => api(cookie, "POST", "/api/admin/dealers", body);

  // ── creation ──
  const inPlatform = dealer();
  let res = await create(superCookie, inPlatform);
  assert.equal(res.status, 403, `platform mode: ${res.text.slice(0, 200)}`);
  assert.match(res.json?.error?.message ?? "", /Act as company/);
  assert.equal(await stored(inPlatform.email), null);
  const elsewhere = dealer({ companyId: 10 });
  res = await create(actingAsBeta, elsewhere);
  assert.equal(res.status, 400, `another company while acting: ${res.text.slice(0, 200)}`);
  assert.equal(res.json?.error?.field, "companyId");
  assert.equal(await stored(elsewhere.email), null);
  const acting = dealer();
  assert.ok((await create(actingAsBeta, acting)).status < 300);
  assert.equal((await stored(acting.email)).companyId, 20, "created in the company being acted as");
  const sameCompany = dealer({ companyId: 20 });
  assert.ok((await create(actingAsBeta, sameCompany)).status < 300, "naming the active company is accepted");
  const adminOther = dealer({ companyId: 20 });
  res = await create(adminA, adminOther);
  assert.equal(res.status, 400, "a company admin cannot add dealers to another company");
  assert.equal(await stored(adminOther.email), null);
  const adminOwn = dealer();
  assert.ok((await create(adminA, adminOwn)).status < 300);
  assert.equal((await stored(adminOwn.email)).companyId, 10);
  pass("dealers are created only in the active company; platform mode gets a clear 403 and other companies a clear 400, with nothing created");

  // ── a dealer's company never changes ──
  const betaDealer = await stored(acting.email);
  const patch = (cookie, body) => api(cookie, "PATCH", `/api/admin/dealers/${betaDealer._id}`, body);
  res = await patch(actingAsBeta, { companyId: 10 });
  assert.equal(res.status, 400, res.text.slice(0, 200));
  assert.equal(res.json?.error?.field, "companyId");
  assert.equal((await stored(acting.email)).companyId, 20, "the dealer stays in its company");
  res = await patch(actingAsBeta, { companyId: 20, firstName: "Renamed" });
  assert.ok(res.status < 300, `same company is a no-op: ${res.text.slice(0, 200)}`);
  const after = await stored(acting.email);
  assert.deepEqual([after.companyId, after.firstName], [20, "Renamed"], "other edits still apply");
  pass("a dealer's company cannot be changed (clear 400, dealer untouched); resending its own company is a harmless no-op");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-2500)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
