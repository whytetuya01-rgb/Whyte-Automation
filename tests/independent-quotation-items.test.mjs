/**
 * Independent quotation item entries over real HTTP (isolated production server + throwaway local Mongo): two entries of
 * the same product / variant in one room get their own ids and stay independent when updated, re-priced, deleted and
 * cloned, and the room / quotation totals always equal the sum of the entries.
 *
 *   node tests/independent-quotation-items.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer(
    "independent-items",
    [
      { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20, companyId: 1 },
      { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 20, companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Company 1", slug: "company-1", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 1, companyId: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("products").insertOne({ _id: 1, companyId: 1, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  const variant = (id, code, price, config) => ({ _id: id, companyId: 1, productId: 1, variantCode: code, config, price: Decimal128.fromString(price), priceWithoutTax: Decimal128.fromString(price), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: id });
  await db.collection("productvariants").insertMany([variant(1, "SW-BLACK", "1000.00", { finish: "black" }), variant(2, "SW-WHITE", "1800.00", { finish: "white" })]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealer = await login("dealer_a@example.com", "user");
  const otherDealer = await login("dealer_b@example.com", "user");

  const created = await api(dealer, "POST", "/api/quotations", { clientName: "Independent Items Client" });
  assert.equal(created.status, 201);
  const qid = created.data.id ?? created.data._id;
  const living = (await api(dealer, "POST", `/api/quotations/${qid}/rooms`, { roomTypeId: 1, sortOrder: 0 })).data;
  const bedroom = (await api(dealer, "POST", `/api/quotations/${qid}/rooms`, { roomTypeId: 2, sortOrder: 1 })).data;
  const livingId = living.id ?? living._id;
  const bedroomId = bedroom.id ?? bedroom._id;
  const add = (roomId, body) => api(dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomId, productId: 1, productVariantId: 1, ...body });
  const getQuotation = async (id = qid, cookie = dealer) => (await api(cookie, "GET", `/api/quotations/${id}`)).data;
  const stored = (roomId) => db.collection("quotationitems").find({ quotationRoomId: roomId, isDeleted: { $ne: true } }).sort({ _id: 1 }).toArray();

  // 1. every Add is its own entry with its own id
  const a = await add(livingId, { quantity: 2, notes: "Entrance wall" });
  const b = await add(livingId, { quantity: 1, notes: "Bedside" });
  const c = await add(livingId, { quantity: 4 });
  for (const response of [a, b, c]) assert.equal(response.status, 201);
  const ids = [a, b, c].map((r) => r.data.id ?? r.data._id);
  assert.equal(new Set(ids).size, 3, "three Add calls returned three different item ids");
  const rows = await stored(livingId);
  assert.equal(rows.length, 3, "three separate quotation items are stored");
  assert.ok(rows.every((r) => r.productId === 1 && r.productVariantId === 1), "all three reference the same product and variant");
  assert.deepEqual(rows.map((r) => r.quantity), [2, 1, 4]);
  assert.deepEqual(rows.map((r) => r.notes), ["Entrance wall", "Bedside", null]);
  assert.equal(await db.collection("products").countDocuments({}), 1, "the catalog was not duplicated");
  pass("three Add calls for the same product and variant create three separate items with their own ids, quantities and locations");

  // 2. totals are the sum of the entries
  let quotation = await getQuotation();
  const livingRoom = (r) => quotation.rooms.find((room) => Number(room.id) === r);
  assert.equal(livingRoom(livingId).items.length, 3, "the quotation returns three lines for the room");
  assert.equal(Number(quotation.subtotal), 7000, "subtotal = (2 + 1 + 4) x 1000");
  assert.equal(Number(quotation.grandTotal), 8260, "grand total = 7000 + 18% GST");
  pass("the room lines and the quotation totals add up all three entries (7 units, 7000 net, 8260 with GST)");

  // 3. updating one entry touches only that entry
  const [id1, id2, id3] = ids;
  const patch = (id, body) => api(dealer, "PATCH", `/api/quotations/${qid}/items/${id}`, body);
  assert.equal((await patch(id1, { quantity: 5, notes: "Hall" })).status, 200);
  let after = await stored(livingId);
  assert.deepEqual(after.map((r) => r.quantity), [5, 1, 4], "only the first entry's quantity changed");
  assert.deepEqual(after.map((r) => r.notes), ["Hall", "Bedside", null], "only the first entry's location changed");
  pass("changing the quantity and location of one entry leaves the other entries untouched");

  // 4. changing the variant of one entry re-prices only that entry (its own price / tax snapshot)
  const changed = await patch(id2, { productId: 1, productVariantId: 2 });
  assert.equal(changed.status, 200, `variant change -> ${changed.status} ${JSON.stringify(changed.json)?.slice(0, 200)}`);
  after = await stored(livingId);
  assert.deepEqual(after.map((r) => r.productVariantId), [1, 2, 1], "only the second entry moved to the white variant");
  assert.deepEqual(after.map((r) => Number(r.unitPrice.toString())), [1000, 1800, 1000], "only the second entry carries the new price");
  quotation = await getQuotation();
  assert.equal(Number(quotation.subtotal), 5 * 1000 + 1 * 1800 + 4 * 1000, "totals follow each entry's own price: 10800");
  pass("changing the variant of one entry re-prices only that entry; the totals follow (10800)");

  // 5. deleting one entry deletes only that entry
  assert.equal((await api(dealer, "DELETE", `/api/quotations/${qid}/items/${id2}`)).status, 200);
  after = await stored(livingId);
  assert.deepEqual(after.map((r) => r._id), [id1, id3], "only the second entry was removed");
  assert.deepEqual(after.map((r) => r.quantity), [5, 4]);
  assert.deepEqual(after.map((r) => r.notes), ["Hall", null]);
  quotation = await getQuotation();
  assert.equal(livingRoom(livingId).items.length, 2);
  assert.equal(Number(quotation.subtotal), 9000, "totals after the delete: (5 + 4) x 1000");
  pass("deleting one entry removes only that quotation item; the other two keep their data and the totals drop by exactly its line");

  // 6. the same product in another room is independent too
  const d = await add(bedroomId, { quantity: 3, notes: "Reading lamp" });
  assert.equal(d.status, 201);
  const idD = d.data.id ?? d.data._id;
  assert.ok(![id1, id3].includes(idD));
  assert.equal((await patch(idD, { quantity: 6 })).status, 200);
  assert.deepEqual((await stored(livingId)).map((r) => r.quantity), [5, 4], "the living room entries did not change");
  assert.equal((await stored(bedroomId))[0].quantity, 6);
  quotation = await getQuotation();
  assert.equal(Number(quotation.subtotal), 15000, "subtotal = (5 + 4 + 6) x 1000");
  pass("the same product in another room is a separate entry: updating it leaves the first room alone");

  // 7. cloning keeps every entry separate with its own location and quantity
  const cloneRes = await api(dealer, "POST", `/api/quotations/${qid}/duplicate`, { includeRooms: true });
  assert.ok([200, 201].includes(cloneRes.status), `duplicate -> ${cloneRes.status} ${JSON.stringify(cloneRes.json)?.slice(0, 200)}`);
  const cloneId = cloneRes.data.id ?? cloneRes.data._id;
  const cloneRooms = await db.collection("quotationrooms").find({ quotationId: cloneId }).sort({ _id: 1 }).toArray();
  const cloneItems = (await Promise.all(cloneRooms.map((room) => stored(room._id)))).flat();
  assert.equal(cloneItems.length, 3, "the clone has three separate items");
  assert.equal(new Set(cloneItems.map((i) => i._id)).size, 3);
  assert.ok(cloneItems.every((i) => ![id1, id3, idD].includes(i._id)), "clone items have their own new ids");
  const sorted = (xs) => xs.map((i) => `${i.quantity}|${i.notes ?? ""}|${i.productVariantId}`).sort();
  const originals = (await Promise.all([livingId, bedroomId].map((r) => stored(r)))).flat();
  assert.deepEqual(sorted(cloneItems), sorted(originals), "quantities, locations and variants are copied entry by entry");
  const cloneQuotation = await getQuotation(cloneId);
  assert.equal(Number(cloneQuotation.subtotal), 15000, "the clone totals equal the original");
  pass("cloning copies each entry separately (new ids, same quantity, location and variant) and the totals match");

  // 8. editing the clone does not change the original, and the other dealer cannot touch the entries
  const cloneFirst = cloneItems[0];
  assert.equal((await api(dealer, "PATCH", `/api/quotations/${cloneId}/items/${cloneFirst._id}`, { quantity: 9, notes: "Changed in clone" })).status, 200);
  assert.deepEqual((await Promise.all([livingId, bedroomId].map((r) => stored(r)))).flat().map((i) => `${i.quantity}|${i.notes ?? ""}`), originals.map((i) => `${i.quantity}|${i.notes ?? ""}`), "the original entries are unchanged");
  const foreign = await api(otherDealer, "PATCH", `/api/quotations/${qid}/items/${id1}`, { quantity: 99 });
  assert.ok([403, 404].includes(foreign.status), `another dealer cannot change an entry (${foreign.status})`);
  assert.equal((await stored(livingId))[0].quantity, 5);
  pass("editing a cloned entry leaves the original entries alone; another dealer cannot change them");

  // 9. a locked quotation still refuses to add or change entries (lifecycle rules unchanged)
  await db.collection("quotations").updateOne({ _id: qid }, { $set: { status: "approved" } });
  assert.equal((await add(livingId, { quantity: 1 })).status, 403, "an approved quotation refuses a new entry");
  assert.equal((await patch(id1, { quantity: 1 })).status, 403, "and refuses a change");
  assert.deepEqual((await stored(livingId)).map((r) => r.quantity), [5, 4]);
  pass("an approved quotation still refuses new entries and changes (lifecycle lock unchanged)");

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
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
