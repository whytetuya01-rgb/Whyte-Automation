/**
 * Golden + parity tests for `aggregateQuotationRoomTotals` (the shared room/item totals behind the dealer home, the
 * dealer earnings route, the dealer-earnings service and both dashboards).
 *
 * The implementation was replaced (correlated `$lookup` pipeline -> scoped indexed reads joined in memory). The
 * original is kept as `aggregateQuotationRoomTotalsLegacy` for one release. These tests prove, against a throwaway
 * database on the local loopback MongoDB (never the real one), that:
 *   - the 16 non-empty fixtures reproduce the values frozen from the LEGACY implementation before it was changed
 *     (golden snapshot sha256 cafbc1f00e86699b..., captured from the unmodified file, blob b07bd563);
 *   - new and legacy agree bit-for-bit on every fixture, in every scope mode the callers use;
 *   - money derived from the totals (GST, discount, dealer earning) is identical for the same inputs;
 *   - the tenant and soft-delete plugins still scope every query, and nothing here bypasses them;
 *   - chunking, empty input, duplicate ids and the query budget behave.
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-room-totals-golden.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import {
  aggregateQuotationRoomTotals,
  aggregateQuotationRoomTotalsLegacy,
  deriveQuotationFinancials,
  totalsForQuotation,
  type QuotationRoomAggregateTotals,
} from "../src/lib/quotationTotals";
import { runUnscoped, runWithTenantContext, TenantScopeViolationError } from "../src/lib/tenant/context";
import { getConfirmedEarningsForDealer, getConfirmedEarningsTotal } from "../src/lib/dealerEarningsService";
import { calculateDealerEarning, resolveCustomerDiscountPercent, roundMoney, toPlainNumber } from "../src/lib/dealerEarnings";
import { getAdminDashboardData } from "../src/lib/adminDashboardData";
import { getSuperAdminDashboardData } from "../src/lib/superAdminDashboardData";

type Totals = Map<string, QuotationRoomAggregateTotals>;
type Doc = Record<string, unknown>;

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const ctx1 = { companyId: 1, userId: 1, role: "admin", actingAsCompany: false };
const ctx2 = { companyId: 2, userId: 2, role: "admin", actingAsCompany: false };
const d = (value: string) => mongoose.Types.Decimal128.fromString(value);

// ── Golden values frozen from the LEGACY implementation: [quotationId, roomsCount, productsCount, subtotal] ──
type GoldenRow = [string, number, number, number];
const GOLDEN_NONE_PROTECTED: GoldenRow[] = [
  ["q_gold_01_plain", 2, 7, 5469.39],
  ["q_gold_03_emptyroom", 1, 0, 0],
  ["q_gold_04_deletedroomtype-draft", 2, 1, 700],
  ["q_gold_05_deletedroomtype-approved", 2, 1, 700],
  ["q_gold_06_deletedproduct-draft", 1, 1, 50],
  ["q_gold_07_deletedproduct-delivered", 1, 1, 50],
  ["q_gold_08_deletedvariant-draft", 1, 1, 10],
  ["q_gold_09_novariant-deleted-flag-ignored", 1, 1, 75],
  ["q_gold_10_deleteditem", 1, 1, 10],
  ["q_gold_11_deletedroom", 1, 1, 11],
  ["q_gold_12_badqty", 1, 5.5, 55],
  ["q_gold_13_missingqty-price", 1, 3, 10],
  ["q_gold_14_roomtype-null", 1, 1, 33.33],
  ["q_gold_15_cross-company-item", 1, 1, 20],
  ["q_gold_16_cross-company-product-flag", 1, 1, 60],
  ["q_gold_18_floatstress", 40, 963, 3189086.1856],
];
const GOLDEN_STATUS_PROTECTED: GoldenRow[] = GOLDEN_NONE_PROTECTED.map((row): GoldenRow => {
  if (row[0] === "q_gold_05_deletedroomtype-approved") return [row[0], 2, 3, 1700];
  if (row[0] === "q_gold_07_deletedproduct-delivered") return [row[0], 1, 3, 650];
  return row;
});

// ── Fixture seeding (native driver, like the data a real database holds; bypasses model validation on purpose) ──
const NOW = new Date("2026-10-01T00:00:00Z");
const live = { companyId: 1, isDeleted: false, createdAt: NOW, updatedAt: NOW };
let roomId = 900000;
let itemId = 900000;
const statusById = new Map<string, string>();

async function insert(collection: string, docs: Doc[]) {
  if (docs.length > 0) await mongoose.connection.collection(collection).insertMany(docs);
}

interface RoomSpec {
  doc?: Doc;
  items?: Doc[];
}
async function fixtureQuotation(id: string, status: string, rooms: RoomSpec[], extra: Doc = {}) {
  statusById.set(id, status);
  await insert("quotations", [{ ...live, _id: id, quotationNumber: id, clientName: id, status, ...extra }]);
  const roomDocs: Doc[] = [];
  const itemDocs: Doc[] = [];
  for (const room of rooms) {
    const rid = ++roomId;
    roomDocs.push({ ...live, _id: rid, quotationId: id, roomTypeId: 1, sortOrder: 0, ...room.doc });
    (room.items ?? []).forEach((item, k) => {
      itemDocs.push({ ...live, _id: ++itemId, quotationRoomId: rid, productId: 1, productVariantId: 1, quantity: 1, unitPrice: d("100.00"), sortOrder: k, ...item });
    });
  }
  await insert("quotationrooms", roomDocs);
  await insert("quotationitems", itemDocs);
}

async function seedGoldenFixtures() {
  await insert("roomtypes", [
    { ...live, _id: 1, name: "Live room type", isActive: true, sortOrder: 0 },
    { ...live, _id: 900001, name: "Deleted room type", isActive: true, isDeleted: true, sortOrder: 1 },
  ]);
  await insert("products", [
    { ...live, _id: 1, name: "Live product", isActive: true, type: "x", sortOrder: 0 },
    { ...live, _id: 900001, name: "Deleted product", isActive: true, isDeleted: true, type: "x", sortOrder: 1 },
    { ...live, _id: 900002, name: "Deleted product of another company", companyId: 2, isActive: true, isDeleted: true, type: "x", sortOrder: 2 },
  ]);
  await insert("productvariants", [
    { ...live, _id: 1, productId: 1, name: "Live variant", isActive: true, price: d("100"), sortOrder: 0 },
    { ...live, _id: 900001, productId: 1, name: "Deleted variant", isActive: true, isDeleted: true, price: d("100"), sortOrder: 1 },
  ]);

  await fixtureQuotation("q_gold_01_plain", "draft", [
    { items: [{ quantity: 2, unitPrice: d("1234.56") }, { quantity: 3, unitPrice: d("999.99") }] },
    { items: [{ quantity: 1, unitPrice: d("0.10") }, { quantity: 1, unitPrice: d("0.20") }] },
  ]);
  await fixtureQuotation("q_gold_02_norooms", "draft", []);
  await fixtureQuotation("q_gold_03_emptyroom", "draft", [{ items: [] }]);
  await fixtureQuotation("q_gold_04_deletedroomtype-draft", "draft", [
    { doc: { roomTypeId: 900001 }, items: [{ quantity: 2, unitPrice: d("500") }] },
    { items: [{ quantity: 1, unitPrice: d("700") }] },
  ]);
  await fixtureQuotation("q_gold_05_deletedroomtype-approved", "approved", [
    { doc: { roomTypeId: 900001 }, items: [{ quantity: 2, unitPrice: d("500") }] },
    { items: [{ quantity: 1, unitPrice: d("700") }] },
  ]);
  await fixtureQuotation("q_gold_06_deletedproduct-draft", "draft", [
    { items: [{ productId: 900001, quantity: 2, unitPrice: d("300") }, { quantity: 1, unitPrice: d("50") }] },
  ]);
  await fixtureQuotation("q_gold_07_deletedproduct-delivered", "delivered", [
    { items: [{ productId: 900001, quantity: 2, unitPrice: d("300") }, { quantity: 1, unitPrice: d("50") }] },
  ]);
  await fixtureQuotation("q_gold_08_deletedvariant-draft", "draft", [
    { items: [{ productVariantId: 900001, quantity: 4, unitPrice: d("25.50") }, { quantity: 1, unitPrice: d("10") }] },
  ]);
  await fixtureQuotation("q_gold_09_novariant-deleted-flag-ignored", "draft", [
    { items: [{ productVariantId: null, quantity: 1, unitPrice: d("75") }] },
  ]);
  await fixtureQuotation("q_gold_10_deleteditem", "draft", [
    { items: [{ isDeleted: true, quantity: 9, unitPrice: d("9999") }, { quantity: 1, unitPrice: d("10") }] },
  ]);
  await fixtureQuotation("q_gold_11_deletedroom", "draft", [
    { doc: { isDeleted: true }, items: [{ quantity: 1, unitPrice: d("4000") }] },
    { items: [{ quantity: 1, unitPrice: d("11") }] },
  ]);
  await fixtureQuotation("q_gold_12_badqty", "draft", [
    { items: [{ quantity: 0, unitPrice: d("10") }, { quantity: -3, unitPrice: d("10") }, { quantity: null, unitPrice: d("10") }, { quantity: 2.5, unitPrice: d("10") }] },
  ]);
  await fixtureQuotation("q_gold_13_missingqty-price", "draft", [
    { items: [{ quantity: undefined, unitPrice: d("10") }, { quantity: 2, unitPrice: undefined }] },
  ]);
  await fixtureQuotation("q_gold_14_roomtype-null", "draft", [{ doc: { roomTypeId: null }, items: [{ quantity: 1, unitPrice: d("33.33") }] }]);
  await fixtureQuotation("q_gold_15_cross-company-item", "draft", [
    { items: [{ companyId: 2, quantity: 5, unitPrice: d("1000") }, { quantity: 1, unitPrice: d("20") }] },
  ]);
  await fixtureQuotation("q_gold_16_cross-company-product-flag", "draft", [{ items: [{ productId: 900002, quantity: 1, unitPrice: d("60") }] }]);
  await fixtureQuotation(
    "q_gold_17_company2-quotation",
    "draft",
    [{ doc: { companyId: 2 }, items: [{ companyId: 2, quantity: 1, unitPrice: d("123") }] }],
    { companyId: 2 }
  );
  const prices = ["0.1", "0.2", "19999.99", "3.33", "7.07", "1234.5678", "0.01"];
  await fixtureQuotation(
    "q_gold_18_floatstress",
    "sent",
    Array.from({ length: 40 }, (_, i) => ({
      doc: { sortOrder: i },
      items: Array.from({ length: 6 }, (_, j) => ({ quantity: ((i + j) % 7) + 1, unitPrice: d(prices[(i * 3 + j) % prices.length]), sortOrder: j })),
    }))
  );
}

// ── helpers ──
const isProtected = (status: string) => status === "approved" || status === "delivered";
const sameBits = (a: QuotationRoomAggregateTotals | undefined, b: QuotationRoomAggregateTotals | undefined) =>
  Boolean(a && b) && a!.roomsCount === b!.roomsCount && Object.is(a!.productsCount, b!.productsCount) && Object.is(a!.subtotal, b!.subtotal);

function assertTotalsEqual(actual: Totals, expected: Totals, label: string) {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${label}: same quotation ids`);
  for (const [id, want] of expected) {
    const got = actual.get(id);
    assert.ok(sameBits(got, want), `${label}: ${id} new=${JSON.stringify(got)} legacy=${JSON.stringify(want)}`);
  }
}

function prng(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

async function main() {
  const dbName = `whyte_room_totals_golden_${randomBytes(6).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  process.env.MONGODB_URI = uri; // getSuperAdminDashboardData() calls connectMongoDB(), which needs it (same local throwaway database)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true });
  let failed = false;
  try {
    await seedGoldenFixtures();
    const allIds = [...statusById.keys()];
    const company1Ids = allIds.filter((id) => !id.includes("company2"));
    const protectedIds = (ids: string[]) => ids.filter((id) => isProtected(statusById.get(id)!));

    // ═══ 1. Golden values frozen from the legacy implementation ═══
    const newNone = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, []));
    for (const [id, rooms, products, subtotal] of GOLDEN_NONE_PROTECTED) {
      const got = newNone.get(id);
      assert.ok(got, `${id} present`);
      assert.equal(got.roomsCount, rooms, `${id} roomsCount`);
      assert.ok(Object.is(got.productsCount, products), `${id} productsCount ${got.productsCount} != ${products}`);
      assert.ok(Object.is(got.subtotal, subtotal), `${id} subtotal ${got.subtotal} != ${subtotal}`);
    }
    assert.equal(newNone.has("q_gold_02_norooms"), false, "a quotation with no rooms has no entry");
    assert.equal(newNone.size, GOLDEN_NONE_PROTECTED.length);
    pass("16 frozen golden rows (no protected ids) are reproduced exactly; a quotation without rooms has no entry");

    const newStatus = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, protectedIds(company1Ids)));
    for (const [id, rooms, products, subtotal] of GOLDEN_STATUS_PROTECTED) {
      const got = newStatus.get(id);
      assert.ok(got && got.roomsCount === rooms && Object.is(got.productsCount, products) && Object.is(got.subtotal, subtotal), `${id} protected golden`);
    }
    pass("16 frozen golden rows with Approved/Delivered protected (deleted room type/product kept only for those) are reproduced exactly");

    // ═══ 2. New vs legacy, every scope mode and protected-set the callers use ═══
    const scenarios: Array<[string, "scoped" | "unscoped", string[], string[]]> = [
      ["scoped company 1, nothing protected (admin dashboard, earnings service)", "scoped", company1Ids, []],
      ["scoped company 1, status-protected (dealer home, dealer earnings route)", "scoped", company1Ids, protectedIds(company1Ids)],
      ["scoped company 1, everything protected", "scoped", company1Ids, company1Ids],
      ["scoped company 1 asked about all ids incl. company 2", "scoped", allIds, protectedIds(allIds)],
      ["unscoped platform-admin (super admin dashboard)", "unscoped", allIds, []],
      ["unscoped platform-admin, status-protected", "unscoped", allIds, protectedIds(allIds)],
    ];
    for (const [label, mode, ids, prots] of scenarios) {
      const run = <T>(fn: () => Promise<T>) => (mode === "scoped" ? runWithTenantContext(ctx1, fn) : runUnscoped("platform-admin", fn));
      const fresh = await run(() => aggregateQuotationRoomTotals(ids, prots));
      const legacy = await run(() => aggregateQuotationRoomTotalsLegacy(ids, prots));
      assertTotalsEqual(fresh, legacy, label);
    }
    pass("new == legacy bit-for-bit in all 6 caller scenarios (scoped, status-protected, all-protected, cross-company ids, platform-admin unscoped x2)");

    // ═══ 3. Tenant isolation and soft-delete scope ═══
    const scopedAll = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(allIds, []));
    assert.equal(scopedAll.has("q_gold_17_company2-quotation"), false, "company 1 must not see company 2's totals");
    const company2 = await runWithTenantContext(ctx2, () => aggregateQuotationRoomTotals(allIds, []));
    assert.deepEqual([...company2.keys()], ["q_gold_17_company2-quotation"], "company 2 sees only its own quotation");
    assert.equal(company2.get("q_gold_17_company2-quotation")?.subtotal, 123);
    const platform = await runUnscoped("platform-admin", () => aggregateQuotationRoomTotals(allIds, []));
    assert.equal(platform.has("q_gold_17_company2-quotation"), true, "the authorized platform-admin path still spans companies");
    await assert.rejects(() => aggregateQuotationRoomTotals(allIds, []), TenantScopeViolationError);
    await runWithTenantContext({ ...ctx1, companyId: null }, async () => {
      assert.equal((await aggregateQuotationRoomTotals(allIds, [])).size, 0, "Super Admin without an act-as company sees nothing");
    });
    assert.equal(scopedAll.get("q_gold_11_deletedroom")?.roomsCount, 1, "a soft-deleted room is not counted");
    assert.equal(scopedAll.get("q_gold_10_deleteditem")?.subtotal, 10, "a soft-deleted item is not counted");
    pass("tenant isolation: company 1 never sees company 2; company 2 sees only its own; no context throws; companyId:null sees nothing; platform-admin still spans companies");

    const source = readFileSync(join(__dirname, "..", "src", "lib", "quotationTotals.ts"), "utf8");
    const newCode = source
      .slice(source.indexOf("class DoubleDoubleSum"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(!/runUnscoped|bypass|withTransaction|companyId:\s*req|searchParams/.test(newCode), "new implementation must not unscope, bypass or read client input");
    assert.ok(!/includeSoftDeleted\(/.test(newCode) && /setOptions\(historicalReferenceOptions\(\)\)/.test(newCode), "deleted-flag reads must use historicalReferenceOptions(), not includeSoftDeleted() (its WeakSet check silently no-ops when the module is loaded twice, as in Next.js bundles)");
    pass("the new implementation contains no runUnscoped / bypass / client-supplied company id, and reads deleted flags via historicalReferenceOptions()");

    // ═══ 4. Chunking, empty input, duplicates ═══
    const unchunked = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, protectedIds(company1Ids)));
    for (const chunkSize of [1, 2, 5, 1000]) {
      const chunked = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, protectedIds(company1Ids), { chunkSize }));
      assertTotalsEqual(chunked, unchunked, `chunkSize ${chunkSize}`);
    }
    // The literal summation is cut into several commands (on quotation boundaries only) when it would get too large.
    for (const sumBatchItems of [1, 7, 40]) {
      const batched = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, protectedIds(company1Ids), { sumBatchItems }));
      assertTotalsEqual(batched, unchunked, `sumBatchItems ${sumBatchItems}`);
    }
    assert.equal((await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals([], []))).size, 0);
    const dup = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals([...company1Ids, ...company1Ids], protectedIds(company1Ids)));
    assertTotalsEqual(dup, unchunked, "duplicate ids");
    assert.equal(totalsForQuotation(unchunked, "q_gold_02_norooms").subtotal, 0);
    pass("chunk sizes 1/2/5/1000, summation batch sizes 1/7/40, empty input and duplicate ids give identical results; missing quotation reads as all-zero");

    // ═══ 5. Query budget per chunk: rooms, items, room types, products, variants + one literal-sum aggregate ═══
    const finds: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => {
      if (method === "find" || method === "aggregate") finds.push(`${collection}.${method}`);
    });
    await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, []));
    const oneChunk = [...finds];
    finds.length = 0;
    await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(company1Ids, [], { chunkSize: 4 }));
    const manyChunks = finds.length;
    mongoose.set("debug", false);
    assert.deepEqual(oneChunk.sort(), ["products.find", "productvariants.find", "quotationitems.find", "quotationrooms.aggregate", "quotationrooms.find", "roomtypes.find"]);
    assert.equal(manyChunks, 6 * Math.ceil(company1Ids.length / 4), "6 operations per chunk, no per-room or per-item queries");
    pass("query budget: exactly 6 operations per chunk (5 indexed reads + 1 literal summation; no per-room / per-item queries)");

    // ═══ 6. Money pipeline: identical GST / discount / earning for identical inputs ═══
    const rnd = prng(20261027);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const discountCases = () => ({
      discountType: pick<string | null>(["none", "percentage", "fixed", null]),
      discountValue: pick<unknown>([null, 0, 5, 12.5, d("7.25"), "10", 250, 999999]),
      customerDiscountPercent: pick<unknown>([undefined, null, 0, 3, 7.5, 10]),
      allocatedDiscountPercent: pick<unknown>([undefined, 0, 5, 10, 15, 20]),
    });
    let moneyChecks = 0;
    for (const id of company1Ids) {
      const a = totalsForQuotation(unchunked, id).subtotal;
      const legacyTotals = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotalsLegacy([id], protectedIds([id])));
      const b = totalsForQuotation(legacyTotals, id).subtotal;
      for (let n = 0; n < 12; n++) {
        const params = discountCases();
        assert.deepEqual(deriveQuotationFinancials({ subtotal: a, ...params }), deriveQuotationFinancials({ subtotal: b, ...params }), `${id} money pipeline`);
        moneyChecks += 1;
      }
    }
    pass(`money pipeline: deriveQuotationFinancials (GST, discount, dealer earning) identical for new vs legacy subtotals (${moneyChecks} randomized checks over all fixtures)`);

    // ═══ 7. Floating point: realistic-scale randomized quotations vs legacy (bit-for-bit) ═══
    const realIds: string[] = [];
    const roomDocs: Doc[] = [];
    const itemDocs: Doc[] = [];
    const quotationDocs: Doc[] = [];
    for (let n = 0; n < 600; n++) {
      const id = `q_real_${String(n).padStart(4, "0")}`;
      realIds.push(id);
      quotationDocs.push({ ...live, _id: id, quotationNumber: id, clientName: id, status: pick(["draft", "sent", "approved", "delivered"]) });
      const rooms = 1 + Math.floor(rnd() * 10);
      for (let j = 0; j < rooms; j++) {
        const rid = ++roomId;
        roomDocs.push({ ...live, _id: rid, quotationId: id, roomTypeId: 1, sortOrder: j });
        const items = 1 + Math.floor(rnd() * 15);
        for (let k = 0; k < items; k++) {
          itemDocs.push({ ...live, _id: ++itemId, quotationRoomId: rid, productId: 1, productVariantId: 1, sortOrder: k, quantity: 1 + Math.floor(rnd() * 12), unitPrice: d((rnd() * 60000).toFixed(2)) });
        }
      }
    }
    await insert("quotations", quotationDocs);
    await insert("quotationrooms", roomDocs);
    await insert("quotationitems", itemDocs);
    const realNew = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotals(realIds, []));
    const realLegacy = await runWithTenantContext(ctx1, () => aggregateQuotationRoomTotalsLegacy(realIds, []));
    assert.equal(realNew.size, realIds.length);
    let financialChecks = 0;
    for (const [id, want] of realLegacy) {
      const got = realNew.get(id)!;
      assert.ok(sameBits(got, want), `${id}: new=${JSON.stringify(got)} legacy=${JSON.stringify(want)}`);
      for (let n = 0; n < 6; n++) {
        const params = discountCases();
        assert.deepEqual(deriveQuotationFinancials({ subtotal: got.subtotal, ...params }), deriveQuotationFinancials({ subtotal: want.subtotal, ...params }), `${id} financials ${JSON.stringify(params)}`);
        financialChecks += 1;
      }
    }
    pass(`floating point: ${realIds.length} randomized quotations (${itemDocs.length} items, unit prices up to 60,000): every subtotal and quantity is bit-identical to legacy; ${financialChecks} derived-money checks identical`);

    // ═══ 8. Caller tests ═══
    // Dealer-visible quotations with allocation snapshots, to drive the earnings service and the dashboards.
    const dealerQuotations: Doc[] = [];
    for (let n = 0; n < 12; n++) {
      const id = `q_real_${String(n).padStart(4, "0")}`;
      dealerQuotations.push({ id, dealerId: n % 2 === 0 ? 7 : 8, status: pick(["approved", "delivered", "draft", "sent"]), allocatedDiscountPercent: pick([0, 10, 15, 20]), customerDiscountPercent: pick([0, 3, 5, 12.5]), discountType: "percentage", discountValue: d("5") });
    }
    for (const q of dealerQuotations) {
      await mongoose.connection.collection("quotations").updateOne(
        { _id: q.id as never },
        { $set: { dealerId: q.dealerId, status: q.status, allocatedDiscountPercent: q.allocatedDiscountPercent, customerDiscountPercent: q.customerDiscountPercent, discountType: q.discountType, discountValue: q.discountValue } }
      );
    }
    const expectedEarnings = async (dealerId: number | null, ctx: typeof ctx1 | null) => {
      const docs = await mongoose.connection.collection("quotations").find({ _id: { $in: dealerQuotations.map((q) => q.id) as never[] }, ...(dealerId === null ? { dealerId: { $ne: null } } : { dealerId }), status: { $in: ["approved", "delivered"] } }).toArray();
      const run = <T>(fn: () => Promise<T>) => (ctx ? runWithTenantContext(ctx, fn) : runUnscoped("platform-admin", fn));
      const legacy = await run(() => aggregateQuotationRoomTotalsLegacy(docs.map((q) => String(q._id)), []));
      let total = 0;
      for (const q of docs) {
        total += calculateDealerEarning({ subtotal: totalsForQuotation(legacy, String(q._id)).subtotal, allocatedPercent: toPlainNumber(q.allocatedDiscountPercent), customerPercent: resolveCustomerDiscountPercent({ customerDiscountPercent: q.customerDiscountPercent, discountType: q.discountType as string | null | undefined, discountValue: q.discountValue }) }).earningAmount;
      }
      return roundMoney(total);
    };
    // Caller 3: getConfirmedEarningsForDealer (dealer home, scoped)
    for (const dealerId of [7, 8]) {
      const got = await runWithTenantContext(ctx1, () => getConfirmedEarningsForDealer(dealerId));
      assert.equal(got, await expectedEarnings(dealerId, ctx1), `dealer ${dealerId} confirmed earnings`);
    }
    pass("caller: getConfirmedEarningsForDealer (dealer home) == earnings recomputed from legacy totals");
    // Caller 4: getConfirmedEarningsTotal (admin dashboard scoped; super admin dashboard unscoped)
    assert.equal(await runWithTenantContext(ctx1, () => getConfirmedEarningsTotal()), await expectedEarnings(null, ctx1), "scoped total");
    assert.equal(await runUnscoped("platform-admin", () => getConfirmedEarningsTotal()), await expectedEarnings(null, null), "unscoped total");
    pass("caller: getConfirmedEarningsTotal == earnings recomputed from legacy totals (scoped and platform-admin unscoped)");

    // Caller 5: admin dashboard (scoped) and caller 6: super admin dashboard (unscoped platform-admin)
    const approvedValueFromLegacy = async (ctx: typeof ctx1 | null) => {
      const run = <T>(fn: () => Promise<T>) => (ctx ? runWithTenantContext(ctx, fn) : runUnscoped("platform-admin", fn));
      const docs = await mongoose.connection.collection("quotations").find({ status: { $in: ["approved", "delivered"] }, ...(ctx ? { companyId: ctx.companyId } : {}) }).toArray();
      const legacy = await run(() => aggregateQuotationRoomTotalsLegacy(docs.map((q) => String(q._id)), []));
      return docs.reduce((sum, q) => sum + deriveQuotationFinancials({ subtotal: totalsForQuotation(legacy, String(q._id)).subtotal, discountType: q.discountType as string | null | undefined, discountValue: q.discountValue, customerDiscountPercent: q.customerDiscountPercent, allocatedDiscountPercent: q.allocatedDiscountPercent }).grandTotal, 0);
    };
    const admin = await runWithTenantContext(ctx1, () => getAdminDashboardData());
    assert.equal(admin.quotations.approvedValue, await approvedValueFromLegacy(ctx1), "admin dashboard approvedValue");
    assert.equal(admin.quotations.confirmedDealerEarnings, await expectedEarnings(null, ctx1), "admin dashboard confirmed earnings");
    assert.ok(admin.quotations.recent.length > 0);
    pass("caller: getAdminDashboardData approvedValue + confirmedDealerEarnings == values recomputed from legacy totals");

    const superAdmin = await getSuperAdminDashboardData();
    assert.equal(superAdmin.quotations.approvedValue, await approvedValueFromLegacy(null), "super admin dashboard approvedValue");
    assert.equal(superAdmin.dealers.totalEarnings, await expectedEarnings(null, null), "super admin dashboard dealer earnings");
    pass("caller: getSuperAdminDashboardData (platform-admin unscoped) approvedValue + totalEarnings == values recomputed from legacy totals");
    console.log("  (callers 1-2, the dealer home page and GET /api/dealer/earnings, are exercised over HTTP by the A/B script in C:\\Project\\whyte-perf-audit\\phase1)");

    console.log(`\n${count} tests passed.`);
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    mongoose.set("debug", false);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
  process.exit(failed ? 1 : 0);
}

void main();
