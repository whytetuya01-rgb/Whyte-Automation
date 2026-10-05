import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

import dotenv from "dotenv";
dotenv.config();

import { MongoClient, Decimal128 } from "mongodb";
import {
  calculateFromTaxInclusivePrice,
  parseFinancialNumber,
  DEFAULT_TAX_PERCENT,
  DEFAULT_PURCHASE_TAX_PERCENT,
  DEFAULT_COST,
} from "../src/lib/pricing";

async function runMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in environment or .env file.");
  }

  console.log("=== Starting Idempotent ProductVariant Pricing Migration ===");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db("whyte_quotation");
    const variantsColl = db.collection<any>("productvariants");
    const quoteItemsColl = db.collection<any>("quotationitems");

    const totalVariants = await variantsColl.countDocuments();
    console.log(`Found ${totalVariants} total ProductVariant documents.`);

    const cursor = variantsColl.find({});
    const bulkOps: Array<{
      updateOne: {
        filter: { _id: unknown };
        update: { $set: Record<string, unknown> };
      };
    }> = [];

    let alreadyMigratedCount = 0;
    let toMigrateCount = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      const hasPriceWithoutTax = doc.priceWithoutTax !== undefined && doc.priceWithoutTax !== null;
      const hasTaxPercent = doc.taxPercent !== undefined && doc.taxPercent !== null;
      const hasCost = doc.cost !== undefined && doc.cost !== null;
      const hasPurchaseTax = doc.purchaseTaxPercent !== undefined && doc.purchaseTaxPercent !== null;

      if (hasPriceWithoutTax && hasTaxPercent && hasCost && hasPurchaseTax) {
        alreadyMigratedCount += 1;
        continue;
      }

      toMigrateCount += 1;

      const priceNum = parseFinancialNumber(doc.price, 0);
      const taxPercentNum = hasTaxPercent
        ? parseFinancialNumber(doc.taxPercent, DEFAULT_TAX_PERCENT)
        : DEFAULT_TAX_PERCENT;

      const calc = calculateFromTaxInclusivePrice(priceNum, taxPercentNum);

      const costNum = hasCost ? parseFinancialNumber(doc.cost, DEFAULT_COST) : DEFAULT_COST;
      const purchaseTaxPercentNum = hasPurchaseTax
        ? parseFinancialNumber(doc.purchaseTaxPercent, DEFAULT_PURCHASE_TAX_PERCENT)
        : DEFAULT_PURCHASE_TAX_PERCENT;

      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              priceWithoutTax: Decimal128.fromString(calc.priceWithoutTax.toFixed(2)),
              taxPercent: Decimal128.fromString(calc.taxPercent.toFixed(2)),
              cost: Decimal128.fromString(costNum.toFixed(2)),
              purchaseTaxPercent: Decimal128.fromString(purchaseTaxPercentNum.toFixed(2)),
            },
          },
        },
      });
    }

    console.log(`Already migrated / up to date: ${alreadyMigratedCount}`);
    console.log(`Pending migration: ${toMigrateCount}`);

    if (bulkOps.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < bulkOps.length; i += batchSize) {
        const batch = bulkOps.slice(i, i + batchSize);
        const res = await variantsColl.bulkWrite(batch, { ordered: false });
        console.log(`Migrated batch ${Math.floor(i / batchSize) + 1} (${res.modifiedCount} modified).`);
      }
    } else {
      console.log("No ProductVariants required migration.");
    }

    // Example migrated document
    const exampleDoc = await variantsColl.findOne({ _id: 1 });
    console.log("\n--- Example Migrated Document (_id: 1) ---");
    console.log(JSON.stringify(exampleDoc, null, 2));

    // Optional snapshot backfill for legacy quotation items
    const totalQuoteItems = await quoteItemsColl.countDocuments();
    console.log(`\nChecking ${totalQuoteItems} QuotationItem documents for pricing snapshots...`);

    const quoteItemsCursor = quoteItemsColl.find({
      $or: [
        { priceWithoutTax: { $exists: false } },
        { priceWithoutTax: null },
        { taxPercent: { $exists: false } },
        { taxPercent: null },
      ],
    });

    const quoteBulkOps: Array<{
      updateOne: {
        filter: { _id: unknown };
        update: { $set: Record<string, unknown> };
      };
    }> = [];

    while (await quoteItemsCursor.hasNext()) {
      const item = await quoteItemsCursor.next();
      if (!item) continue;

      const unitPriceNum = parseFinancialNumber(item.unitPrice, 0);
      const taxPercentNum = item.taxPercent ? parseFinancialNumber(item.taxPercent, 18) : 18;
      const calc = calculateFromTaxInclusivePrice(unitPriceNum, taxPercentNum);

      quoteBulkOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              priceWithoutTax: Decimal128.fromString(calc.priceWithoutTax.toFixed(2)),
              taxPercent: Decimal128.fromString(calc.taxPercent.toFixed(2)),
              taxAmount: Decimal128.fromString(calc.taxAmount.toFixed(2)),
            },
          },
        },
      });
    }

    if (quoteBulkOps.length > 0) {
      const res = await quoteItemsColl.bulkWrite(quoteBulkOps);
      console.log(`Backfilled pricing snapshot for ${res.modifiedCount} historical QuotationItems.`);
    } else {
      console.log("All QuotationItems already have pricing snapshots.");
    }

    console.log("\n[SUCCESS] Migration finished cleanly!");
  } finally {
    await client.close();
  }
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
