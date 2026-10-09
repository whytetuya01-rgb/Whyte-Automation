import assert from "node:assert/strict";
import { createRunner, startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

/**
 * Phase 3 Step 3.4: bulk sequence reservation. Creating a quotation from a
 * house-type template and duplicating a quotation now reserve their room/item
 * IDs in one block each. IDs must stay unique, and the duplicate must be an
 * exact content copy of the original.
 */
const { assertCase, summary } = createRunner();
let server;

try {
  server = await startIsolatedServer("phase3seqblock", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 30 },
  ]);
  const { db, login, api } = server;
  const now = new Date();

  await db.collection("categories").insertOne({ _id: 1, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("products").insertMany([
    { _id: 1, name: "Switch A", code: "SW-A", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2, name: "Switch B", code: "SW-B", type: "switch_board", categoryId: 1, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  await db.collection("productvariants").insertMany([
    { _id: 1, productId: 1, variantCode: "SW-A-V1", config: {}, price: Decimal128.fromString("118.00"), priceWithoutTax: Decimal128.fromString("100.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
    { _id: 2, productId: 2, variantCode: "SW-B-V1", config: {}, price: Decimal128.fromString("236.00"), priceWithoutTax: Decimal128.fromString("200.00"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1 },
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
  let templated;

  await assertCase("Create from template: rooms get unique IDs and correct sort order", async () => {
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Template Client", houseTypeId: 1 });
    assert.equal(q.status, 201, q.text);
    templated = q.data.id;
    const rooms = await db.collection("quotationrooms").find({ quotationId: templated }).sort({ sortOrder: 1 }).toArray();
    assert.equal(rooms.length, 4, "1 + 3 template rooms");
    assert.deepEqual(rooms.map((r) => r.sortOrder), [10, 20, 21, 22]);
    assert.equal(new Set(rooms.map((r) => r._id)).size, 4);
  });

  await assertCase("Single room add after bulk reservation still gets a fresh ID", async () => {
    const before = await db.collection("quotationrooms").find({}).toArray();
    const r = await api(dealer, "POST", `/api/quotations/${templated}/rooms`, { roomTypeId: 1, customName: "Extra" });
    assert.equal(r.status, 201, r.text);
    assert.ok(!before.some((x) => x._id === r.data.id), "new room id must not collide");
  });

  let sourceId;
  await assertCase("Setup: source quotation with 2 rooms / 3 items", async () => {
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Source Client" });
    sourceId = q.data.id;
    const r1 = await api(dealer, "POST", `/api/quotations/${sourceId}/rooms`, { roomTypeId: 1, customName: "R1" });
    const r2 = await api(dealer, "POST", `/api/quotations/${sourceId}/rooms`, { roomTypeId: 2, customName: "R2" });
    for (const [room, product, qty] of [[r1.data.id, 1, 1], [r1.data.id, 2, 2], [r2.data.id, 1, 3]]) {
      const i = await api(dealer, "POST", `/api/quotations/${sourceId}/items`, { quotationRoomId: room, productId: product, quantity: qty });
      assert.equal(i.status, 201, i.text);
    }
  });

  await assertCase("Duplicate: new unique IDs, content identical to original", async () => {
    const dup = await api(dealer, "POST", `/api/quotations/${sourceId}/duplicate`);
    assert.equal(dup.status, 201, dup.text);
    const dupId = dup.data.id;

    const allRooms = await db.collection("quotationrooms").find({}).toArray();
    const allItems = await db.collection("quotationitems").find({}).toArray();
    assert.equal(new Set(allRooms.map((r) => r._id)).size, allRooms.length, "room ids unique");
    assert.equal(new Set(allItems.map((i) => i._id)).size, allItems.length, "item ids unique");

    const shape = async (qid) => {
      const rooms = await db.collection("quotationrooms").find({ quotationId: qid }).sort({ sortOrder: 1, _id: 1 }).toArray();
      const out = [];
      for (const r of rooms) {
        const items = await db.collection("quotationitems").find({ quotationRoomId: r._id }).sort({ sortOrder: 1, _id: 1 }).toArray();
        out.push({
          customName: r.customName,
          roomTypeId: r.roomTypeId,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: String(i.unitPrice) })),
        });
      }
      return out;
    };
    assert.deepEqual(await shape(dupId), await shape(sourceId));
    assert.equal((await shape(dupId)).reduce((n, r) => n + r.items.length, 0), 3);
  });

  await assertCase("Duplicate of a quotation with no rooms succeeds", async () => {
    const q = await api(dealer, "POST", "/api/quotations", { clientName: "Empty Client" });
    const dup = await api(dealer, "POST", `/api/quotations/${q.data.id}/duplicate`);
    assert.equal(dup.status, 201, dup.text);
  });

  if (summary() > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
