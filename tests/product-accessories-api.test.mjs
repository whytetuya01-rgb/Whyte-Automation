/**
 * Suggested accessories through the real API (production-mode server + throwaway local MongoDB): a product lists up to 20
 * other products of its own company; the options endpoint finds them; and adding a product to a quotation never adds its
 * accessories by itself.
 *
 *   node tests/product-accessories-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);

try {
  server = await startIsolatedServer("accessories", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "viewer@example.com", role: "configurable_admin", name: "Viewer", permissions: ["catalog:read"], companyId: 20 },
    { _id: 4, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  await db.collection("categories").insertMany([
    { _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now },
    { _id: 301, companyId: 30, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now },
  ]);
  for (const [cid, base] of [[20, 200], [30, 300]]) {
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
  }
  const product = (id, companyId, name, extra = {}) => ({ _id: id, companyId, name, code: `P-${id}`, type: "accessory", categoryId: companyId === 20 ? 201 : 301, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("products").insertMany([
    product(2001, 20, "Smart Switch", { type: "switch_board" }),
    product(2002, 20, "Switch Frame"),
    product(2003, 20, "Remote Controller"),
    product(2004, 20, "Retired Cover", { isActive: false }),
    product(3001, 30, "Beta Frame"),
    ...Array.from({ length: 22 }, (_, i) => product(2100 + i, 20, `Bulk Accessory ${i}`)),
  ]);
  const variant = (id, companyId, productId, code) => ({ _id: id, companyId, productId, variantCode: code, config: {}, price: dec("100.00"), priceWithoutTax: dec("84.75"), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertMany([variant(1, 20, 2001, "SW"), variant(2, 20, 2002, "FR"), variant(3, 20, 2003, "RC"), variant(4, 30, 3001, "BF")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = { a: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), viewer: await login("viewer@example.com", "admin"), b: await login("ownerb@example.com", "admin") };
  const patch = (c, id, body) => api(c, "PATCH", `/api/products/${id}`, body);
  const stored = (id) => db.collection("products").findOne({ _id: id });

  // ═══ saving ═══
  const set = await patch(cookie.a, 2001, { accessoryIds: [2002, 2003] });
  assert.equal(set.status, 200, set.text?.slice(0, 300));
  assert.deepEqual(set.data.accessoryIds, [2002, 2003]);
  assert.deepEqual((await stored(2001)).accessoryIds, [2002, 2003]);
  assert.deepEqual((await api(cookie.a, "GET", "/api/products/2001")).data.accessoryIds, [2002, 2003]);
  assert.deepEqual((await api(cookie.a, "GET", "/api/products/2002")).data.accessoryIds, [], "a product with none reads as an empty list");
  assert.equal((await patch(cookie.a, 2001, { notes: "unrelated" })).status, 200);
  assert.deepEqual((await stored(2001)).accessoryIds, [2002, 2003], "editing something else leaves the list alone");
  const reordered = await patch(cookie.a, 2001, { accessoryIds: [2003, 2002, 2004] });
  assert.deepEqual(reordered.data.accessoryIds, [2003, 2002, 2004], "order is kept; an inactive product may be listed (it is simply not suggested)");
  const cleared = await patch(cookie.a, 2001, { accessoryIds: [] });
  assert.deepEqual([cleared.status, (await stored(2001)).accessoryIds], [200, []]);
  await patch(cookie.a, 2001, { accessoryIds: [2002] });
  pass("a product saves, reorders and clears its suggested accessories; unrelated edits leave them alone");

  // ═══ refusals ═══
  const before = JSON.stringify(await stored(2001));
  for (const [label, ids, field] of [
    ["itself", [2001], "accessoryIds"],
    ["another company's product", [3001], "accessoryIds"],
    ["a product that does not exist", [999999], "accessoryIds"],
  ]) {
    const response = await patch(cookie.a, 2001, { accessoryIds: ids });
    assert.equal(response.status, 400, `${label}: ${response.text?.slice(0, 200)}`);
    assert.equal(response.json.error.field, field, label);
  }
  assert.equal((await patch(cookie.a, 2001, { accessoryIds: [2002, 2002] })).status, 400, "the same one twice");
  assert.equal((await patch(cookie.a, 2001, { accessoryIds: Array.from({ length: 21 }, (_, i) => 2100 + i) })).status, 400, "21 are refused");
  assert.equal((await patch(cookie.a, 2001, { accessoryIds: ["abc"] })).status, 400);
  assert.equal((await patch(cookie.a, 2001, { accessoryIds: null })).status, 400);
  const twenty = await patch(cookie.a, 2001, { accessoryIds: Array.from({ length: 20 }, (_, i) => 2100 + i) });
  assert.equal(twenty.status, 200, "exactly 20 is fine");
  await patch(cookie.a, 2001, { accessoryIds: [2002] });
  assert.equal(JSON.stringify(await stored(2001)).includes('"accessoryIds":[2002]'), true);
  assert.equal(before.includes('"accessoryIds":[2002]'), true, "refused requests changed nothing");
  assert.equal((await patch(cookie.b, 2001, { accessoryIds: [3001] })).status, 404, "another company cannot touch the product");
  assert.equal((await patch(cookie.viewer, 2001, { accessoryIds: [2003] })).status, 403, "a read-only role cannot");
  assert.equal((await patch(cookie.dealer, 2001, { accessoryIds: [2003] })).status, 403, "nor a dealer");
  assert.deepEqual((await stored(2001)).accessoryIds, [2002]);
  pass("itself, another company's product, a missing product, repeats, 21, non-ids and null are refused (20 is fine); other companies, read-only roles and dealers cannot change them");

  // ═══ creating ═══
  const created = await api(cookie.a, "POST", "/api/products", { name: "New Switch", categoryId: 201, type: "switch_board", accessoryIds: [2002, 2003], variants: [{ variantCode: "NEW1", price: 500 }] });
  assert.equal(created.status, 201, created.text?.slice(0, 300));
  assert.deepEqual(created.data.accessoryIds, [2002, 2003]);
  const bad = await api(cookie.a, "POST", "/api/products", { name: "Bad Switch", categoryId: 201, type: "switch_board", accessoryIds: [3001], variants: [{ variantCode: "BAD1", price: 500 }] });
  assert.equal(bad.status, 400);
  assert.equal(await db.collection("products").countDocuments({ name: "Bad Switch" }), 0, "nothing was created");
  pass("a new product can be created with accessories, and one with another company's product is refused without creating anything");

  // ═══ the options endpoint ═══
  const options = (c, query) => api(c, "GET", `/api/catalog/accessory-options${query}`);
  const found = await options(cookie.a, "?search=frame");
  assert.deepEqual(found.data.map((o) => o.name), ["Switch Frame"], "by name, this company's only");
  assert.deepEqual(Object.keys(found.data[0]).sort(), ["code", "id", "imageUrl", "isActive", "name"], "names and pictures only: no prices");
  assert.deepEqual((await options(cookie.a, "?search=P-2003")).data.map((o) => o.id), [2003], "or by code");
  assert.deepEqual((await options(cookie.a, "?search=retired")).data, [], "inactive products are not offered");
  assert.deepEqual((await options(cookie.a, "?ids=2002,2004")).data.map((o) => o.id).sort(), [2002, 2004], "by id (to name what is already chosen), inactive ones included");
  assert.deepEqual((await options(cookie.a, "?ids=3001")).data, [], "never another company's");
  assert.deepEqual((await options(cookie.b, "?search=frame")).data.map((o) => o.name), ["Beta Frame"], "company B sees only its own");
  assert.equal((await options(cookie.a, "?search=.*")).data.length, 0, "a search is text, not a pattern");
  assert.ok((await options(cookie.a, "?search=bulk")).data.length <= 30);
  assert.equal((await options(cookie.a, `?ids=${Array.from({ length: 21 }, (_, i) => i + 1).join(",")}`)).status, 400);
  assert.equal((await options(cookie.viewer, "?search=frame")).status, 200, "anyone who can read the catalogue");
  assert.equal((await fetch(`${server.baseUrl}/api/catalog/accessory-options?search=frame`)).status, 401);
  pass("the options endpoint finds this company's active products by name or code (or named ones by id), shows no prices, treats the search as text, and is company-scoped");

  // ═══ never added automatically ═══
  const quotation = await api(cookie.dealer, "POST", "/api/quotations", { clientName: "Client", houseTypeId: 201 });
  assert.equal(quotation.status, 201, quotation.text?.slice(0, 300));
  const qid = quotation.data.id ?? quotation.data._id;
  const roomId = (await api(cookie.dealer, "GET", `/api/quotations/${qid}`)).data.rooms[0].id;
  const add = await api(cookie.dealer, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: roomId, productId: 2001, productVariantId: 1, quantity: 1 });
  assert.equal(add.status, 201, add.text?.slice(0, 300));
  assert.equal(await db.collection("quotationitems").countDocuments({}), 1, "adding a product that has accessories adds only that product");
  assert.deepEqual((await db.collection("quotationitems").find({}).toArray()).map((i) => i.productId), [2001]);
  pass("adding a product to a quotation never adds its accessories");

  console.log(`\nALL ${count} PRODUCT ACCESSORY API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
