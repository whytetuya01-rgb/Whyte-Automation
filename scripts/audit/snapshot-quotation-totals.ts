import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation } from "../../src/lib/quotationNormalization";
import { getAdminDashboardData } from "../../src/lib/adminDashboardData";
import { getConfirmedEarningsForDealer, getConfirmedEarningsTotal } from "../../src/lib/dealerEarningsService";

/**
 * READ-ONLY Phase 0 golden snapshot.
 *
 * Captures every quotation's EXISTING totals (computed by the EXISTING,
 * unmodified `normalizeQuotation` / `calculateQuotationGst` / dealer-earnings
 * engine) plus the EXISTING Home-page listing formula, so later phases
 * (pagination, aggregation) can be proven byte-for-byte identical before
 * they are trusted.
 *
 * - No document is ever written. No `save`, `update`, `delete`.
 * - No client PII (name/phone/email/address) is written to disk — only ids,
 *   status, dealerId and numeric totals — so the output is safe to keep
 *   locally, though it still defaults to an out-of-repo path.
 *
 * Usage (from repo root):
 *   node scripts/run-script.js scripts/audit/snapshot-quotation-totals.ts snapshot [outFile]
 *   node scripts/run-script.js scripts/audit/snapshot-quotation-totals.ts compare <fileA> <fileB>
 *
 * `outFile` defaults to a timestamped file under the OS temp dir, NOT the repo,
 * so a snapshot is never accidentally committed.
 */

interface QuotationRow {
  items?: Array<{ quantity?: unknown; unitPrice?: unknown }> | null;
}
interface QuotationLike {
  rooms?: QuotationRow[] | null;
  discountType?: string | null;
  discountValue?: unknown;
}

/**
 * EXACT mirror of the formula in `src/app/(app)/page.tsx` (`HomePage`) at the
 * time this snapshot was written. This is a READ of that logic, duplicated
 * here only so Phase 2's rewrite of the Home page can be diffed against it.
 * It is not imported from the page because that file has no exported
 * function — if Phase 2 refactors it into one, this block should be deleted
 * in favour of importing the real function.
 */
function homePageFormula(q: QuotationLike): number {
  // NOTE: this mirrors `(app)/page.tsx`'s own `toNum`, but this script feeds
  // it data that already went through one `JSON.parse(JSON.stringify())`
  // round trip (needed to write a plain-JSON snapshot file), which turns a
  // Decimal128 into a plain `{ $numberDecimal }` object — whose inherited
  // `Object.prototype.toString()` is `"[object Object]"`, not the decimal
  // string a real Decimal128 instance's own `toString()` would give. The
  // real page.tsx never hits this: it reads straight off `.lean()`, where
  // `unitPrice` is still a real Decimal128 instance. Checking `$numberDecimal`
  // first (as `normalizeQuotation`'s own discount-value resolver already
  // does) fixes this script's reading without touching page.tsx.
  const toNum = (v: unknown): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "object" && v !== null && "$numberDecimal" in (v as Record<string, unknown>)) {
      const n = Number((v as { $numberDecimal: unknown }).$numberDecimal);
      return Number.isNaN(n) ? 0 : n;
    }
    if (typeof v === "object" && v !== null && typeof (v as { toString?: unknown }).toString === "function") {
      return Number((v as { toString: () => string }).toString());
    }
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };
  const rooms = Array.isArray(q.rooms) ? q.rooms : [];
  const subtotal = rooms.reduce(
    (sum, r) =>
      sum +
      (Array.isArray(r.items)
        ? r.items.reduce((s, i) => s + (Number(i.quantity) || 1) * toNum(i.unitPrice), 0)
        : 0),
    0
  );
  let discount = 0;
  if (q.discountType === "percentage") {
    discount = (subtotal * toNum(q.discountValue)) / 100;
  } else if (q.discountType === "fixed") {
    discount = toNum(q.discountValue);
  }
  return Math.max(0, subtotal - discount);
}

