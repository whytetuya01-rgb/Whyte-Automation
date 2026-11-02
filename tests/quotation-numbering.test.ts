/**
 * Quotation numbering service (src/lib/quotationNumber.ts) against a throwaway local MongoDB: the QT-YYYY-NNN format,
 * sequential numbers per company and year, the annual restart, simultaneous requests, coexistence with historical
 * numbers (which are never touched), the unique index, and the bounded retry. The routes that use the service (new,
 * Convert, clone) are exercised in tests/quotation-numbering-routes.test.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-numbering.test.ts
 */
process.env.TEST_MONGODB_URI = "mongodb://127.0.0.1:27017/whyte_quotation_numbering_test";
import "./helpers/localMongoOnly";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb";
import { Quotation } from "../src/models";
import { Counter } from "../src/lib/counter";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { QUOTATION_NUMBER_PATTERN, formatQuotationNumber, isQuotationNumberConflict, issueQuotationNumber, withQuotationNumberRetry } from "../src/lib/quotationNumber";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const inCompany = <T,>(companyId: number, fn: () => Promise<T>) => runWithTenantContext({ companyId, userId: 1, role: "admin", actingAsCompany: false }, fn);
const numbers = async (companyId: number, year: number, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push((await inCompany(companyId, () => issueQuotationNumber(year))).quotationNumber);
  return out;
};
const raw = (companyId: number, quotationNumber: string, id = `q_${companyId}_${quotationNumber}`) =>
  Quotation.collection.insertOne({ _id: id, companyId, quotationNumber, clientName: "Historical", status: "draft", createdAt: new Date("2025-01-01") } as never);

