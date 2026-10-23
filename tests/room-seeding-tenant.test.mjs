/**
 * Room/house-type GET endpoints and the lazy room seeder under tenant isolation.
 * Real HTTP against an isolated production server + throwaway Mongo.
 *
 *   node tests/room-seeding-tenant.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

// how many standard room types the seeder defines (read from the source so the test cannot drift)
const seedSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "seedRoomData.ts"), "utf8");
const block = seedSrc.slice(seedSrc.indexOf("INITIAL_ROOM_TYPES"), seedSrc.indexOf("];", seedSrc.indexOf("INITIAL_ROOM_TYPES")));
const STANDARD = (block.match(/\{ name: "/g) ?? []).length;
assert.ok(STANDARD >= 20, "found the standard room types in the seeder source");

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "super2@example.com", role: "super_admin", name: "Super Two" },
    { _id: 4, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 5, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 6, email: "admin_b@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 8, email: "admin_d@example.com", role: "admin", name: "Admin D", companyId: 40 },
    { _id: 9, email: "admin_e@example.com", role: "admin", name: "Admin E", companyId: 50 },
  ];
  server = await startIsolatedServer("room-seed-tenant", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany(
    [10, 20, 40, 50].map((id) => ({
      _id: id, name: `Company ${id}`, slug: `company-${id}`, status: "active",
      phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null,
      createdAt: now, updatedAt: now,
    }))
  );
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  // company 10 and 20 start with a house type but NO room types/templates; company 40 already has its own room types
  await db.collection("housetypes").insertMany([
    { _id: 1, companyId: 10, name: "1 BHK", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: 2, companyId: 20, name: "1 BHK", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);
  await db.collection("roomtypes").insertMany(
    [101, 102, 103].map((id, i) => ({ _id: id, companyId: 40, name: `Custom ${i + 1}`, icon: null, isActive: true, sortOrder: i + 1, createdAt: now, updatedAt: now }))
  );
  await db.collection("counters").insertOne({ _id: "roomType", seq: 103 });

  const c = {
    super: await login("super@example.com", "admin"),
    super2: await login("super2@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    dealerA: await login("dealer_a@example.com", "user"),
    adminB: await login("admin_b@example.com", "admin"),
    adminD: await login("admin_d@example.com", "admin"),
    adminE: await login("admin_e@example.com", "admin"),
  };
  const snapshot = async () => ({
    roomtypes: await db.collection("roomtypes").countDocuments({}),
    templates: await db.collection("housetyperoomtemplates").countDocuments({}),
    counters: JSON.stringify(await db.collection("counters").find({}).sort({ _id: 1 }).toArray()),
  });
  const ENDPOINTS = ["/api/room-types", "/api/house-types", "/api/room-presets"];

  // 1. Super Admin WITHOUT Act as Company: controlled 403, nothing created, no tenant violation
  const before = await snapshot();
  for (const url of ENDPOINTS) {
    const res = await api(c.super, "GET", url);
    assert.equal(res.status, 403, `${url}: status`);
    assert.equal(res.json.success, false);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(res.json.error.details?.reason, "COMPANY_CONTEXT_REQUIRED", `${url}: machine-readable reason`);
    assert.match(res.json.error.message, /Act as Company/i, `${url}: tells the user what to do`);
  }
  assert.deepEqual(await snapshot(), before, "no record, template or counter was created by those GETs");
  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError/, "no tenant violation in the server log");
  pass("Super Admin without Act as Company: GET room-types / house-types / room-presets answer 403 COMPANY_CONTEXT_REQUIRED, create nothing, log no TenantScopeViolationError");

  // 2. anonymous
  for (const url of ENDPOINTS) assert.equal((await api("", "GET", url)).status, 401, `${url} anonymous`);
  pass("anonymous callers get 401");

  // 3. Super Admin ACTING AS company 10: seeds company 10 (and only company 10), all stamped with company 10
  const start = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: c.super2 }, body: JSON.stringify({ companyId: 10, reason: "room seeding test" }) });
  assert.equal(start.status, 200, "act-as start");
  const grant = start.headers.getSetCookie().map((x) => x.split(";")[0]).find((x) => x.startsWith("whyte_act_as="));
  const acting = `${c.super2}; ${grant}`;
  const first = await api(acting, "GET", "/api/room-types");
  assert.equal(first.status, 200);
  const seeded = await db.collection("roomtypes").find({ companyId: 10 }).toArray();
  assert.equal(seeded.length, STANDARD, "company 10 received exactly the standard set");
  assert.equal(new Set(seeded.map((r) => r.name.toLowerCase())).size, STANDARD, "no duplicate names");
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: { $nin: [10, 40] } }), 0, "nothing was created for any other company or without one");
  assert.ok(first.json.every((r) => seeded.some((s) => s._id === r.id)), "response only holds company 10's records");
  pass("Super Admin acting as company 10: the first GET seeds company 10 only, once per name, every record stamped with company 10");

  // 4. company admin, dealer and the acting Super Admin: idempotent, no GET-side writes after seeding
  const settled = await snapshot();
  for (const who of [c.adminA, c.dealerA, acting]) {
    for (const url of ENDPOINTS) assert.equal((await api(who, "GET", url)).status, 200, `${url}`);
  }
  assert.deepEqual(await snapshot(), settled, "repeated GETs by admin, dealer and acting Super Admin write nothing");
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: 10 }), STANDARD);
  const adminRooms = (await api(c.adminA, "GET", "/api/room-types")).json, dealerRooms = (await api(c.dealerA, "GET", "/api/room-types")).json;
  assert.deepEqual(adminRooms.map((r) => r.id).sort(), dealerRooms.map((r) => r.id).sort(), "company admin and dealer see the same company data");
  const houseTypesA = (await api(c.dealerA, "GET", "/api/house-types")).json;
  assert.equal(houseTypesA.length, 1);
  assert.ok(houseTypesA[0].roomTemplate.length > 0, "the house type got its standard room templates");
  assert.equal(await db.collection("housetyperoomtemplates").countDocuments({ houseTypeId: 1, companyId: 10 }), 5, "1 BHK templates, once");
  pass("company admin, dealer and acting Super Admin: 200, identical company data, templates seeded once, repeated GETs write nothing");

  // 5. a SECOND company is seeded independently (the old process-wide flag would have skipped it)
  const b = await api(c.adminB, "GET", "/api/room-types");
  assert.equal(b.status, 200);
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: 20 }), STANDARD, "company 20 got its own standard set");
  const aIds = new Set(adminRooms.map((r) => r.id)), bIds = new Set(b.json.map((r) => r.id));
  assert.equal([...aIds].filter((i) => bIds.has(i)).length, 0, "no room type is visible to both companies");
  assert.equal((await api(c.adminA, "GET", "/api/room-types")).json.length, STANDARD, "company 10 still sees only its own");
  assert.equal(await db.collection("housetyperoomtemplates").countDocuments({ houseTypeId: 2, companyId: { $ne: 20 } }), 0, "templates of company 20's house type belong only to company 20");
  assert.equal(await db.collection("housetyperoomtemplates").countDocuments({ companyId: 10, houseTypeId: 2 }), 0, "company 20's house type never got company 10 templates");
  pass("a second company is seeded independently and no data leaks between companies");

  // 6. a company that already has room types is left completely alone
  const d0 = await snapshot();
  const d = await api(c.adminD, "GET", "/api/room-types");
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.map((r) => r.name).sort(), ["Custom 1", "Custom 2", "Custom 3"]);
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: 40 }), 3);
  assert.equal((await snapshot()).counters, d0.counters, "no counter moved");
  pass("a company with existing room types is not seeded or changed");

  // 7. concurrent first requests for a brand-new company do not create duplicates
  const many = await Promise.all(Array.from({ length: 8 }, () => api(c.adminE, "GET", "/api/room-types")));
  assert.ok(many.every((r) => r.status === 200));
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: 50 }), STANDARD, "8 simultaneous first GETs still produce exactly one standard set");
  pass("8 concurrent first GETs for a new company produce no duplicate room types");

  // 8. existing create behaviour is unchanged
  const created = await api(c.adminA, "POST", "/api/room-types", { name: "Wine Cellar", icon: null, isActive: true, sortOrder: 99 });
  assert.equal(created.status, 201, "admin creates a room type");
  assert.equal((await api(c.adminA, "POST", "/api/room-types", { name: "Wine Cellar", icon: null, isActive: true, sortOrder: 99 })).status, 409, "duplicate name still rejected");
  assert.ok((await api(c.adminA, "GET", "/api/room-types")).json.some((r) => r.name === "Wine Cellar"));
  assert.equal((await api(c.adminB, "GET", "/api/room-types")).json.some((r) => r.name === "Wine Cellar"), false, "other company does not see it");
  assert.equal(await db.collection("roomtypes").countDocuments({ companyId: 10 }), STANDARD + 1, "the GET after the POST did not re-seed");
  pass("creating a room type, duplicate rejection and company separation still work; the seeder does not run again");

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|Unhandled|UnhandledPromiseRejection/, "no tenant violations or crashes in the whole run");
  pass("server log is free of TenantScopeViolationError for the whole run");
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1500));
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
