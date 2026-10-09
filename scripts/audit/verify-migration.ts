/**
 * Post-migration verification (read-only): confirms the image-only
 * migration touched nothing it shouldn't have.
 *
 *   node scripts/run-script.js scripts/audit/verify-migration.ts
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { Product, ProductVariant, Quotation, QuotationItem } from "../../src/models";

async function main() {
  await connectMongoDB();

  const mapping = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "scripts/audit/image-mapping-proposal.json"), "utf8"));
  const beforeDump = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "scripts/audit/all-products-dump.json"), "utf8"));
  const beforeById = new Map(beforeDump.map((p: any) => [p.id, p]));

  const productCount = await Product.countDocuments();
  const variantCount = await ProductVariant.countDocuments();
  const quotationCount = await Quotation.countDocuments();
  const quotationItemCount = await QuotationItem.countDocuments();

  console.log(`Product count: ${productCount} (dump had ${beforeDump.length})`);
  console.log(`Variant count: ${variantCount}`);
  console.log(`Quotation count: ${quotationCount}`);
  console.log(`Quotation item count: ${quotationItemCount}`);

  const safeIds: number[] = mapping.safe.map((s: any) => s.productId);
  const excludedIds = new Set<number>([]); // #275 approved 2026-10-09, no longer held back
  const migratedIds = safeIds.filter((id) => !excludedIds.has(id));

  let unexpectedFieldChanges = 0;
  let invalidImageCount = 0;

  for (const id of migratedIds) {
    const before: any = beforeById.get(id);
    const after = await Product.findById(id).lean();
    if (!after) {
      console.error(`MISSING PRODUCT: #${id} no longer exists!`);
      unexpectedFieldChanges++;
      continue;
    }
    const fieldsToCompare = ["name", "code", "type", "categoryId", "automationTier", "surfaceFinish", "moduleSize", "isActive", "isMatrix"];
    for (const field of fieldsToCompare) {
      if (JSON.stringify(before[field]) !== JSON.stringify((after as any)[field])) {
        console.error(`FIELD CHANGED: #${id} ${field}: ${JSON.stringify(before[field])} -> ${JSON.stringify((after as any)[field])}`);
        unexpectedFieldChanges++;
      }
    }
    if (!after.imageUrl || !after.imageUrl.includes("res.cloudinary.com") || after.imagePublicId !== `whyte/products/edge-${id}`) {
      console.error(`INVALID IMAGE: #${id} imageUrl=${after.imageUrl} imagePublicId=${after.imagePublicId}`);
      invalidImageCount++;
    }
  }

  // NO MATCH products must be byte-for-byte unchanged on image fields.
  const untouchedIds = mapping.noMatch.map((n: any) => n.productId);
  let untouchedViolations = 0;
  for (const id of untouchedIds) {
    const before: any = beforeById.get(id);
    const after = await Product.findById(id).lean();
    if (!after) continue;
    if (before.imageUrl !== after.imageUrl || before.imagePublicId !== after.imagePublicId) {
      console.error(`UNEXPECTED IMAGE CHANGE on a held-back product: #${id}`);
      untouchedViolations++;
    }
  }

  console.log(`\nProducts migrated and checked: ${migratedIds.length}`);
  console.log(`Unexpected non-image field changes: ${unexpectedFieldChanges}`);
  console.log(`Products with invalid/missing new image: ${invalidImageCount}`);
  console.log(`Held-back products (NO MATCH) that changed anyway: ${untouchedViolations}`);

  const report = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "scripts/audit/product-image-replacement-report.json"), "utf8"));
  const deleted = report.filter((r: any) => r.status === "SUCCESS").length;
  const orphaned = report.filter((r: any) => r.status === "SUCCESS_OLD_ASSET_ORPHANED").length;
  console.log(`\nOld Cloudinary assets deleted: ${deleted}`);
  console.log(`Old Cloudinary assets still requiring cleanup (orphaned): ${orphaned}`);

  const allGood = unexpectedFieldChanges === 0 && invalidImageCount === 0 && untouchedViolations === 0 && orphaned === 0;
  console.log(`\n${allGood ? "✓ VERIFICATION PASSED" : "✗ VERIFICATION FOUND ISSUES"}`);

  await mongoose.disconnect();
  process.exit(allGood ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
