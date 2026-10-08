import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation } from "../../src/lib/quotationNormalization";
import { aggregateQuotationRoomTotals, deriveQuotationFinancials, totalsForQuotation } from "../../src/lib/quotationTotals";

/**
 * READ-ONLY. Proves `deriveQuotationFinancials` (fed the new aggregation's
 * subtotal) produces an IDENTICAL `grandTotal` (and every other GST/earning
 * field) to `normalizeQuotation` (fed the full populated rooms/items), for
 * EVERY real quotation — not just approved/delivered ones, so the check
 * covers every discount/customer-percent combination that exists in
 * production today.
 */
async function main() {
  await connectMongoDB();

  const docs = await Quotation.find()
    .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
    .lean({ virtuals: true });

  const ids = docs.map((d) => String(d._id));
  const aggregated = await aggregateQuotationRoomTotals(ids);

  let mismatches = 0;
  const fields: Array<keyof ReturnType<typeof deriveQuotationFinancials>> = [
    "subtotal",
    "discountAmount",
    "netSubtotal",
    "cgstAmount",
    "sgstAmount",
    "totalGstAmount",
    "grandTotal",
    "allocatedDiscountPercent",
    "customerDiscountPercent",
    "estimatedEarningPercent",
    "estimatedEarningAmount",
  ];

  for (const doc of docs) {
    const id = String(doc._id);
    const plain = JSON.parse(JSON.stringify(doc));
    const expected = normalizeQuotation(plain);

    const { subtotal } = totalsForQuotation(aggregated, id);
    const actual = deriveQuotationFinancials({
      subtotal,
      discountType: (doc as { discountType?: string | null }).discountType,
      discountValue: (doc as { discountValue?: unknown }).discountValue,
      customerDiscountPercent: (doc as { customerDiscountPercent?: unknown }).customerDiscountPercent,
      allocatedDiscountPercent: (doc as { allocatedDiscountPercent?: unknown }).allocatedDiscountPercent,
    });

    for (const field of fields) {
      const exp = Number((expected as unknown as Record<string, unknown>)[field] ?? 0);
      const act = Number((actual as unknown as Record<string, unknown>)[field] ?? 0);
      if (Math.abs(exp - act) > 1e-9) {
        console.log(`MISMATCH ${id}.${field}: expected=${exp} actual=${act}`);
        mismatches += 1;
      }
    }
  }

  console.log(`Checked ${docs.length} quotations across ${fields.length} fields.`);
  console.log(mismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${mismatches} mismatches.`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-derive-financials failed:", error);
  process.exit(1);
});