interface SnapshotRow {
  id: string;
  quotationNumber: string;
  status: string;
  dealerId: number | null;
  createdBy: string | null;
  // Authoritative engine (normalizeQuotation -> calculateQuotationGst)
  subtotal: number;
  discountAmount: number;
  netSubtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  totalGstAmount: number;
  grandTotal: number;
  roomsCount: number;
  productsCount: number;
  allocatedDiscountPercent: number;
  customerDiscountPercent: number;
  estimatedEarningPercent: number;
  estimatedEarningAmount: number;
  // Home-page listing formula (see homePageFormula above) — pre-GST, discounted subtotal
  homeTotalAmount: number;
}

interface SnapshotFile {
  generatedAt: string;
  quotationCount: number;
  rows: SnapshotRow[];
  aggregates: {
    dashboardApprovedValue: number;
    dashboardConfirmedDealerEarnings: number;
    dashboardTotalQuotations: number;
    confirmedEarningsTotal: number;
    confirmedEarningsByDealer: Record<number, number>;
  };
}

async function buildSnapshot(): Promise<SnapshotFile> {
  await connectMongoDB();

  const docs = await Quotation.find()
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean({ virtuals: true });

  const rows: SnapshotRow[] = docs.map((doc) => {
    const plain = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const normalized = normalizeQuotation(plain);
    return {
      id: String(normalized.id),
      quotationNumber: String(normalized.quotationNumber ?? ""),
      status: String(normalized.status ?? "draft"),
      dealerId: normalized.dealerId === undefined || normalized.dealerId === null ? null : Number(normalized.dealerId),
      createdBy: normalized.createdBy === undefined || normalized.createdBy === null ? null : String(normalized.createdBy),
      subtotal: Number(normalized.subtotal ?? 0),
      discountAmount: Number(normalized.discountAmount ?? 0),
      netSubtotal: Number(normalized.netSubtotal ?? 0),
      cgstAmount: Number(normalized.cgstAmount ?? 0),
      sgstAmount: Number(normalized.sgstAmount ?? 0),
      totalGstAmount: Number(normalized.totalGstAmount ?? 0),
      grandTotal: Number(normalized.grandTotal ?? 0),
      roomsCount: normalized.rooms?.length ?? 0,
      productsCount: Number(normalized.productsCount ?? 0),
      allocatedDiscountPercent: Number(normalized.allocatedDiscountPercent ?? 0),
      customerDiscountPercent: Number(normalized.customerDiscountPercent ?? 0),
      estimatedEarningPercent: Number(normalized.estimatedEarningPercent ?? 0),
      estimatedEarningAmount: Number(normalized.estimatedEarningAmount ?? 0),
      homeTotalAmount: homePageFormula(plain as QuotationLike),
    };
  });

  const dealerIds = Array.from(new Set(rows.map((r) => r.dealerId).filter((id): id is number => id !== null)));
  const confirmedEarningsByDealer: Record<number, number> = {};
  for (const dealerId of dealerIds) {
    confirmedEarningsByDealer[dealerId] = await getConfirmedEarningsForDealer(dealerId);
  }

  const [dashboard, confirmedEarningsTotal] = await Promise.all([
    getAdminDashboardData(),
    getConfirmedEarningsTotal(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    quotationCount: rows.length,
    rows,
    aggregates: {
      dashboardApprovedValue: dashboard.quotations.approvedValue,
      dashboardConfirmedDealerEarnings: dashboard.quotations.confirmedDealerEarnings,
      dashboardTotalQuotations: dashboard.quotations.total,
      confirmedEarningsTotal,
      confirmedEarningsByDealer,
    },
  };
}

function defaultOutPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(os.tmpdir(), `whyte-quotation-golden-snapshot-${stamp}.json`);
}

function compareSnapshots(aPath: string, bPath: string): number {
  const a = JSON.parse(fs.readFileSync(aPath, "utf8")) as SnapshotFile;
  const b = JSON.parse(fs.readFileSync(bPath, "utf8")) as SnapshotFile;

  const aById = new Map(a.rows.map((r) => [r.id, r]));
  const bById = new Map(b.rows.map((r) => [r.id, r]));

  let diffCount = 0;
  const numericFields: Array<keyof SnapshotRow> = [
    "subtotal",
    "discountAmount",
    "netSubtotal",
    "cgstAmount",
    "sgstAmount",
    "totalGstAmount",
    "grandTotal",
    "roomsCount",
    "productsCount",
    "allocatedDiscountPercent",
    "customerDiscountPercent",
    "estimatedEarningPercent",
    "estimatedEarningAmount",
    "homeTotalAmount",
  ];

  for (const [id, rowA] of aById) {
    const rowB = bById.get(id);
    if (!rowB) {
      console.log(`MISSING in B: quotation ${id} (${rowA.quotationNumber})`);
      diffCount += 1;
      continue;
    }
    for (const field of numericFields) {
      if (rowA[field] !== rowB[field]) {
        console.log(`DIFF ${id} (${rowA.quotationNumber}).${field}: ${rowA[field]} -> ${rowB[field]}`);
        diffCount += 1;
      }
    }
  }
  for (const id of bById.keys()) {
    if (!aById.has(id)) {
      console.log(`NEW in B: quotation ${id}`);
      diffCount += 1;
    }
  }

  const aggA = a.aggregates;
  const aggB = b.aggregates;
  if (aggA.dashboardApprovedValue !== aggB.dashboardApprovedValue) {
    console.log(`DIFF aggregates.dashboardApprovedValue: ${aggA.dashboardApprovedValue} -> ${aggB.dashboardApprovedValue}`);
    diffCount += 1;
  }
  if (aggA.dashboardConfirmedDealerEarnings !== aggB.dashboardConfirmedDealerEarnings) {
    console.log(
      `DIFF aggregates.dashboardConfirmedDealerEarnings: ${aggA.dashboardConfirmedDealerEarnings} -> ${aggB.dashboardConfirmedDealerEarnings}`
    );
    diffCount += 1;
  }
  if (aggA.confirmedEarningsTotal !== aggB.confirmedEarningsTotal) {
    console.log(`DIFF aggregates.confirmedEarningsTotal: ${aggA.confirmedEarningsTotal} -> ${aggB.confirmedEarningsTotal}`);
    diffCount += 1;
  }

  console.log(diffCount === 0 ? "GOLDEN SNAPSHOT MATCH: 0 differences." : `GOLDEN SNAPSHOT MISMATCH: ${diffCount} differences.`);
  return diffCount;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(3);

  if (mode === "compare") {
    const [fileA, fileB] = rest;
    if (!fileA || !fileB) {
      console.error("Usage: snapshot-quotation-totals.ts compare <fileA> <fileB>");
      process.exit(2);
    }
    const diffCount = compareSnapshots(fileA, fileB);
    process.exit(diffCount === 0 ? 0 : 1);
  }

  const outPath = rest[0] ? path.resolve(rest[0]) : defaultOutPath();
  const snapshot = await buildSnapshot();
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log("=== Phase 0: Quotation golden snapshot (read-only) ===");
  console.log(`Quotations captured: ${snapshot.quotationCount}`);
  console.log(`Dashboard approvedValue:              ${snapshot.aggregates.dashboardApprovedValue}`);
  console.log(`Dashboard confirmedDealerEarnings:     ${snapshot.aggregates.dashboardConfirmedDealerEarnings}`);
  console.log(`Confirmed earnings total (all dealers): ${snapshot.aggregates.confirmedEarningsTotal}`);
  console.log(`Dealers with confirmed earnings:      ${Object.keys(snapshot.aggregates.confirmedEarningsByDealer).length}`);
  console.log(`Written to: ${outPath}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("snapshot-quotation-totals failed:", error);
  process.exit(1);
});
