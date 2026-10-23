/**
 * Strict tenant scope for Product / House Type / Room Type / Category APIs, real HTTP against an isolated
 * production-mode server + throwaway LOCAL Mongo (never Atlas). Pre-migration shape: Company 1 has 52 room types,
 * 0 products, 0 house types; Company 2 has data; legacy (companyId null/missing) records exist and must never be returned.
 *
 *   node tests/tenant-scope-parity.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let server, exitCode = 0, n = 0;
const pass = (m) => console.log(`  ✓ ${++n}. ${m}`);
try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "super2@example.com", role: "super_admin", name: "Super Two" },
    { _id: 3, email: "dealer1@example.com", role: "dealer", name: "Dealer 1", companyId: 1 },
    { _id: 4, email: "cfgadmin1@example.com", role: "configurable_admin", name: "Config Admin 1", companyId: 1 },
    { _id: 5, email: "admin1@example.com", role: "admin", name: "Admin 1", companyId: 1 },
    { _id: 6, email: "dealer2@example.com", role: "dealer", name: "Dealer 2", companyId: 2 },
    { _id: 7, email: "admin2@example.com", role: "admin", name: "Admin 2", companyId: 2 },
  ];
  server = await startIsolatedServer("tenant-parity", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([1, 2].map((id) => ({ _id: id, name: `Company ${id}`, slug: `company-${id}`, status: id === 1 ? "pending" : "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now })));
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const base = { isActive: true, isDeleted: false, createdAt: now, updatedAt: now };
  await db.collection("roomtypes").insertMany([
    ...Array.from({ length: 52 }, (_, i) => ({ _id: 1000 + i, companyId: 1, name: `C1 Room ${i + 1}`, icon: null, sortOrder: i, ...base })),
    ...Array.from({ length: 4 }, (_, i) => ({ _id: 2000 + i, companyId: 2, name: `C2 Room ${i + 1}`, icon: null, sortOrder: i, ...base })),
    { _id: 3000, companyId: null, name: "Legacy Room", icon: null, sortOrder: 0, ...base },
    { _id: 3001, name: "Legacy Room (missing field)", icon: null, sortOrder: 0, ...base },
  ]);
  await db.collection("categories").insertMany([
    { _id: 20, companyId: 2, name: "C2 Cat", level: 1, sortOrder: 1, ...base },
    { _id: 30, companyId: null, name: "Legacy Cat", level: 1, sortOrder: 1, ...base },
  ]);
  await db.collection("housetypes").insertMany([
    { _id: 20, companyId: 2, name: "C2 2BHK", sortOrder: 1, ...base },
    { _id: 30, companyId: null, name: "Legacy 2BHK", sortOrder: 1, ...base },
  ]);
  await db.collection("housetyperoomtemplates").insertOne({ _id: 1, companyId: 2, houseTypeId: 20, roomTypeId: 2000, quantity: 1, sortOrder: 1, ...base });
  await db.collection("products").insertMany([
    { _id: 20, companyId: 2, name: "C2 Product", description: "d", imageUrl: null, categoryId: 20, ...base },
    { _id: 30, companyId: null, name: "Legacy Product", description: "d", imageUrl: null, categoryId: 30, ...base },
  ]);

  const cookies = {};
  for (const [k, e, p] of [["super", "super@example.com", "admin"], ["super2", "super2@example.com", "admin"], ["dealer1", "dealer1@example.com", "user"], ["cfg1", "cfgadmin1@example.com", "admin"], ["admin1", "admin1@example.com", "admin"], ["dealer2", "dealer2@example.com", "user"], ["admin2", "admin2@example.com", "admin"]])
    cookies[k] = await login(e, p);
  const actAs = async (cookie, companyId) => {
    const r = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ companyId, reason: "tenant parity test" }) });
    assert.equal(r.status, 200, "act-as start");
    return `${cookie}; ${r.headers.getSetCookie().map((x) => x.split(";")[0]).find((x) => x.startsWith("whyte_act_as="))}`;
  };
  const list = async (cookie, url) => {
    const r = await api(cookie, "GET", url);
    const items = Array.isArray(r.data) ? r.data : Array.isArray(r.json) ? r.json : Array.isArray(r.data?.items) ? r.data.items : null;
    return { status: r.status, items, reason: r.json?.error?.details?.reason, r };
  };
  const ids = (items) => (items ?? []).map((x) => x.id ?? x._id);
  const URLS = { products: "/api/products", houseTypes: "/api/house-types", roomTypes: "/api/room-types", categories: "/api/categories" };
  const snap = async () => JSON.stringify(await Promise.all(["roomtypes", "housetypes", "housetyperoomtemplates", "products", "categories", "counters"].map((c) => db.collection(c).find({}).sort({ _id: 1 }).toArray())));
  const before = await snap();

  // A. Super Admin without Act as: no tenant data
  for (const [k, url] of Object.entries(URLS)) {
    const r = await list(cookies.super, url);
    assert.ok(r.status === 403 || (r.status === 200 && r.items && r.items.length === 0), `${k}: super admin w/o act-as got status ${r.status}, items ${r.items?.length}, ${r.r.text.slice(0, 200)}`);
  }
  const roomsNoAct = await list(cookies.super, URLS.roomTypes);
  assert.equal(roomsNoAct.status, 403);
  assert.equal(roomsNoAct.reason, "COMPANY_CONTEXT_REQUIRED");
  pass("Super Admin without Act as Company: products / house types / room types / categories return no tenant data (room APIs: 403 COMPANY_CONTEXT_REQUIRED)");

  // B. Company 1 contexts: 0 products, 0 house types, 52 room types
  const sa1 = await actAs(cookies.super2, 1);
  for (const [who, ck] of [["Super Admin acting as Company 1", sa1], ["Company 1 dealer", cookies.dealer1], ["Company 1 configurable admin", cookies.cfg1], ["Company 1 admin", cookies.admin1]]) {
    const p = await list(ck, URLS.products), h = await list(ck, URLS.houseTypes), r = await list(ck, URLS.roomTypes), c = await list(ck, URLS.categories);
    assert.equal(p.status, 200, `${who} products status ${p.status} ${p.r.text.slice(0, 160)}`);
    assert.equal(p.items.length, 0, `${who}: products`);
    assert.equal(h.status, 200, `${who} house types status ${h.status}`);
    assert.equal(h.items.length, 0, `${who}: house types`);
    assert.equal(r.status, 200, `${who} room types status ${r.status}`);
    assert.equal(r.items.length, 52, `${who}: room types`);
    assert.equal(c.items.length, 0, `${who}: categories`);
    assert.ok(ids(r.items).every((id) => id >= 1000 && id < 1052), `${who}: only company 1 rooms`);
  }
  pass("Company 1 (Super Admin acting as, dealer, configurable admin, admin): 0 products, 0 house types, 0 categories, exactly 52 room types, identical for all four");

  // C. Company 2 sees only its own; legacy never appears
  const sa2 = await actAs(cookies.super2, 2);
  for (const [who, ck] of [["Company 2 dealer", cookies.dealer2], ["Company 2 admin", cookies.admin2], ["Super Admin acting as Company 2", sa2]]) {
    const p = await list(ck, URLS.products), h = await list(ck, URLS.houseTypes), r = await list(ck, URLS.roomTypes), c = await list(ck, URLS.categories);
    assert.deepEqual(ids(p.items), [20], `${who}: products`);
    assert.deepEqual(ids(h.items), [20], `${who}: house types`);
    assert.deepEqual(ids(c.items), [20], `${who}: categories`);
    assert.equal(r.items.length, 4, `${who}: room types`);
    assert.ok(![...ids(p.items), ...ids(h.items), ...ids(c.items)].includes(30), `${who}: no legacy record`);
    assert.ok(!ids(r.items).some((id) => id === 3000 || id === 3001), `${who}: no legacy room type`);
  }
  pass("Company 2 users see only Company 2 data; legacy companyId-null / missing records are never returned to anyone");

  // D. cross-company by-id access
  for (const [who, ck, id] of [["company 1 -> company 2 product", cookies.dealer1, 20], ["company 1 -> legacy product", cookies.dealer1, 30], ["company 2 -> legacy product", cookies.dealer2, 30], ["super admin w/o act-as -> product", cookies.super, 20]]) {
    const r = await api(ck, "GET", `/api/products/${id}`);
    assert.ok(r.status >= 400, `${who}: expected refusal, got ${r.status}`);
  }
  assert.equal((await api(cookies.dealer2, "GET", "/api/products/20")).status, 200, "control: company 2 can read its own product by id");
  pass("cross-company and legacy by-id reads are refused (company 1 -> 2, 1/2 -> legacy, Super Admin w/o act-as); own-company read works");

  // E. no writes, no tenant violations
  assert.equal(await snap(), before, "no record, template or counter changed during any GET");
  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError/, "no tenant violation in server log");
  pass("no database write happened during the whole matrix; server log has no TenantScopeViolationError");
  console.log(`\n${n} checks passed.`);
} catch (e) {
  exitCode = 1;
  console.error("\nFAILED:", e?.stack ?? e);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1500));
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
