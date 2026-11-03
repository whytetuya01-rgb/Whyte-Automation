/**
 * Bulk pricing through the real API (production-mode server + throwaway local MongoDB): scope (all / categories with their
 * sub-categories / products), percent and fixed changes, rounding, preview, the stale-preview guard, history, undo, company
 * isolation, permissions, and that existing quotations never change.
 *
 *   node tests/bulk-pricing-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);
const num = (v) => (v === null || v === undefined ? null : Number(String(v)));

try {
  server = await startIsolatedServer("bulkprice", [
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
  const cat = (id, companyId, name, parentId, level) => ({ _id: id, companyId, name, level, parentId, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, 20, "Tactus", null, 1), cat(202, 20, "Tactus Switches", 201, 2), cat(203, 20, "Curtains", null, 1), cat(301, 30, "Tactus", null, 1)]);
  const product = (id, companyId, name, categoryId) => ({ _id: id, companyId, name, code: `P-${id}`, type: "switch_board", categoryId, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("products").insertMany([product(2001, 20, "Smart Switch", 202), product(2002, 20, "Touch Panel", 201), product(2003, 20, "Curtain Motor", 203), product(3001, 30, "Beta Switch", 301)]);
  const variant = (id, companyId, productId, code, price, pwt, tax) => ({ _id: id, companyId, productId, variantCode: code, config: {}, price: dec(price), ...(pwt ? { priceWithoutTax: dec(pwt) } : {}), ...(tax ? { taxPercent: dec(tax) } : {}), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: new Date(now - 86_400_000) });
  await db.collection("productvariants").insertMany([
    variant(1, 20, 2001, "SW-1", "1180.00", "1000.00", "18.00"),
    variant(2, 20, 2001, "SW-2", "999.00", "846.61", "18.00"),
    variant(3, 20, 2002, "TP-1", "5799.00", null, null), // an older price-only row
    variant(4, 20, 2003, "CM-1", "250.00", "238.10", "5.00"),
    variant(5, 20, 2003, "CM-2", "0.00", "0.00", "5.00"),
    variant(6, 30, 3001, "BS-1", "1000.00", "847.46", "18.00"),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  // an issued quotation that holds its own price snapshot
  await db.collection("quotationitems").insertOne({ _id: 1, companyId: 20, quotationId: 1, quotationRoomId: 1, productId: 2001, productVariantId: 1, quantity: 2, unitPrice: dec("1180.00"), priceWithoutTax: dec("1000.00"), taxPercent: dec("18.00"), taxAmount: dec("180.00"), createdAt: now, updatedAt: now });
  const quotationBefore = JSON.stringify(await db.collection("quotationitems").find({}).toArray());
  const cookie = { a: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), viewer: await login("viewer@example.com", "admin"), b: await login("ownerb@example.com", "admin") };

  const base = "/api/catalog/bulk-pricing";
  const preview = (c, body) => api(c, "POST", `${base}/preview`, body);
  const apply = (c, body) => api(c, "POST", `${base}/apply`, body);
  const rule = (over = {}) => ({ mode: "percent", direction: "increase", value: 10, rounding: "10", ...over });
  const prices = async () => Object.fromEntries((await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()).map((v) => [v._id, num(v.price)]));
  const original = await prices();

  // ═══ permissions ═══
  for (const who of ["dealer", "viewer"]) {
    assert.equal((await preview(cookie[who], { scope: { all: true }, rule: rule() })).status, 403, `${who} cannot preview`);
    assert.equal((await apply(cookie[who], { scope: { all: true }, rule: rule(), checksum: "x".repeat(20) })).status, 403, `${who} cannot apply`);
    assert.equal((await api(cookie[who], "GET", `${base}/history`)).status, 403, `${who} cannot read history`);
  }
  assert.equal((await fetchNoAuth()).status, 401);
  async function fetchNoAuth() { return fetch(`${server.baseUrl}${base}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
  pass("only people who can edit the catalogue can preview, apply or read price history; dealers, read-only roles and signed-out visitors are refused");

  // ═══ validation ═══
  for (const [label, body] of [
    ["no scope", { scope: {}, rule: rule() }],
    ["an empty scope", { scope: { categoryIds: [] }, rule: rule() }],
    ["zero", { scope: { all: true }, rule: rule({ value: 0 }) }],
    ["negative", { scope: { all: true }, rule: rule({ value: -5 }) }],
    ["over 100% off", { scope: { all: true }, rule: rule({ direction: "decrease", value: 150 }) }],
    ["unknown rounding", { scope: { all: true }, rule: rule({ rounding: "5" }) }],
    ["unknown mode", { scope: { all: true }, rule: rule({ mode: "double" }) }],
    ["an unknown field", { scope: { all: true }, rule: rule(), extra: 1 }],
    ["text for the value", { scope: { all: true }, rule: rule({ value: "ten" }) }],
  ]) assert.equal((await preview(cookie.a, body)).status, 400, label);
  assert.equal((await preview(cookie.a, { scope: { categoryIds: [301] }, rule: rule() })).status, 400, "another company's category selects nothing");
  pass("missing scope, zero, negative or silly amounts, unknown modes and fields are refused");

  // ═══ preview ═══
  const all = await preview(cookie.a, { scope: { all: true }, rule: rule() });
  assert.equal(all.status, 200, all.text?.slice(0, 300));
  assert.equal(all.data.summary.matched, 5, "only this company's variants");
  assert.equal(all.data.summary.changes, 4);
  assert.deepEqual(all.data.summary.skipped, { unreadable_price: 0, negative_result: 0, unchanged: 1, cannot_keep_price: 0 }, "the free variant would not change");
  assert.deepEqual(all.data.rows.map((r) => [r.variantId, r.before, r.after]), [[1, 1180, 1300], [2, 999, 1100], [3, 5799, 6380], [4, 250, 280]]);
  assert.equal(all.data.scopeLabel, "All products");
  assert.deepEqual(await prices(), original, "a preview changes nothing");
  assert.equal(await db.collection("pricechangebatches").countDocuments(), 0);

  const byCategory = await preview(cookie.a, { scope: { categoryIds: [201] }, rule: rule() });
  assert.deepEqual(byCategory.data.rows.map((r) => r.variantId), [1, 2, 3], "a category brings its sub-categories (and its own products)");
  assert.equal(byCategory.data.scopeLabel, "Categories: Tactus");
  const bySub = await preview(cookie.a, { scope: { categoryIds: [202] }, rule: rule() });
  assert.deepEqual(bySub.data.rows.map((r) => r.variantId), [1, 2], "a sub-category alone covers only itself");
  const byProduct = await preview(cookie.a, { scope: { productIds: [2003, 2002] }, rule: rule({ mode: "amount", value: 50, direction: "decrease", rounding: "none" }) });
  assert.deepEqual(byProduct.data.rows.map((r) => [r.variantId, r.after]), [[3, 5749], [4, 200]]);
  assert.equal(byProduct.data.summary.skipped.negative_result, 1, "the free variant would go below zero");
  const mixed = await preview(cookie.a, { scope: { categoryIds: [203], productIds: [2001] }, rule: rule() });
  assert.deepEqual(mixed.data.rows.map((r) => r.variantId).sort(), [1, 2, 4], "categories and products can be combined");
  const otherCompany = await preview(cookie.b, { scope: { all: true }, rule: rule() });
  assert.deepEqual(otherCompany.data.rows.map((r) => r.variantId), [6], "another company sees only its own");
  assert.equal((await preview(cookie.b, { scope: { productIds: [2001] }, rule: rule() })).status, 400, "and cannot select ours");
  pass("preview: scopes (all, category with sub-categories, sub-category, products, combined), percent and fixed, skips with reasons, company isolation, changes nothing");

  // ═══ apply ═══
  const wrong = await apply(cookie.a, { scope: { all: true }, rule: rule(), checksum: "0".repeat(64) });
  assert.equal(wrong.status, 409, "a checksum that does not match is refused");
  assert.deepEqual(await prices(), original);
  assert.equal((await apply(cookie.a, { scope: { all: true }, rule: rule({ value: 50 }), checksum: all.data.checksum })).status, 409, "a checksum from a different rule is refused");

  const applied = await apply(cookie.a, { scope: { all: true }, rule: rule(), checksum: all.data.checksum, note: "Diwali list" });
  assert.equal(applied.status, 200, applied.text?.slice(0, 300));
  assert.deepEqual([applied.data.changed, applied.data.skipped], [4, 1]);
  const after = await prices();
  assert.deepEqual(after, { 1: 1300, 2: 1100, 3: 6380, 4: 280, 5: 0, 6: 1000 }, "this company's prices moved; the other company's did not");
  const row1 = await db.collection("productvariants").findOne({ _id: 1 });
  assert.equal(num(row1.taxPercent), 18, "the GST rate is untouched");
  assert.ok(row1.priceWithoutTax === null || Math.abs(num(row1.priceWithoutTax) * 1.18 - 1300) < 0.02, "the price without tax matches the new inclusive price (or is an explicit null, which keeps the inclusive price exact)");
  assert.ok(new Date(row1.updatedAt) > new Date(now), "the variant is marked updated (offline catalogues pick it up)");
  const row3 = await db.collection("productvariants").findOne({ _id: 3 });
  assert.deepEqual([num(row3.taxPercent), row3.priceWithoutTax === null || Math.abs(num(row3.priceWithoutTax) * 1.18 - 6380) < 0.02], [18, true], "an older price-only row gets its rate recorded and stays exact");
  assert.equal(JSON.stringify(await db.collection("quotationitems").find({}).toArray()), quotationBefore, "existing quotations are untouched");
  assert.deepEqual(await db.collection("productvariants").findOne({ _id: 6 }).then((v) => num(v.price)), 1000);
  pass("apply: the previewed prices are written (GST rate kept, price without tax re-split exactly), the other company and every existing quotation are untouched");

  // a second apply with the old checksum: prices moved, so it is refused
  assert.equal((await apply(cookie.a, { scope: { all: true }, rule: rule(), checksum: all.data.checksum })).status, 409, "the preview is stale once prices moved");
  assert.deepEqual(await prices(), after, "and nothing changed");
  pass("a preview cannot be applied twice or after prices moved (409), and nothing changes");

  // ═══ history ═══
  const history = await api(cookie.a, "GET", `${base}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.data.total, 1);
  const batch = history.data.batches[0];
  assert.deepEqual([batch.kind, batch.scopeLabel, batch.variantsChanged, batch.note, batch.createdBy, batch.createdByName, batch.revertedAt], ["change", "All products", 4, "Diwali list", 1, "Owner A", null]);
  assert.deepEqual(batch.rule, rule());
  const detail = await api(cookie.a, "GET", `${base}/history/${batch._id}`);
  assert.equal(detail.data.total, 4);
  const e1 = detail.data.entries.find((e) => e.variantId === 1);
  assert.deepEqual([e1.productName, e1.variantCode, e1.before.price, e1.after.price, e1.before.taxPercent], ["Smart Switch", "SW-1", 1180, 1300, 18]);
  const perProduct = await api(cookie.a, "GET", `${base}/history?productId=2001`);
  assert.deepEqual(perProduct.data.entries.map((e) => e.variantId).sort(), [1, 2], "one product's price history");
  assert.equal((await api(cookie.b, "GET", `${base}/history`)).data.total, 0, "another company sees none of it");
  assert.equal((await api(cookie.b, "GET", `${base}/history/${batch._id}`)).status, 404);
  assert.equal((await api(cookie.b, "POST", `${base}/history/${batch._id}/revert`)).status, 404, "nor can it undo it");
  assert.equal((await api(cookie.a, "GET", `${base}/history?limit=0`)).status, 400);
  pass("history records who, the rule, the scope, the note and each variant's before and after; per-product history; invisible to other companies");

  // ═══ undo ═══
  // someone edits one variant by hand afterwards: that one is not put back
  await db.collection("productvariants").updateOne({ _id: 2 }, { $set: { price: dec("1234.00"), priceWithoutTax: dec("1045.76") } });
  const reverted = await api(cookie.a, "POST", `${base}/history/${batch._id}/revert`);
  assert.equal(reverted.status, 200, reverted.text?.slice(0, 300));
  assert.deepEqual([reverted.data.restored, reverted.data.skipped], [3, 1]);
  assert.deepEqual(await prices(), { 1: 1180, 2: 1234, 3: 5799, 4: 250, 5: 0, 6: 1000 }, "untouched variants went back; the hand-edited one kept its newer price");
  const restored1 = await db.collection("productvariants").findOne({ _id: 1 });
  assert.deepEqual([num(restored1.priceWithoutTax), num(restored1.taxPercent)], [1000, 18], "including the price without tax");
  assert.equal(JSON.stringify(await db.collection("quotationitems").find({}).toArray()), quotationBefore, "quotations still untouched");
  const afterRevert = await api(cookie.a, "GET", `${base}/history`);
  assert.equal(afterRevert.data.total, 2);
  assert.deepEqual(afterRevert.data.batches.map((b) => b.kind), ["revert", "change"], "the undo is its own entry");
  assert.ok(afterRevert.data.batches[1].revertedAt, "and the original is marked undone");
  assert.equal((await api(cookie.a, "POST", `${base}/history/${batch._id}/revert`)).status, 409, "a change can be undone once");
  assert.equal((await api(cookie.a, "POST", `${base}/history/${afterRevert.data.batches[0]._id}/revert`)).status, 409, "an undo cannot itself be undone");
  assert.equal((await api(cookie.a, "POST", `${base}/history/nope/revert`)).status, 404);
  pass("undo restores only variants still at the price the change gave them, records itself, and works once");

  // a change whose variants have all moved cannot be undone
  const again = await preview(cookie.a, { scope: { productIds: [2003] }, rule: rule({ mode: "amount", value: 20, rounding: "none" }) });
  const second = await apply(cookie.a, { scope: { productIds: [2003] }, rule: rule({ mode: "amount", value: 20, rounding: "none" }), checksum: again.data.checksum });
  assert.equal(second.status, 200);
  await db.collection("productvariants").updateMany({ _id: { $in: [4, 5] } }, { $set: { price: dec("111.00") } });
  assert.equal((await api(cookie.a, "POST", `${base}/history/${second.data.batchId}/revert`)).status, 409, "nothing left to restore");
  pass("an undo with nothing left to restore is refused");

  console.log(`\nALL ${count} BULK PRICING API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
