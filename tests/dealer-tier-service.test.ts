/**
 * Dealer tiers: the thresholds, and the service that qualifies quotations and upgrades dealers, against a throwaway
 * local MongoDB. The routes that trigger it (delivering a quotation) and the screens are in
 * tests/dealer-tiers-and-numbering.test.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/dealer-tier-service.test.ts
 */
process.env.TEST_MONGODB_URI = "mongodb://127.0.0.1:27017/whyte_dealer_tiers_test";
import "./helpers/localMongoOnly";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb";
import { AdminUser, DealerCategoryEvent, Quotation } from "../src/models";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { DEALER_TIERS, QUALIFYING_QUOTATION_STATUS, describeTierProgress, tierForCount } from "../src/lib/dealerTiers";
import {
  countQualifiedQuotations,
  dealerPerformance,
  dealerTierAnalytics,
  evaluateDealerCategory,
  listDealerCategoryEvents,
  listQualifyingQuotations,
  reconcileCompanyDealerCategories,
  setDealerCategoryManually,
} from "../src/lib/dealerTierService";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const C1 = 96001;
const C2 = 96002;
const inCompany = <T,>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false }, fn);

let quoteSeq = 0;
/** Raw insert (no validation, like data that already exists). Returns the quotation id. */
async function quote(companyId: number, dealerId: number | null, status: string, extra: Record<string, unknown> = {}): Promise<string> {
  quoteSeq += 1;
  const _id = `q_tier_${companyId}_${quoteSeq}`;
  await Quotation.collection.insertOne({
    _id,
    companyId,
    dealerId,
    status,
    quotationNumber: `QT-2026-${String(quoteSeq).padStart(3, "0")}`,
    clientName: `Client ${quoteSeq}`,
    createdAt: new Date(),
    deliveredAt: status === "delivered" ? new Date() : null,
    ...extra,
  } as never);
  return _id;
}
const delivered = async (companyId: number, dealerId: number, n: number) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await quote(companyId, dealerId, "delivered"));
  return ids;
};
const dealerDoc = (id: number, companyId: number, extra: Record<string, unknown> = {}) =>
  AdminUser.collection.insertOne({ _id: id, companyId, role: "dealer", name: `Dealer ${id}`, email: `d${id}@example.com`, isActive: true, createdAt: new Date("2025-06-01"), ...extra } as never);
const stored = async (id: number) => (await AdminUser.collection.findOne({ _id: id } as never)) as unknown as { dealerTier?: { category: string } } | null;
const events = (companyId: number, dealerId: number) => inCompany(companyId, () => listDealerCategoryEvents(companyId, dealerId));

