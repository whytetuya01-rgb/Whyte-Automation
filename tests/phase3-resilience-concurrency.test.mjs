import assert from "node:assert/strict";
import { createRunner, startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Phase 3 review: two plan requirements that had no automated coverage.
 *
 *  A. Step 3.1 - "a quoted quotation must keep working even if the live
 *     product/variant is later deactivated, edited or removed". The item's own
 *     price/tax/label snapshot, and the quotation totals, must not move.
 *  B. Step 3.4 - "concurrent creation/duplication": bulk ID reservation must
 *     never hand the same room/item id to two requests, including when it runs
 *     alongside the single-id reservation used by add-room / add-item.
 */
const { assertCase, summary } = createRunner();
let server;

const SNAPSHOT_ITEM_FIELDS = [
  "unitPrice",
  "priceWithoutTax",
  "taxPercent",
  "taxAmount",
  "linePrice",
  "quantity",
  "variantLabel",
  "sbNumber",
];
const TOTAL_FIELDS = ["subtotal", "netSubtotal", "cgstAmount", "sgstAmount", "totalGstAmount", "grandTotal", "totalAmount", "productsCount"];

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k]]));
const uniqueCount = (xs) => new Set(xs).size;

try {
  server = await startIsolatedServer("phase3rc", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
  ]);
  const { db, login, api } = server;
  const now = new Date();
  const dec = (s) => Decimal128.fromString(s);

  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  const productBase = { type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now };
  await db.collection("products").insertMany([
    { _id: 1, name: "Switch A", code: "SW-A", sortOrder: 1, ...productBase },
    { _id: 2, name: "Switch B", code: "SW-B", sortOrder: 2, ...productBase },
    { _id: 3, name: "Switch C (resilience)", code: "SW-C", sortOrder: 3, imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg", ...productBase },
  ]);
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "SW-A-V1", config: {}, price: dec("118.00"), priceWithoutTax: dec("100.00"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 2, variantCode: "SW-B-V1", config: {}, price: dec("236.00"), priceWithoutTax: dec("200.00"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1 },
    { _id: 3, productId: 3, variantCode: "SW-C-V1", config: { series: "smart", finish: "glass" }, automationTier: "smart", surfaceFinish: "glass", price: dec("354.00"), priceWithoutTax: dec("300.00"), taxPercent: dec("18.00"), isActive: true, sortOrder: 1 },
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, name: "Bedroom", isActive: true, sortOrder: 2 },
  ]);
  await db.collection("housetypes").insertOne({ _id: 1, name: "2BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, houseTypeId: 1, roomTypeId: 1, defaultCount: 1, sortOrder: 1 },
    { _id: 2, houseTypeId: 1, roomTypeId: 2, defaultCount: 3, sortOrder: 2 },
  ]);

  const dealer = await login("dealer_a@example.com", "user");

  /* ----------------------------- B. concurrency ---------------------------- */

  let sourceId;
  let sourceRoomId;
  await assertCase("B setup (also warms every route): template create, source with 2 rooms / 3 items, one duplicate", async () => {
    const warmTemplate = await api(dealer, "POST", "/api/quotations", { clientName: "Warm", houseTypeId: 1 });
    assert.equal(warmTemplate.status, 201, warmTemplate.text);
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Source" });
    sourceId = q.data.id;
    const r1 = await api(dealer, "POST", `/api/quotations/${sourceId}/rooms`, { roomTypeId: 1, customName: "R1" });
    const r2 = await api(dealer, "POST", `/api/quotations/${sourceId}/rooms`, { roomTypeId: 2, customName: "R2" });
    sourceRoomId = r1.data.id;
    for (const [room, product, qty] of [[r1.data.id, 1, 1], [r1.data.id, 2, 2], [r2.data.id, 1, 3]]) {
      const i = await api(dealer, "POST", `/api/quotations/${sourceId}/items`, { quotationRoomId: room, productId: product, quantity: qty });
      assert.equal(i.status, 201, i.text);
    }
    const dup = await api(dealer, "POST", `/api/quotations/${sourceId}/duplicate`);
    assert.equal(dup.status, 201, dup.text);
  });

  const allIds = async (collection) => (await db.collection(collection).find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);

  await assertCase("B1: 8 concurrent template creates -> unique quotation numbers and room ids, 4 rooms each", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api(dealer, "POST", "/api/quotations", { clientName: `Burst ${i}`, houseTypeId: 1 }))
    );
    for (const r of results) assert.equal(r.status, 201, r.text);
    const numbers = results.map((r) => r.data.quotationNumber);
    assert.equal(uniqueCount(numbers), 8, `quotation numbers must be unique: ${numbers.join(",")}`);
    for (const n of numbers) assert.match(n, /^QT-\d{4}-\d{3,}$/);
    for (const r of results) {
      const rooms = await db.collection("quotationrooms").find({ quotationId: r.data.id }).sort({ sortOrder: 1 }).toArray();
      assert.deepEqual(rooms.map((x) => x.sortOrder), [10, 20, 21, 22]);
    }
    const roomIds = await allIds("quotationrooms");
    assert.equal(uniqueCount(roomIds), roomIds.length, "room ids unique across the whole collection");
  });

  await assertCase("B2: 6 concurrent duplicates -> unique ids, each an exact copy (2 rooms / 3 items)", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => api(dealer, "POST", `/api/quotations/${sourceId}/duplicate`)));
    for (const r of results) assert.equal(r.status, 201, r.text);
    assert.equal(uniqueCount(results.map((r) => r.data.quotationNumber)), 6, "duplicate quotation numbers unique");
    const roomIds = await allIds("quotationrooms");
    const itemIds = await allIds("quotationitems");
    assert.equal(uniqueCount(roomIds), roomIds.length, "room ids unique");
    assert.equal(uniqueCount(itemIds), itemIds.length, "item ids unique");
    for (const r of results) {
      const rooms = await db.collection("quotationrooms").find({ quotationId: r.data.id }).toArray();
      assert.equal(rooms.length, 2);
      const items = await db.collection("quotationitems").find({ quotationRoomId: { $in: rooms.map((x) => x._id) } }).toArray();
      assert.equal(items.length, 3);
      assert.deepEqual(items.map((i) => `${i.productId}x${i.quantity}`).sort(), ["1x1", "1x3", "2x2"]);
    }
  });

  await assertCase("B3: mixed burst (duplicates + template creates + single add-room + single add-item) -> no collisions, counters stay ahead", async () => {
    const calls = [
      ...Array.from({ length: 4 }, () => api(dealer, "POST", `/api/quotations/${sourceId}/duplicate`)),
      ...Array.from({ length: 4 }, (_, i) => api(dealer, "POST", "/api/quotations", { clientName: `Mixed ${i}`, houseTypeId: 1 })),
      ...Array.from({ length: 6 }, () => api(dealer, "POST", `/api/quotations/${sourceId}/items`, { quotationRoomId: sourceRoomId, productId: 2, quantity: 1 })),
      ...Array.from({ length: 3 }, (_, i) => api(dealer, "POST", `/api/quotations/${sourceId}/rooms`, { roomTypeId: 2, customName: `Extra ${i}` })),
    ];
    const results = await Promise.all(calls);
    for (const r of results) assert.equal(r.status, 201, r.text);
    const roomIds = await allIds("quotationrooms");
    const itemIds = await allIds("quotationitems");
    assert.equal(uniqueCount(roomIds), roomIds.length, "room ids unique after mixed burst");
    assert.equal(uniqueCount(itemIds), itemIds.length, "item ids unique after mixed burst");
    const counters = Object.fromEntries((await db.collection("counters").find({}).toArray()).map((c) => [c._id, c.seq]));
    assert.ok(counters.quotationRoom >= Math.max(...roomIds), `quotationRoom counter ${counters.quotationRoom} must be >= max room id ${Math.max(...roomIds)}`);
    assert.ok(counters.quotationItem >= Math.max(...itemIds), `quotationItem counter ${counters.quotationItem} must be >= max item id ${Math.max(...itemIds)}`);
  });

  /* ------------------------------ A. resilience ---------------------------- */

  let quotationId;
  let before;
  const getQuotation = async () => {
    const res = await api(dealer, "GET", `/api/quotations/${quotationId}`);
    assert.equal(res.status, 200, res.text);
    return res.data;
  };

  await assertCase("A setup: quote one item of product 3 (tier+finish variant, qty 2)", async () => {
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Resilience Client" });
    quotationId = q.data.id;
    const room = await api(dealer, "POST", `/api/quotations/${quotationId}/rooms`, { roomTypeId: 1, customName: "R" });
    const item = await api(dealer, "POST", `/api/quotations/${quotationId}/items`, { quotationRoomId: room.data.id, productId: 3, productVariantId: 3, quantity: 2 });
    assert.equal(item.status, 201, item.text);
    before = await getQuotation();
    const it = before.rooms[0].items[0];
    assert.equal(it.unitPrice, "354.00");
    assert.equal(typeof it.variantLabel, "string", "snapshot variantLabel must exist for this to be a meaningful test");
    assert.equal(it.productVariant.id, 3);
    assert.ok(before.totalAmount > 0);
  });

  const assertSnapshotUnchanged = async (label) => {
    const now = await getQuotation();
    const a = before.rooms[0].items[0];
    const b = now.rooms[0].items[0];
    assert.deepEqual(pick(b, SNAPSHOT_ITEM_FIELDS), pick(a, SNAPSHOT_ITEM_FIELDS), `${label}: item price/tax/label snapshot must not move`);
    assert.deepEqual(b.variantConfig ?? null, a.variantConfig ?? null, `${label}: variantConfig snapshot must not move`);
    assert.deepEqual(pick(now, TOTAL_FIELDS), pick(before, TOTAL_FIELDS), `${label}: quotation totals must not move`);
    return now;
  };

  await assertCase("A1: variant deactivated + repriced + product renamed/deactivated -> snapshot and totals unchanged", async () => {
    await db.collection("productvariants").updateOne({ _id: 3 }, { $set: { isActive: false, price: dec("999.00"), priceWithoutTax: dec("846.61") } });
    await db.collection("products").updateOne({ _id: 3 }, { $set: { name: "Renamed later", isActive: false } });
    const now = await assertSnapshotUnchanged("deactivated/edited");
    assert.equal(now.rooms[0].items[0].productVariant.id, 3, "a merely deactivated variant is still referenced");
  });

  await assertCase("A2: variant document removed -> still 200, snapshot and totals unchanged, productVariant is null", async () => {
    await db.collection("productvariants").deleteOne({ _id: 3 });
    const now = await assertSnapshotUnchanged("variant removed");
    assert.equal(now.rooms[0].items[0].productVariant ?? null, null);
  });

  await assertCase("A3: product document removed -> still 200, snapshot and totals unchanged, product absent", async () => {
    await db.collection("products").deleteOne({ _id: 3 });
    const now = await assertSnapshotUnchanged("product removed");
    assert.equal(now.rooms[0].items[0].product ?? null, null);
  });

  await assertCase("A4: PATCH (project details) on a quotation with orphaned references still succeeds and totals hold", async () => {
    const res = await api(dealer, "PATCH", `/api/quotations/${quotationId}`, { clientName: "Renamed Client" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.data.clientName, "Renamed Client");
    assert.deepEqual(pick(res.data, TOTAL_FIELDS), pick(before, TOTAL_FIELDS));
    assert.equal(res.data.rooms[0].items[0].unitPrice, "354.00");
  });

  if (summary() > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
