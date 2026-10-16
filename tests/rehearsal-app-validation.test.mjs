/**
 * App-level validation against a MIGRATED rehearsal copy. Loopback only.
 *
 * The restored/migrated `whyte_rehearsal_20261015_work` database is NEVER written by this test: it is first
 * cloned (documents + index definitions) into `whyte_rehearsal_20261015_apptest`, and the Next app is pointed at
 * that clone. Logging in needs known passwords and the checks create quotations / act-as rows / registrations,
 * so those writes land in the clone only.
 *
 *   node tests/rehearsal-app-validation.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const SOURCE = "whyte_rehearsal_20261015_work";
const CLONE = "whyte_rehearsal_20261015_apptest";
assert.equal(process.env.MONGODB_URI, undefined, "MONGODB_URI must not be set");

const results = [];
const pass = (name) => { results.push(["PASS", name]); console.log(`  PASS  ${name}`); };
let server;
let exitCode = 0;

try {
  // ── clone the migrated copy ──
  const mongo = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", { serverSelectionTimeoutMS: 5000 });
  await mongo.connect();
  const src = mongo.db(SOURCE);
  const sourceBefore = {};
  for (const c of await src.listCollections({}, { nameOnly: true }).toArray()) sourceBefore[c.name] = await src.collection(c.name).countDocuments({});
  await mongo.db(CLONE).dropDatabase();
  const dst = mongo.db(CLONE);
  for (const name of Object.keys(sourceBefore)) {
    await dst.createCollection(name);
    const docs = await src.collection(name).find({}).toArray();
    for (let i = 0; i < docs.length; i += 500) await dst.collection(name).insertMany(docs.slice(i, i + 500));
    for (const idx of await src.collection(name).indexes()) {
      if (idx.name === "_id_") continue;
      const { key, name: iname, v, ...opts } = idx;
      await dst.collection(name).createIndex(key, { ...opts, name: iname });
    }
  }
  const hash = await bcrypt.hash("Password123!", 10);
  await dst.collection("adminusers").updateMany({ _id: { $in: [5, 7, 8, 12] } }, { $set: { passwordHash: hash } });
  const email = async (id) => (await dst.collection("adminusers").findOne({ _id: id })).email;
  const E = { super: await email(5), dealer: await email(7), admin: await email(8) };
  await mongo.close();

  server = await startIsolatedServer("rehearsal", [], { production: true, existingDatabase: CLONE });
  const { db, login, api, baseUrl } = server;
  assert.equal(server.dbName, CLONE);

  const co = async () => db.collection("companies").findOne({ _id: 1 });
  assert.equal((await co()).status, "pending");
  assert.equal((await co()).slug, "whyte-automations");

  const sessions = {
    super: await login(E.super, "admin"),
    admin: await login(E.admin, "admin"),
    dealer: await login(E.dealer, "user"),
  };
  const startActAs = async (reason, companyId = 1) => {
    const res = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sessions.super }, body: JSON.stringify({ companyId, reason }) });
    return { status: res.status, cookie: [sessions.super, ...res.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ") };
  };

  // ═══ 1. Login under the PENDING company ═══
  const probe = async (cookie) => (await api(cookie, "GET", "/api/products?pageSize=1")).status;
  assert.equal(await probe(sessions.super), 200);
  assert.equal(await probe(sessions.admin), 200, "company admin can use the app while the company is pending");
  assert.equal(await probe(sessions.dealer), 200, "dealer can use the app while the company is pending");
  const inactive = await login(await (async () => (await db.collection("adminusers").findOne({ _id: 22 })).email)(), "user");
  assert.equal(await probe(inactive), 401, "an inactive dealer still cannot sign in");
  pass("PENDING company: Super Admin, company Admin (id 8) and a dealer (id 7) sign in and work; an inactive dealer is refused");

  // ═══ 2. Public registration under pending / active / suspended ═══
  const reg = (n) => api("", "POST", "/api/admin/register", { firstName: "Reh", lastName: `Dealer${n}`, email: `rehearsal_dealer_${n}@example.com`, password: "Password123!", companyName: "Acme", gstNumber: "27AAPFU0939F1ZV", contactNumber: "9876543210", address: "1 Market Street" });
  const pendingReg = await reg(1);
  assert.equal(pendingReg.status, 403, `pending: registration must be closed, got ${pendingReg.status}`);
  assert.equal(await db.collection("adminusers").countDocuments({ email: "rehearsal_dealer_1@example.com" }), 0);
  pass("PENDING company: public registration is refused (403 'closed') and writes nothing");

  await db.collection("companies").updateOne({ _id: 1 }, { $set: { status: "active" } }); // CLONE only
  const activeReg = await reg(2);
  assert.equal(activeReg.status, 201, `active: registration should succeed, got ${activeReg.status} ${activeReg.text?.slice(0, 200)}`);
  const newDealer = await db.collection("adminusers").findOne({ email: "rehearsal_dealer_2@example.com" });
  assert.equal(newDealer.role, "dealer");
  assert.equal(newDealer.companyId, 1);
  const newDealerCookie = await login("rehearsal_dealer_2@example.com", "user");
  assert.equal(await probe(newDealerCookie), 200);
  assert.equal(await probe(await login(E.dealer, "user")), 200, "existing dealers unaffected by activation");
  pass("ACTIVE company: registration creates a dealer stamped companyId 1, who can sign in; existing dealers unaffected");

  const freshDealer = await login((await db.collection("adminusers").findOne({ _id: 12 })).email, "user"); // never used yet, so no cached validity
  await db.collection("companies").updateOne({ _id: 1 }, { $set: { status: "suspended" } }); // CLONE only
  const suspendedLogin = await login(E.dealer, "user");
  assert.equal(await probe(suspendedLogin), 401, "suspended: new sign-in refused");
  assert.equal(await probe(freshDealer), 401, "suspended: an already-issued session is invalidated on its next request (30s validity cache aside)");
  assert.equal((await reg(3)).status, 403);
  pass("SUSPENDED company: sign-in refused, live sessions invalidated, registration closed (safety net, not a requested state)");
  await db.collection("companies").updateOne({ _id: 1 }, { $set: { status: "pending" } });
  sessions.admin = await login(E.admin, "admin");
  sessions.dealer = await login(E.dealer, "user");

  // ═══ 3. Tenant catalog API counts ═══
  const sums = (list) => ({ products: list.length, variants: list.reduce((n, p) => n + (p.variants?.length ?? 0), 0) });
  const dbActiveProducts = await db.collection("products").countDocuments({ companyId: 1, isActive: true, isDeleted: { $ne: true } });
  const dbAllProducts = await db.collection("products").countDocuments({ companyId: 1, isDeleted: { $ne: true } });
  const dbAllVariants = await db.collection("productvariants").countDocuments({ companyId: 1, isDeleted: { $ne: true } });
  const dbActiveVariants = await db.collection("productvariants").countDocuments({ companyId: 1, isActive: true, isDeleted: { $ne: true } });
  const def = await api(sessions.admin, "GET", "/api/products");
  const all = await api(sessions.admin, "GET", "/api/products?all=true");
  assert.equal(def.status, 200);
  const defList = Array.isArray(def.data) ? def.data : def.data.products ?? def.data.items;
  const allList = Array.isArray(all.data) ? all.data : all.data.products ?? all.data.items;
  assert.equal(defList.length, dbActiveProducts, `active products via API ${defList.length} vs ${dbActiveProducts}`);
  assert.equal(allList.length, dbAllProducts);
  assert.equal(dbActiveProducts, 295);
  const apiAllVariants = sums(allList).variants;
  assert.equal(apiAllVariants, dbAllVariants, `variants via API (all) ${apiAllVariants} vs db ${dbAllVariants}`);
  const apiDefVariants = sums(defList).variants;
  const activeProductIds = (await db.collection("products").find({ companyId: 1, isActive: true, isDeleted: { $ne: true } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
  const expectedDefaultVariants = await db.collection("productvariants").countDocuments({ companyId: 1, isActive: true, isDeleted: { $ne: true }, productId: { $in: activeProductIds } });
  assert.equal(apiDefVariants, expectedDefaultVariants, `default-list variants ${apiDefVariants} vs expected ${expectedDefaultVariants}`);
  assert.equal((await api(sessions.dealer, "GET", "/api/products")).data.length ?? 0, dbActiveProducts, "dealers see the same active catalog");
  assert.equal((await api(sessions.super, "GET", "/api/products")).data.length ?? 0, 0, "Super Admin without act-as sees no company catalog");
  console.log(`      (API: ${defList.length} active products / ${allList.length} total; ${apiAllVariants} variants total, ${apiDefVariants} in the default list; db active variants ${dbActiveVariants})`);
  pass(`tenant catalog API == database for company 1: ${defList.length} active products, ${allList.length} non-deleted products, ${apiAllVariants} non-deleted variants (${apiDefVariants} active variants of active products); Super Admin sees none without act-as`);

  // ═══ 4. Admin role-escalation restrictions on migrated data ═══
  const post = (body) => api(sessions.admin, "POST", "/api/admin/users", { firstName: "Reh", lastName: "User", password: "Password123!", ...body });
  for (const role of ["admin", "Admin", "company_owner", "super_admin"]) assert.equal((await post({ email: `esc_${role}@example.com`, role })).status, 403, `company admin creating ${role}`);
  assert.equal(await db.collection("adminusers").countDocuments({ email: /^esc_/ }), 0);
  assert.equal((await api(sessions.admin, "PATCH", "/api/admin/users/9", { isActive: false })).status, 403, "company admin cannot modify another admin (id 9)");
  assert.notEqual((await api(sessions.admin, "PATCH", "/api/admin/users/7", { role: "admin" })).status, 200, "a dealer cannot be promoted");
  assert.equal((await db.collection("adminusers").findOne({ _id: 7 })).role, "dealer");
  assert.equal((await post({ email: "esc_sales@example.com", role: "sales_executive" })).status, 201, "permitted roles still work");
  assert.equal((await db.collection("adminusers").findOne({ email: "esc_sales@example.com" })).companyId, 1);
  pass("company Admin (id 8) cannot create/promote admin or touch another admin; a dealer cannot be promoted; sales_executive creation still works");

  // ═══ 5. Super Admin Act-as: start, audit, expiry, exit ═══
  const list = await api(sessions.super, "GET", "/api/platform/companies");
  assert.deepEqual(list.data.map((c) => [c.id, c.slug, c.status]), [[1, "whyte-automations", "pending"]]);
  assert.equal((await startActAs("")).status, 400, "reason required");
  assert.equal((await startActAs("x", 999)).status, 404, "unknown company");
  assert.equal((await api(sessions.admin, "GET", "/api/platform/companies")).status, 403, "company admin refused");
  const act = await startActAs("rehearsal act-as");
  assert.equal(act.status, 200);
  const actState = await api(act.cookie, "GET", "/api/platform/act-as");
  assert.equal(actState.data.actingAsCompany, true);
  assert.equal(actState.data.companyName.length > 0, true);
  const actingList = await api(act.cookie, "GET", "/api/products");
  assert.equal(actingList.data.length, dbActiveProducts, "acting as company 1 shows the company's catalog");
  const log = await db.collection("platformaccesslogs").findOne({ reason: "rehearsal act-as" });
  assert.deepEqual([log.superAdminUserId, log.companyId, log.endedAt], [5, 1, null]);
  await db.collection("platformaccesslogs").updateOne({ _id: log._id }, { $set: { startedAt: new Date(Date.now() - (4 * 3600 + 5) * 1000) } });
  assert.equal((await api(act.cookie, "GET", "/api/platform/act-as")).data.actingAsCompany, false, "expired");
  assert.equal((await api(act.cookie, "GET", "/api/products")).data.length ?? 0, 0, "expired grant shows no company data");
  const act2 = await startActAs("rehearsal exit");
  const exit = await fetch(`${baseUrl}/api/platform/act-as`, { method: "DELETE", headers: { Cookie: act2.cookie } });
  assert.equal(exit.status, 200);
  assert.ok((await db.collection("platformaccesslogs").findOne({ reason: "rehearsal exit" })).endedAt instanceof Date);
  assert.equal((await api(act2.cookie, "GET", "/api/platform/act-as")).data.actingAsCompany, false);
  pass("Act-as on migrated data: company list, validation, start + audit row, scoped catalog, server-side expiry, exit closes the audit row");

  // ═══ 6. New quotation numbering ═══
  const existing = (await db.collection("quotations").find({}, { projection: { quotationNumber: 1 } }).toArray()).map((q) => q.quotationNumber);
  const maxExisting = Math.max(...existing.map((n) => Number(n.slice(-3))));
  assert.equal(maxExisting, 54);
  const created = await Promise.all([
    api(sessions.admin, "POST", "/api/quotations", { clientName: "Rehearsal Client A" }),
    api(sessions.admin, "POST", "/api/quotations", { clientName: "Rehearsal Client B" }),
    api(sessions.dealer, "POST", "/api/quotations", { clientName: "Rehearsal Client C" }),
  ]);
  for (const r of created) assert.equal(r.status, 201, `quotation create ${r.status} ${r.text?.slice(0, 200)}`);
  const numbers = created.map((r) => r.data.quotationNumber).sort();
  assert.deepEqual(numbers, ["QT-2026-055", "QT-2026-056", "QT-2026-057"]);
  for (const n of numbers) assert.ok(!existing.includes(n));
  for (const r of created) assert.equal((await db.collection("quotations").findOne({ _id: r.data._id ?? r.data.id })).companyId, 1);
  assert.equal(await db.collection("quotations").countDocuments({}), existing.length + 3);
  const counter = await db.collection("counters").findOne({ _id: "quotationNumber_1_2026" });
  assert.equal(counter.seq, 57);
  pass("three concurrent quotation creations (admin + dealer) got 055/056/057, above every existing number, stamped company 1, counter 57");

  // the restored/migrated copy itself was never touched by the app tests
  const mongo2 = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");
  await mongo2.connect();
  for (const [name, n] of Object.entries(sourceBefore)) assert.equal(await mongo2.db(SOURCE).collection(name).countDocuments({}), n, `${SOURCE}.${name} changed`);
  assert.equal((await mongo2.db(SOURCE).collection("companies").findOne({ _id: 1 })).status, "pending");
  await mongo2.close();
  pass(`${SOURCE} was not touched by any app-level check (counts unchanged, company still pending)`);

  console.log(`\nRehearsal app-level validation: ${results.length} checks, all PASS.`);
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