async function main() {
  await connectMongoDB();

  try {
    // ── thresholds, in one place ──
    assert.deepEqual(DEALER_TIERS.map((t) => [t.key, t.minQualified]), [["bronze", 0], ["silver", 5], ["gold", 10], ["platinum", 20], ["diamond", 40]]);
    assert.equal(QUALIFYING_QUOTATION_STATUS, "delivered");
    const table: Array<[number, string]> = [[0, "bronze"], [4, "bronze"], [5, "silver"], [9, "silver"], [10, "gold"], [19, "gold"], [20, "platinum"], [39, "platinum"], [40, "diamond"], [500, "diamond"], [-3, "bronze"], [Number.NaN, "bronze"], [7.9, "silver"]];
    for (const [n, expected] of table) assert.equal(tierForCount(n), expected, `${n} -> ${expected}`);
    const mid = describeTierProgress("silver", 7);
    assert.deepEqual([mid.nextCategory, mid.quotationsRequiredForNextCategory, mid.progressPercent], ["gold", 3, 40]);
    const top = describeTierProgress("diamond", 52);
    assert.deepEqual([top.nextCategory, top.quotationsRequiredForNextCategory, top.progressPercent], [null, 0, 100]);
    assert.equal(describeTierProgress("bronze", 0).progressPercent, 0);
    assert.equal(describeTierProgress("gold", 3).quotationsRequiredForNextCategory, 17, "an earned category above the count still shows what is left to the next one");
    pass("thresholds: Bronze 0-4, Silver 5-9, Gold 10-19, Platinum 20-39, Diamond 40+, defined once; progress and remaining counts are right, including the top");

    // ── 1. Bronze to start; qualification statuses ──
    await dealerDoc(1, C1);
    await dealerDoc(2, C1); // another dealer of the same company
    await dealerDoc(3, C2); // a dealer of another company
    const first = dealerPerformance({ createdAt: new Date("2025-06-01") }, 0);
    assert.deepEqual([first.category, first.qualifiedCount, first.nextCategory, first.quotationsRequiredForNextCategory], ["bronze", 0, "silver", 5], "a new dealer is Bronze");
    assert.equal(first.categoryAchievedAt?.toISOString(), "2025-06-01T00:00:00.000Z", "Bronze dates from when the dealer joined");

    for (const status of ["draft", "sent", "approved", "rejected"]) await quote(C1, 1, status);
    await quote(C1, 1, "delivered", { isDeleted: true });
    assert.equal(await inCompany(C1, () => countQualifiedQuotations(C1, 1)), 0, "draft, sent, approved (not delivered), rejected and deleted quotations do not count");
    const approved = await quote(C1, 1, "approved");
    assert.deepEqual(await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1, quotationId: approved })), { evaluated: false, reason: "not_qualifying" }, "approved but not delivered is not evaluated");
    assert.equal((await stored(1))?.dealerTier, undefined, "and nothing is written");
    pass("a new dealer is Bronze; draft, sent, approved-only, rejected and deleted quotations never count");

    // ── 2. cloned, other dealer, other company ──
    await quote(C1, 1, "draft", { clonedFromQuotationId: "q_original" });
    await delivered(C1, 2, 7); // dealer 2's quotations
    await delivered(C2, 3, 7); // another company's dealer
    await quote(C2, 1, "delivered"); // a quotation in ANOTHER company that names dealer 1
    assert.equal(await inCompany(C1, () => countQualifiedQuotations(C1, 1)), 0, "a clone starts as a draft and counts only once it qualifies; other dealers and other companies never add to this dealer");
    const foreign = await quote(C1, 2, "delivered");
    assert.deepEqual(await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1, quotationId: foreign })), { evaluated: false, reason: "not_qualifying" }, "dealer 2's quotation cannot be used to evaluate dealer 1");
    assert.deepEqual(await inCompany(C2, () => evaluateDealerCategory({ companyId: C2, dealerId: 1 })), { evaluated: false, reason: "dealer_not_found" }, "dealer 1 does not exist in company 2");
    pass("clones, other dealers and other companies cannot affect this dealer");

    // ── 3. upgrades at 5, 10, 20, 40 ──
    const upgradeAt = async (dealerId: number, companyId: number, total: number, expected: string) => {
      const have = await inCompany(companyId, () => countQualifiedQuotations(companyId, dealerId));
      const ids = await delivered(companyId, dealerId, total - have);
      const result = await inCompany(companyId, () => evaluateDealerCategory({ companyId, dealerId, quotationId: ids[ids.length - 1] }));
      assert.equal(result.evaluated && result.to, expected, `${total} delivered -> ${expected}`);
      return result;
    };
    const a4 = await delivered(C1, 1, 4);
    const r4 = await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1, quotationId: a4[3] }));
    assert.deepEqual([r4.evaluated && r4.changed, r4.evaluated && r4.to], [false, "bronze"], "4 delivered: still Bronze");
    const r5 = await upgradeAt(1, C1, 5, "silver");
    assert.equal(r5.evaluated && r5.changed, true);
    await upgradeAt(1, C1, 10, "gold");
    await upgradeAt(1, C1, 20, "platinum");
    await upgradeAt(1, C1, 40, "diamond");
    assert.equal((await stored(1))?.dealerTier?.category, "diamond");
    const history = await events(C1, 1);
    const inOrder = [...history].sort((x, y) => x.qualifiedCount - y.qualifiedCount);
    assert.deepEqual(inOrder.map((e) => `${e.fromCategory}>${e.toCategory}`), ["bronze>silver", "silver>gold", "gold>platinum", "platinum>diamond"], "each upgrade is in the history");
    assert.deepEqual(inOrder.map((e) => e.qualifiedCount), [5, 10, 20, 40]);
    assert.ok(history.every((e) => e.source === "automatic" && e.quotationId));
    pass("Silver at 5, Gold at 10, Platinum at 20, Diamond at 40: each upgrade recorded once with the count and the quotation that earned it");

    // ── 4. repeated events, editing ──
    const lastDelivered = (await inCompany(C1, () => listQualifyingQuotations(C1, 1, 1)))[0]._id as string;
    for (let i = 0; i < 3; i += 1) await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1, quotationId: lastDelivered }));
    await Quotation.collection.updateOne({ _id: lastDelivered } as never, { $set: { clientName: "Edited client", notes: "edited", updatedAt: new Date() } });
    await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1, quotationId: lastDelivered }));
    assert.equal((await events(C1, 1)).length, 4, "repeating the same event adds no history");
    assert.equal(await inCompany(C1, () => countQualifiedQuotations(C1, 1)), 40, "and no count: editing a quotation does not change it");
    pass("repeated events and edits do not double-count or repeat history");

    // ── 5. never downgrades automatically ──
    await Quotation.collection.updateMany({ companyId: C1, dealerId: 1, status: "delivered" } as never, { $set: { isDeleted: true } });
    assert.equal(await inCompany(C1, () => countQualifiedQuotations(C1, 1)), 0, "all of the dealer's quotations were deleted");
    const afterLoss = await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 1 }));
    assert.deepEqual([afterLoss.evaluated && afterLoss.changed, afterLoss.evaluated && afterLoss.to, (await stored(1))?.dealerTier?.category], [false, "diamond", "diamond"], "the earned category stays");
    // Reconciling upgrades dealer 2 here (8 delivered, never evaluated) but must not lower dealer 1.
    assert.equal(await inCompany(C1, () => reconcileCompanyDealerCategories(C1, { force: true })), 1);
    assert.equal((await stored(2))?.dealerTier?.category, "silver");
    assert.equal((await stored(1))?.dealerTier?.category, "diamond", "reconciling does not lower it either");
    const shown = await inCompany(C1, async () => dealerPerformance((await AdminUser.collection.findOne({ _id: 1 } as never)) as never, 0));
    assert.deepEqual([shown.category, shown.nextCategory], ["diamond", null], "the dealer is still shown as Diamond");
    await Quotation.collection.updateMany({ companyId: C1, dealerId: 1 } as never, { $set: { isDeleted: false } });
    pass("a dealer is never downgraded automatically, even if their quotations are removed or no longer qualify");

    // ── 6. simultaneous evaluations ──
    await dealerDoc(4, C1);
    const burstIds = await delivered(C1, 4, 5);
    const burst = await Promise.all(Array.from({ length: 8 }, () => inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 4, quotationId: burstIds[4] }))));
    assert.equal(burst.filter((r) => r.evaluated && r.changed).length, 1, "exactly one of 8 simultaneous evaluations performs the upgrade");
    assert.equal((await events(C1, 4)).length, 1, "and exactly one history entry exists");
    assert.equal((await stored(4))?.dealerTier?.category, "silver");
    pass("simultaneous evaluations produce one upgrade and one history entry");

    // ── 7. reconciling history that predates tiers ──
    await dealerDoc(5, C1);
    await delivered(C1, 5, 12);
    await dealerDoc(6, C1);
    await delivered(C1, 6, 3);
    // Dealer 2 was already caught up above; dealer 5 has 12 delivered, dealer 6 only 3.
    assert.equal(await inCompany(C1, () => reconcileCompanyDealerCategories(C1, { force: true })), 1, "one dealer's history earns a higher category");
    assert.equal((await stored(5))?.dealerTier?.category, "gold");
    assert.equal((await stored(2))?.dealerTier?.category, "silver");
    assert.equal((await stored(6))?.dealerTier?.category ?? "bronze", "bronze");
    assert.equal((await stored(3))?.dealerTier, undefined, "company 1's pass did not touch company 2's dealer");
    assert.equal(await inCompany(C1, () => reconcileCompanyDealerCategories(C1, { force: true })), 0, "running it again changes nothing");
    assert.equal((await events(C1, 5)).length, 1);
    assert.equal(await inCompany(C2, () => reconcileCompanyDealerCategories(C2, { force: true })), 1, "company 2 is reconciled on its own (dealer 3 has 7)");
    assert.equal((await stored(3))?.dealerTier?.category, "silver");
    assert.equal((await stored(2))?.dealerTier?.category, "silver", "and company 2's pass left company 1's dealers as they were");
    pass("history from before tiers is reconciled once, per company, and never twice");

    // ── 8. manual correction ──
    const actor = { userId: 99, name: "Super Admin" };
    const set = (companyId: number, dealerId: number, category: unknown, reason: unknown) => inCompany(companyId, () => setDealerCategoryManually({ companyId, dealerId, category, reason, actor }));
    await assert.rejects(() => set(C1, 5, "mythic", "valid reason here"), /Category must be one of/);
    await assert.rejects(() => set(C1, 5, "silver", ""), /reason/i);
    await assert.rejects(() => set(C1, 5, "silver", "abc"), /reason/i);
    await assert.rejects(() => set(C1, 5, "gold", "already gold"), /already/i);
    await assert.rejects(() => set(C2, 5, "silver", "wrong company"), /not found/i, "a dealer of another company cannot be corrected");
    assert.equal((await stored(5))?.dealerTier?.category, "gold", "refused corrections change nothing");
    const down = await set(C1, 5, "silver", "Two quotations were delivered in error");
    assert.deepEqual([down.from, down.to, down.qualifiedCount], ["gold", "silver", 12]);
    const manual = (await events(C1, 5)).find((e) => e.source === "manual")!;
    assert.deepEqual([manual.source, manual.fromCategory, manual.toCategory, manual.reason, manual.performedBy, manual.performedByName], ["manual", "gold", "silver", "Two quotations were delivered in error", 99, "Super Admin"], "the correction is audited with who and why");
    await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 5 }));
    assert.equal((await stored(5))?.dealerTier?.category, "silver", "a routine check does not undo the correction");
    await inCompany(C1, () => reconcileCompanyDealerCategories(C1, { force: true }));
    assert.equal((await stored(5))?.dealerTier?.category, "silver", "nor does reconciling");
    const next = (await delivered(C1, 5, 1))[0];
    const regained = await inCompany(C1, () => evaluateDealerCategory({ companyId: C1, dealerId: 5, quotationId: next }));
    assert.equal(regained.evaluated && regained.to, "gold", "a quotation delivered after the correction lets the count earn the category again");
    await set(C1, 4, "diamond", "Recognised from legacy records");
    assert.equal((await stored(4))?.dealerTier?.category, "diamond", "a correction can also raise a category");
    pass("manual correction: needs a valid category and a written reason, is company-scoped, is audited, and is not undone by routine checks");

    // ── 9. analytics (real data, per company) ──
    const analytics = await inCompany(C1, () => dealerTierAnalytics(C1, new Date(Date.now() - 3600_000)));
    assert.equal(Object.values(analytics.dealersByCategory).reduce((a, b) => a + b, 0), 5, "five active dealers in company 1");
    assert.deepEqual(analytics.dealersByCategory, { bronze: 1, silver: 1, gold: 1, platinum: 0, diamond: 2 }, "per category: dealer 6 Bronze, dealer 2 Silver, dealer 5 Gold, dealers 1 and 4 Diamond");
    // Upgrades: dealer 1 four, dealer 2 one, dealer 4 two (silver, then a manual raise), dealer 5 two (gold, then regained). The manual downgrade is not an upgrade.
    assert.equal(analytics.upgradesInPeriod, 9, "upgrades in the period are counted (downgrades are not)");
    const other = await inCompany(C2, () => dealerTierAnalytics(C2, new Date(Date.now() - 3600_000)));
    assert.equal(Object.values(other.dealersByCategory).reduce((a, b) => a + b, 0), 1, "company 2 sees only its own dealer");
    assert.equal((await inCompany(C1, () => dealerTierAnalytics(C1, new Date(Date.now() + 3600_000)))).upgradesInPeriod, 0, "a period in the future has no upgrades");
    pass("dashboard analytics come from the company's own dealers and history");

    console.log(`\nALL ${count} DEALER TIER SERVICE TESTS PASSED!`);
  } finally {
    await Promise.all([
      Quotation.collection.deleteMany({ companyId: { $in: [C1, C2] } } as never),
      AdminUser.collection.deleteMany({ companyId: { $in: [C1, C2] } } as never),
      DealerCategoryEvent.collection.deleteMany({ companyId: { $in: [C1, C2] } } as never),
    ]);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
