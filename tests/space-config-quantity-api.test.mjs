/**
 * Quotation space rename and typed item quantities through the real API (production-mode server, throwaway local
 * MongoDB). Covers: persistence, master data untouched, other quotations / clones unaffected, totals unchanged,
 * validation, locked quotations, tenant isolation, quantity limits, exact quantity semantics and pricing.
 *
 *   node tests/space-config-quantity-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "space-qty",
    [
      { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 },
      { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 20, companyId: 2 },
    ],
    { production: true }
  );
  const { db, login, api } = server;
  const now = new Date();
  await db.collection("companies").insertMany(
    [1, 2].map((id) => ({ _id: id, name: `Company ${id}`, slug: `company-${id}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now }))
  );
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, companyId: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 },
    { _id: 2, companyId: 1, houseTypeId: 1, roomTypeId: 2, defaultCount: 1, sortOrder: 2 },
  ]);
  await db.collection("products").insertOne({ _id: 1, companyId: 1, name: "Smart Switch", code: "SW-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 1, companyId: 1, productId: 1, variantCode: "SW-1-A", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealerA = await login("dealer_a@example.com", "user");
  const dealerB = await login("dealer_b@example.com", "user");

  const build = async (clientName) => {
    const created = await api(dealerA, "POST", "/api/quotations", { clientName, houseTypeId: 1 });
    assert.equal(created.status, 201, "create quotation");
    const id = created.data.id ?? created.data._id;
    const detail = (await api(dealerA, "GET", `/api/quotations/${id}`)).data;
    return { id, rooms: detail.rooms };
  };
  const detailOf = async (id, cookie = dealerA) => (await api(cookie, "GET", `/api/quotations/${id}`)).data;
  const roomPath = (qid, rid) => `/api/quotations/${qid}/rooms/${rid}`;
  const rawItems = (roomId) => db.collection("quotationitems").find({ quotationRoomId: roomId }).toArray();

  const q = await build("Rename Client");
  const other = await build("Other Client");
  const living = q.rooms.find((r) => r.roomTypeId === 1);
  const bedroom = q.rooms.find((r) => r.roomTypeId === 2);
  assert.ok(living && bedroom, "template rooms were created");

  // ═══ Part 1: rename ═══════════════════════════════════════════════
  const masterBefore = JSON.stringify(await db.collection("roomtypes").find({}).sort({ _id: 1 }).toArray());
  const templatesBefore = JSON.stringify(await db.collection("housetyperoomtemplates").find({}).sort({ _id: 1 }).toArray());
  const seeded = await api(dealerA, "POST", `/api/quotations/${q.id}/items`, { quotationRoomId: bedroom.id, productId: 1, productVariantId: 1, quantity: 3 });
  assert.equal(seeded.status, 201);
  const totalsBefore = await detailOf(q.id);

  const renamed = await api(dealerA, "PATCH", roomPath(q.id, bedroom.id), { customName: "Person A Room" });
  assert.equal(renamed.status, 200, `rename status ${renamed.status} ${renamed.text.slice(0, 200)}`);
  let after = await detailOf(q.id);
  const bedAfter = after.rooms.find((r) => r.id === bedroom.id);
  assert.equal(bedAfter.customName, "Person A Room", "the new name is returned by a fresh GET (survives refresh / reopening / Review)");
  assert.equal(bedAfter.roomTypeId, 2, "room type reference preserved");
  assert.equal(bedAfter.items.length, 1, "product assignments preserved");
  assert.equal(bedAfter.items[0].quantity, 3, "quantities preserved");
  assert.equal(after.rooms.length, totalsBefore.rooms.length, "no room created or removed");
  pass("renaming a space persists customName and keeps the room id, room type reference, products and quantities");

  assert.equal(JSON.stringify(await db.collection("roomtypes").find({}).sort({ _id: 1 }).toArray()), masterBefore, "global room types untouched");
  assert.equal(JSON.stringify(await db.collection("housetyperoomtemplates").find({}).sort({ _id: 1 }).toArray()), templatesBefore, "room templates untouched");
  const otherAfter = await detailOf(other.id);
  assert.equal(otherAfter.rooms.find((r) => r.roomTypeId === 2).customName ?? null, null, "another quotation's room is not renamed");
  pass("the global room type, room templates and every other quotation are unchanged by the rename");

  for (const key of ["subtotal", "grandTotal", "totalGst", "gstAmount", "discountAmount", "total"]) {
    if (key in totalsBefore) assert.deepEqual(after[key], totalsBefore[key], `${key} unchanged by renaming`);
  }
  assert.equal(after.productsCount, totalsBefore.productsCount);
  pass("renaming changes no price, GST, discount or total");

  for (const bad of ["", "   ", "x".repeat(121), "Bed\u0001room"]) {
    const res = await api(dealerA, "PATCH", roomPath(q.id, bedroom.id), { customName: bad });
    assert.equal(res.status, 400, `invalid name ${JSON.stringify(bad.slice(0, 12))} must be rejected, got ${res.status}`);
  }
  assert.equal((await detailOf(q.id)).rooms.find((r) => r.id === bedroom.id).customName, "Person A Room", "a rejected rename leaves the name unchanged");
  assert.equal((await api(dealerA, "PATCH", roomPath(q.id, living.id), { customName: "Parents' Bedroom" })).status, 200, "apostrophes are allowed");
  assert.equal((await api(dealerA, "PATCH", roomPath(q.id, living.id), { customName: "x".repeat(120) })).status, 200, "120 characters is allowed");
  pass("empty, whitespace, over-long and control-character names are rejected; apostrophes and 120 characters are accepted");

  const clone = await api(dealerA, "POST", `/api/quotations/${q.id}/duplicate`);
  assert.equal(clone.status, 201);
  const cloneDetail = await detailOf(clone.data.id);
  const cloneBed = cloneDetail.rooms.find((r) => r.roomTypeId === 2);
  assert.equal(cloneBed.customName, "Person A Room", "the clone starts with the same names (existing clone rule)");
  assert.notEqual(cloneBed.id, bedroom.id, "the clone has its own room record");
  assert.equal((await api(dealerA, "PATCH", roomPath(clone.data.id, cloneBed.id), { customName: "Guest Room" })).status, 200);
  assert.equal((await detailOf(q.id)).rooms.find((r) => r.id === bedroom.id).customName, "Person A Room", "renaming the clone does not touch the source");
  assert.equal((await detailOf(clone.data.id)).rooms.find((r) => r.id === cloneBed.id).customName, "Guest Room");
  pass("a cloned quotation has independent room records: renaming the clone never changes the source");

  const foreign = await api(dealerB, "PATCH", roomPath(q.id, bedroom.id), { customName: "Hacked" });
  assert.ok(foreign.status === 403 || foreign.status === 404, `another company must be refused, got ${foreign.status}`);
  assert.equal((await db.collection("quotationrooms").findOne({ _id: bedroom.id })).customName, "Person A Room");
  const anon = await api("", "PATCH", roomPath(q.id, bedroom.id), { customName: "Anon" });
  assert.equal(anon.status, 401);
  pass("tenant isolation and authentication: another company and anonymous callers cannot rename");

  const lockedQ = await build("Locked Client");
  const lockedRoom = lockedQ.rooms[0];
  for (const status of ["approved", "delivered"]) {
    await db.collection("quotations").updateOne({ _id: lockedQ.id }, { $set: { status } });
    const res = await api(dealerA, "PATCH", roomPath(lockedQ.id, lockedRoom.id), { customName: "Nope" });
    assert.equal(res.status, 403, `${status} quotation must not be renamable`);
  }
  assert.equal((await db.collection("quotationrooms").findOne({ _id: lockedRoom.id })).customName ?? null, null);
  pass("approved and delivered quotations cannot be renamed");

  // ═══ Part 3: typed quantities ═══════════════════════════════════════
  const qq = await build("Quantity Client");
  const room = qq.rooms[0];
  const add = (body) => api(dealerA, "POST", `/api/quotations/${qq.id}/items`, { quotationRoomId: room.id, productId: 1, productVariantId: 1, ...body });

  const five = await add({ quantity: 5 });
  assert.equal(five.status, 201);
  let items = await rawItems(room.id);
  assert.equal(items.length, 1, "one line item");
  assert.equal(items[0].quantity, 5, "exactly 5 units");
  assert.equal(Number(items[0].unitPrice.toString()), 1000, "price comes from the variant, not the client");
  let d = await detailOf(qq.id);
  assert.equal(d.subtotal, 5000, "subtotal reflects 5 x 1000");
  assert.equal(d.productsCount, 5);
  pass("adding with quantity 5 creates one line of exactly 5 units, priced from the variant; subtotal and count update");

  const patched = await api(dealerA, "PATCH", `/api/quotations/${qq.id}/items/${items[0]._id}`, { quantity: 8 });
  assert.equal(patched.status, 200);
  items = await rawItems(room.id);
  assert.equal(items.length, 1, "increasing the quantity never creates a duplicate line");
  assert.equal(items[0].quantity, 8);
  assert.equal((await detailOf(qq.id)).subtotal, 8000);
  assert.equal((await api(dealerA, "PATCH", `/api/quotations/${qq.id}/items/${items[0]._id}`, { quantity: 7 })).status, 200);
  assert.equal((await rawItems(room.id))[0].quantity, 7, "decrementing (the - control) still works");
  pass("raising the quantity updates the existing line (no duplicate); the + / - style PATCH still works");

  const countBefore = (await rawItems(room.id)).length;
  const snapshotBefore = JSON.stringify(await rawItems(room.id));
  for (const quantity of [2.5, -1, 1000, 99999999999, "abc", "", "1e3", null]) {
    const res = await add({ quantity });
    assert.equal(res.status, 400, `create with quantity ${JSON.stringify(quantity)} must be rejected, got ${res.status}`);
  }
  for (const quantity of [1.5, -3, 1000, "x"]) {
    const res = await api(dealerA, "PATCH", `/api/quotations/${qq.id}/items/${items[0]._id}`, { quantity });
    assert.equal(res.status, 400, `update with quantity ${JSON.stringify(quantity)} must be rejected, got ${res.status}`);
  }
  assert.equal((await rawItems(room.id)).length, countBefore, "no item created by an invalid quantity");
  assert.equal(JSON.stringify(await rawItems(room.id)), snapshotBefore, "no item changed by an invalid quantity");
  assert.equal((await add({ quantity: 999 })).status, 201, "the maximum, 999, is accepted");
  pass("decimal, negative, oversize, text, empty and null quantities are rejected without writing anything; 999 is accepted");

  const cross = await api(dealerB, "POST", `/api/quotations/${qq.id}/items`, { quotationRoomId: room.id, productId: 1, productVariantId: 1, quantity: 2 });
  assert.ok(cross.status === 403 || cross.status === 404, `another company must be refused, got ${cross.status}`);
  await db.collection("quotations").updateOne({ _id: qq.id }, { $set: { status: "approved" } });
  const lockedAdd = await add({ quantity: 2 });
  assert.equal(lockedAdd.status, 403, "an approved quotation accepts no new items");
  pass("another company and approved quotations cannot add items");

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/, "no tenant violations in the server log");
  pass("server log is free of tenant violations");
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1500));
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
