/**
 * PHASE 3 — image-only replacement for the 61 approved SAFE MATCH products
 * from scripts/audit/image-mapping-proposal.json. Never touches any other
 * product field (names, prices, GST, variants, categories, quotations, etc.)
 * and never touches product #275 or any NO MATCH product.
 *
 * Per-product sequence (never deviates):
 *   1. Re-read the product fresh from MongoDB.
 *   2. Idempotency check: if imagePublicId already equals this run's
 *      deterministic target, skip entirely (already migrated).
 *   3. Upload the new image to Cloudinary (folder "whyte/products", a
 *      deterministic public_id so a rerun can always detect completion).
 *   4. Verify the upload response has a url + the expected public_id.
 *   5. Update ONLY imageUrl + imagePublicId in MongoDB.
 *   6. Re-read the product and verify the two fields now match the upload.
 *   7. Only after that verification succeeds: delete the OLD Cloudinary
 *      asset (skipped if there wasn't one, or if old === new).
 *
 * Any failure at steps 3-4 aborts that product before any DB write. Any
 * failure at step 5-6 leaves the OLD Cloudinary asset alone and reports the
 * product as failed. A failure at step 7 is reported as an orphan to clean
 * up later — the new DB values are never rolled back once verified.
 *
 *   Dry run (default):  node scripts/run-script.js scripts/audit/migrate-edge-product-images.ts
 *   One product only:   node scripts/run-script.js scripts/audit/migrate-edge-product-images.ts --execute --only=274
 *   Full batch:          node scripts/run-script.js scripts/audit/migrate-edge-product-images.ts --execute
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { Product } from "../../src/models";
import { uploadImage, deleteImage } from "../../src/lib/cloudinary";

const ZIP_DIR = path.resolve(
  process.env.USERPROFILE || "",
  "AppData/Local/Temp/claude/c--Project-whyte-quotation/59afa953-0f65-436a-aeee-33eb791a3494/scratchpad/product-image-zip"
);
const MAPPING_PATH = path.resolve(process.cwd(), "scripts/audit/image-mapping-proposal.json");
const REPORT_PATH = path.resolve(process.cwd(), "scripts/audit/product-image-replacement-report.json");

const EXCLUDED_PRODUCT_IDS = new Set<number>([]); // #275 approved 2026-10-09; nothing held back now

interface ReportEntry {
  productId: number;
  productName: string;
  oldImageUrl: string | null;
  oldImagePublicId: string | null;
  newImageUrl: string | null;
  newImagePublicId: string | null;
  sourceFilename: string;
  replacementTimestamp: string;
  status:
    | "ALREADY_MIGRATED"
    | "SUCCESS"
    | "SUCCESS_OLD_ASSET_ORPHANED"
    | "UPLOAD_FAILED"
    | "DB_UPDATE_FAILED"
    | "DB_VERIFY_MISMATCH"
    | "SKIPPED_EXCLUDED";
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyId = onlyArg ? Number(onlyArg.split("=")[1]) : null;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`EDGE PRODUCT IMAGE REPLACEMENT — ${isExecute ? "EXECUTE" : "DRY RUN (no changes)"}${onlyId ? ` — product #${onlyId} only` : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8")) as {
    safe: Array<{ productId: number; name: string; newImageFile: string }>;
  };

  let targets = mapping.safe;
  if (onlyId) targets = targets.filter((t) => t.productId === onlyId);
  targets = targets.filter((t) => {
    if (EXCLUDED_PRODUCT_IDS.has(t.productId)) return false;
    return true;
  });

  console.log(`Approved SAFE MATCH entries in mapping file: ${mapping.safe.length}`);
  console.log(`Targets for this run (after exclusions/--only filter): ${targets.length}\n`);

  await connectMongoDB();

  const report: ReportEntry[] = [];

  for (const target of targets) {
    const now = new Date().toISOString();
    const product = await Product.findById(target.productId);
    if (!product) {
      report.push({
        productId: target.productId,
        productName: target.name,
        oldImageUrl: null,
        oldImagePublicId: null,
        newImageUrl: null,
        newImagePublicId: null,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "DB_UPDATE_FAILED",
        error: "Product no longer exists in the database.",
      });
      continue;
    }

    const oldImageUrl = product.imageUrl;
    const oldImagePublicId = product.imagePublicId ?? null;
    const targetPublicId = `whyte/products/edge-${product._id}`;

    // Idempotency: a prior successful run of THIS script already applied
    // this exact new asset — skip entirely, no re-upload, no re-delete.
    if (oldImagePublicId === targetPublicId) {
      console.log(`[SKIP] #${product._id} already migrated (publicId=${targetPublicId})`);
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: oldImageUrl,
        newImagePublicId: oldImagePublicId,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "ALREADY_MIGRATED",
      });
      continue;
    }

    if (!isExecute) {
      console.log(`[DRY RUN] #${product._id} "${product.name}" would upload "${target.newImageFile}" -> ${targetPublicId}, then delete old asset "${oldImagePublicId ?? "(none)"}"`);
      continue;
    }

    const localPath = path.join(ZIP_DIR, target.newImageFile);
    if (!fs.existsSync(localPath)) {
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: null,
        newImagePublicId: null,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "UPLOAD_FAILED",
        error: `Source file not found at ${localPath}`,
      });
      console.error(`[UPLOAD FAILED] #${product._id}: source file missing`);
      continue;
    }

    // Step 1: upload the NEW image first. DB is untouched until this succeeds.
    let uploadResult: { url: string; publicId: string };
    try {
      const buffer = fs.readFileSync(localPath);
      // `folder` is already "whyte/products" — pass only the relative
      // suffix here, or Cloudinary doubles the prefix (folder + publicId).
      uploadResult = await uploadImage(buffer, "whyte/products", { publicId: `edge-${product._id}` });
      if (!uploadResult.url || !uploadResult.publicId) {
        throw new Error("Cloudinary returned an incomplete response (missing url or publicId).");
      }
      if (uploadResult.publicId !== targetPublicId) {
        throw new Error(`Cloudinary assigned publicId "${uploadResult.publicId}", expected "${targetPublicId}".`);
      }
    } catch (uploadErr: any) {
      console.error(`[UPLOAD FAILED] #${product._id}: ${uploadErr.message}`);
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: null,
        newImagePublicId: null,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "UPLOAD_FAILED",
        error: uploadErr.message,
      });
      continue;
    }

    console.log(`[UPLOADED] #${product._id} -> ${uploadResult.publicId}`);

    // Step 2: update ONLY imageUrl + imagePublicId. Nothing else.
    try {
      await Product.updateOne(
        { _id: product._id },
        { $set: { imageUrl: uploadResult.url, imagePublicId: uploadResult.publicId } }
      );
    } catch (dbErr: any) {
      console.error(`[DB UPDATE FAILED] #${product._id}: ${dbErr.message} — old Cloudinary asset kept, new asset NOT deleted (orphan to clean up).`);
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: uploadResult.url,
        newImagePublicId: uploadResult.publicId,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "DB_UPDATE_FAILED",
        error: dbErr.message,
      });
      continue;
    }

    // Step 3: re-read and verify before ever touching the old asset.
    const verified = await Product.findById(product._id).lean();
    if (!verified || verified.imageUrl !== uploadResult.url || verified.imagePublicId !== uploadResult.publicId) {
      console.error(`[VERIFY MISMATCH] #${product._id}: DB does not reflect the new image after update — old Cloudinary asset kept.`);
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: uploadResult.url,
        newImagePublicId: uploadResult.publicId,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "DB_VERIFY_MISMATCH",
        error: "Re-read product did not match the expected imageUrl/imagePublicId.",
      });
      continue;
    }

    console.log(`[VERIFIED] #${product._id} DB now points at the new asset.`);

    // Step 4: only now, delete the OLD asset — and only if it's a real,
    // different asset (never delete the asset we just created).
    if (oldImagePublicId && oldImagePublicId !== uploadResult.publicId) {
      try {
        await deleteImage(oldImagePublicId);
        console.log(`[OLD ASSET DELETED] #${product._id}: ${oldImagePublicId}`);
        report.push({
          productId: product._id,
          productName: product.name,
          oldImageUrl,
          oldImagePublicId,
          newImageUrl: uploadResult.url,
          newImagePublicId: uploadResult.publicId,
          sourceFilename: target.newImageFile,
          replacementTimestamp: now,
          status: "SUCCESS",
        });
      } catch (deleteErr: any) {
        console.error(`[OLD ASSET DELETE FAILED] #${product._id}: ${deleteErr.message} — new image is live and kept; old asset is now an orphan requiring manual cleanup.`);
        report.push({
          productId: product._id,
          productName: product.name,
          oldImageUrl,
          oldImagePublicId,
          newImageUrl: uploadResult.url,
          newImagePublicId: uploadResult.publicId,
          sourceFilename: target.newImageFile,
          replacementTimestamp: now,
          status: "SUCCESS_OLD_ASSET_ORPHANED",
          error: deleteErr.message,
        });
      }
    } else {
      report.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl,
        oldImagePublicId,
        newImageUrl: uploadResult.url,
        newImagePublicId: uploadResult.publicId,
        sourceFilename: target.newImageFile,
        replacementTimestamp: now,
        status: "SUCCESS",
      });
    }
  }

  if (isExecute) {
    const existingReport: ReportEntry[] = fs.existsSync(REPORT_PATH)
      ? JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"))
      : [];
    const byProductId = new Map(existingReport.map((e) => [e.productId, e]));
    for (const entry of report) byProductId.set(entry.productId, entry);
    fs.writeFileSync(REPORT_PATH, JSON.stringify([...byProductId.values()], null, 2), "utf8");
    console.log(`\nReport written to: ${REPORT_PATH}`);
  }

  const success = report.filter((r) => r.status === "SUCCESS").length;
  const orphaned = report.filter((r) => r.status === "SUCCESS_OLD_ASSET_ORPHANED").length;
  const alreadyMigrated = report.filter((r) => r.status === "ALREADY_MIGRATED").length;
  const failed = report.filter((r) => ["UPLOAD_FAILED", "DB_UPDATE_FAILED", "DB_VERIFY_MISMATCH"].includes(r.status)).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Processed this run: ${report.length}`);
  console.log(`Already migrated (skipped): ${alreadyMigrated}`);
  console.log(`Successfully replaced: ${success}`);
  console.log(`Successful but old asset orphaned: ${orphaned}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    report.filter((r) => ["UPLOAD_FAILED", "DB_UPDATE_FAILED", "DB_VERIFY_MISMATCH"].includes(r.status))
      .forEach((r) => console.log(`  - #${r.productId} [${r.status}]: ${r.error}`));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration crashed:", err);
  process.exit(1);
});
