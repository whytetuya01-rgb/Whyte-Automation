import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import mongoose from "mongoose";

/**
 * READ-ONLY. Checks whether the `priceWithoutTax`-precedence bug reproduced
 * in diag-variant-pricing.ts has any real footprint in production data.
 *
 * Uses the native driver (bypasses Mongoose schema defaults entirely) so the
 * counts below reflect exactly what is stored in MongoDB, not what Mongoose
 * would fill in on read.
 *
 * Writes nothing. Prints only counts and numeric ids — no client data.
 */
async function main() {
  await connectMongoDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db handle");

  const variants = db.collection("productvariants");
  const items = db.collection("quotationitems");

  const totalVariants = await variants.countDocuments({});
  const missingPriceWithoutTax = await variants.countDocuments({ priceWithoutTax: { $exists: false } });
  const nullPriceWithoutTax = await variants.countDocuments({ priceWithoutTax: null });
  const zeroPriceWithoutTaxButNonzeroPrice = await variants
    .find({
      $expr: { $ne: [{ $toString: "$price" }, "0.00"] },
    })
    .project({ _id: 1, price: 1, priceWithoutTax: 1 })
    .toArray();
  const trulyAtRisk = zeroPriceWithoutTaxButNonzeroPrice.filter((v) => {
    const pwt = v.priceWithoutTax;
    if (pwt === undefined || pwt === null) return true;
    const asStr = typeof pwt === "object" && pwt !== null && "toString" in pwt ? String(pwt) : String(pwt);
    return asStr === "0.00" || asStr === "0";
  });

  console.log("=== Phase 0: priceWithoutTax-precedence exposure check (read-only) ===");
  console.log(`Total ProductVariant docs:                         ${totalVariants}`);
  console.log(`priceWithoutTax field MISSING from raw document:   ${missingPriceWithoutTax}`);
  console.log(`priceWithoutTax explicitly null:                   ${nullPriceWithoutTax}`);
  console.log(`Variants with nonzero price but priceWithoutTax=0/missing (AT RISK of the bug): ${trulyAtRisk.length}`);
  if (trulyAtRisk.length > 0) {
    console.log("At-risk variant ids (first 20):", trulyAtRisk.slice(0, 20).map((v) => v._id));
  }

  // Did any already-created quotation item actually get stored with unitPrice
  // 0 while pointing at a variant whose catalog price is nonzero? That would
  // mean the bug already produced a wrong quotation, not just a theoretical risk.
  const zeroPriceItems = await items.countDocuments({
    $expr: { $eq: [{ $toString: "$unitPrice" }, "0.00"] },
  });
  const totalItems = await items.countDocuments({});
  console.log(`\nTotal QuotationItems: ${totalItems}`);
  console.log(`QuotationItems with unitPrice stored as 0.00: ${zeroPriceItems}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("diag-production-pricing-exposure failed:", error);
  process.exit(1);
});