async function main() {
  await connectMongoDB();
  await Quotation.init(); // builds the indexes of the throwaway database
  const companies = [95001, 95002, 95003, 95004, 95005];

  try {
    // ── format ──
    assert.equal(formatQuotationNumber(2026, 1), "QT-2026-001");
    assert.equal(formatQuotationNumber(2026, 12), "QT-2026-012");
    assert.equal(formatQuotationNumber(2026, 999), "QT-2026-999");
    assert.equal(formatQuotationNumber(2026, 1000), "QT-2026-1000", "wider than three digits when needed");
    assert.equal(formatQuotationNumber(2027, 1), "QT-2027-001");
    for (const [y, s] of [[2026, 0], [2026, -1], [2026, 1.5], [26, 1], [20260, 1]] as const) assert.throws(() => formatQuotationNumber(y, s), `${y}/${s}`);
    for (const ok of ["QT-2026-001", "QT-2026-1000", "QT-1999-999"]) assert.match(ok, QUOTATION_NUMBER_PATTERN);
    for (const bad of ["QT-26-001", "qt-2026-001", "QT-2026-01", "QT-2026-0a1", "QUO-2026-001", "QT-2026-001 "]) assert.doesNotMatch(bad, QUOTATION_NUMBER_PATTERN, bad);
    pass("format: QT-YYYY-NNN, padded to at least three digits, invalid input refused");

    // ── sequential, per company, annual restart ──
    assert.deepEqual(await numbers(95001, 2026, 3), ["QT-2026-001", "QT-2026-002", "QT-2026-003"], "sequential from 001");
    assert.deepEqual(await numbers(95001, 2027, 2), ["QT-2027-001", "QT-2027-002"], "a new calendar year restarts at 001");
    assert.deepEqual(await numbers(95001, 2026, 1), ["QT-2026-004"], "and the old year carries on from where it was");
    assert.deepEqual(await numbers(95002, 2026, 2), ["QT-2026-001", "QT-2026-002"], "another company has its own sequence");
    await assert.rejects(() => issueQuotationNumber(2026), /company context/i, "no company in the request: nothing is issued");
    pass("numbers are sequential per company and year, restart at 001 each year, and need a company context (never client input)");

    // ── simultaneous requests ──
    const burst = await Promise.all(Array.from({ length: 30 }, () => inCompany(95003, () => issueQuotationNumber(2026))));
    const issued = burst.map((r) => r.quotationNumber);
    assert.equal(new Set(issued).size, 30, "30 simultaneous requests: no duplicates");
    assert.deepEqual([...issued].sort(), Array.from({ length: 30 }, (_, i) => formatQuotationNumber(2026, i + 1)), "and no gaps");
    pass("30 simultaneous requests receive 30 distinct, consecutive numbers");

    // ── historical numbers coexist and are never changed ──
    await raw(95004, "QT-2026-020");
    await raw(95004, "QT-2026-0007");
    await raw(95004, "QT-2025-300");
    await raw(95004, "LEGACY-ODD-1");
    assert.equal((await inCompany(95004, () => issueQuotationNumber(2026))).quotationNumber, "QT-2026-021", "the next number is above the highest historical one");
    assert.equal((await inCompany(95004, () => issueQuotationNumber(2025))).quotationNumber, "QT-2025-301", "each year looks at its own history");
    await Counter.collection.updateOne({ _id: "quotationNumber_95004_2026" as never }, { $set: { seq: 0 } });
    // The counter is behind the data (reset to 0): the number must still be above every number that is really in use.
    // ("021" above was issued but never saved as a quotation, so it is not in use and is correctly offered again.)
    assert.equal((await inCompany(95004, () => issueQuotationNumber(2026))).quotationNumber, "QT-2026-021", "a counter that fell behind the data cannot reissue a used number");
    await raw(95004, "QT-2026-021");
    await Counter.collection.updateOne({ _id: "quotationNumber_95004_2026" as never }, { $set: { seq: 0 } });
    assert.equal((await inCompany(95004, () => issueQuotationNumber(2026))).quotationNumber, "QT-2026-022", "once 021 is really used, a stale counter skips it");
    const kept = (await Quotation.collection.find({ companyId: 95004 }).project({ quotationNumber: 1 }).toArray()).map((d) => d.quotationNumber as string).sort();
    assert.deepEqual(kept, ["LEGACY-ODD-1", "QT-2025-300", "QT-2026-0007", "QT-2026-020", "QT-2026-021"], "historical numbers are untouched (the only addition is the one this test saved)");
    pass("historical numbers (odd widths, other years, other formats) are never changed; new numbers always go above them, even with a stale counter");

    // ── unique index ──
    const indexes = await Quotation.collection.indexes();
    const unique = indexes.filter((index) => index.unique && JSON.stringify(index.key) === JSON.stringify({ companyId: 1, quotationNumber: 1 }));
    assert.equal(unique.length, 1, "one unique (companyId, quotationNumber) index");
    assert.equal(indexes.some((index) => index.unique && JSON.stringify(index.key) === JSON.stringify({ quotationNumber: 1 })), false, "and no old global one");
    await raw(95005, "QT-2026-050");
    const duplicate = await raw(95005, "QT-2026-050", "q_dup").then(() => null, (error) => error);
    assert.equal(duplicate?.code, 11000, "the same number twice in one company is refused");
    assert.equal(isQuotationNumberConflict(duplicate), true);
    assert.equal(await raw(95001, "QT-2026-050").then(() => null, (error) => error), null, "the same number in another company is allowed (numbers are per company)");
    assert.equal(isQuotationNumberConflict({ code: 11000, message: "dup key: _id" }), false, "an _id conflict is not a number conflict");
    assert.equal(isQuotationNumberConflict(new Error("boom")), false);
    pass("unique (company, number) index: duplicates refused within a company, allowed across companies, no old global index");

    // ── bounded retry ──
    const conflict = Object.assign(new Error("E11000 duplicate key index: companyId_1_quotationNumber_1"), { code: 11000, keyPattern: { companyId: 1, quotationNumber: 1 } });
    let calls = 0;
    assert.equal(await withQuotationNumberRetry(async () => { calls += 1; if (calls < 3) throw conflict; return "created"; }), "created");
    assert.equal(calls, 3, "tried again after each conflict");
    calls = 0;
    await assert.rejects(() => withQuotationNumberRetry(async () => { calls += 1; throw conflict; }), (error) => error === conflict);
    assert.equal(calls, 4, "gives up after a bounded number of attempts");
    calls = 0;
    await assert.rejects(() => withQuotationNumberRetry(async () => { calls += 1; throw new Error("something else"); }), /something else/);
    assert.equal(calls, 1, "any other error is thrown at once");
    pass("duplicate-number conflicts are retried a bounded number of times; other errors are never retried");

    console.log(`\nALL ${count} QUOTATION NUMBERING TESTS PASSED!`);
  } finally {
    await Quotation.collection.deleteMany({ companyId: { $in: companies } } as never);
    await Counter.collection.deleteMany({ _id: { $regex: "^quotationNumber_950" } } as never);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
