import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (fs.existsSync(path.resolve(process.cwd(), ".env.local"))) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
}

import { connectMongoDB } from "../src/lib/mongodb";
import { Product } from "../src/models";
import { uploadImage } from "../src/lib/cloudinary";

export interface AuditLogEntry {
  productId: number;
  productName: string;
  oldImageUrl: string | null;
  oldImagePublicId: string | null;
  catalogTagOrSourceFilename: string | null;
  targetPublicId: string | null;
  migrationAction:
    | "UPLOAD_TO_CLOUDINARY"
    | "BACKFILL_PUBLIC_ID"
    | "SKIP_NO_IMAGE"
    | "SKIP_ALREADY_MIGRATED"
    | "SKIP_EXTERNAL_URL";
  status:
    | "ALREADY_MIGRATED"
    | "NO_IMAGE"
    | "READY_FOR_UPLOAD"
    | "READY_FOR_PUBLIC_ID_BACKFILL"
    | "SUCCESS"
    | "MISSING_LOCAL_FILE"
    | "UPLOAD_FAILED"
    | "DB_UPDATE_FAILED"
    | "EXTERNAL_URL";
  resolvedLocalPath?: string;
  newImageUrl?: string | null;
  newImagePublicId?: string | null;
  error?: string;
  timestamp: string;
}

function parseSheetXml(xmlPath: string): Array<{ rowNum: number; data: Record<string, string> }> {
  if (!fs.existsSync(xmlPath)) return [];
  const xml = fs.readFileSync(xmlPath, "utf8");
  const rows: Array<{ rowNum: number; data: Record<string, string> }> = [];
  const rowRegex = /<row\s+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowNum = parseInt(rowMatch[1], 10);
    const rowContent = rowMatch[2];
    const cellRegex = /<c\s+r="([A-Z]+)\d+"[^>]*(?:t="([^"]+)")?[^>]*>(?:<is><t>([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)?<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    const rowData: Record<string, string> = {};
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const col = cellMatch[1];
      const val = cellMatch[3] !== undefined ? cellMatch[3] : cellMatch[4] !== undefined ? cellMatch[4] : "";
      rowData[col] = val
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    rows.push({ rowNum, data: rowData });
  }
  return rows;
}

/** Helper to safely extract public_id from existing Cloudinary delivery URLs */
function extractPublicIdFromCloudinaryUrl(url: string): string | null {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Ignore regex parsing errors
  }
  return null;
}

async function runMigration() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  const isDryRun = !isExecute || args.includes("--dry-run");
  const currentTimestamp = new Date().toISOString();

  console.log("\n========================================");
  console.log(`PRODUCT IMAGE MIGRATION — ${isDryRun ? "DRY RUN (NO CHANGES)" : "REAL EXECUTION"}`);
  console.log("========================================\n");

  if (isDryRun) {
    console.log("ℹ️  [SAFETY MODE] Dry-run mode enabled.");
    console.log("ℹ️  No files will be uploaded to Cloudinary.");
    console.log("ℹ️  No MongoDB documents will be modified.");
    console.log("ℹ️  Pass '--execute' to perform the actual migration.\n");
  } else {
    console.log("⚠️  [EXECUTE MODE] Executing live migration.");
    console.log("⚠️  Images WILL be uploaded to Cloudinary and MongoDB WILL be updated.\n");
  }

  await connectMongoDB();

  // Load catalog image mappings from Sheet 3 XML if available
  const sheet3Path = path.resolve(process.cwd(), "scratch/final_xlsx_extracted/xl/worksheets/sheet3.xml");
  const rawCatalogRows = parseSheetXml(sheet3Path).slice(1);
  const catalogMapByTag = new Map<string, string>(); // "Tactus_83" -> "Tactus_item_083.jpg"

  rawCatalogRows.forEach((r) => {
    const family = r.data["A"]?.trim() || "";
    const itemNo = parseInt(r.data["B"], 10);
    const imageFile = r.data["N"]?.trim() || "";
    if (family && itemNo && imageFile) {
      const fileName = path.basename(imageFile);
      catalogMapByTag.set(`${family}_${itemNo}`, fileName);
    }
  });

  const products = await Product.find().sort({ _id: 1 });
  console.log(`Found ${products.length} total products in database.`);
  console.log(`Loaded ${catalogMapByTag.size} catalog image mappings from Excel source.\n`);

  const auditEntries: AuditLogEntry[] = [];
  const localDirPublic = path.resolve(process.cwd(), "public/whyte_catalog_images");
  const localDirData = path.resolve(process.cwd(), "data/whyte_catalog_images");

  for (const product of products) {
    let rawUrl = product.imageUrl ? product.imageUrl.trim() : null;
    if (rawUrl === "null") rawUrl = null;
    const oldPublicId = product.imagePublicId ? product.imagePublicId.trim() : null;

    // Case 1: Already migrated to Cloudinary with publicId present
    if (rawUrl && rawUrl.includes("res.cloudinary.com") && oldPublicId) {
      auditEntries.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl: rawUrl,
        oldImagePublicId: oldPublicId,
        catalogTagOrSourceFilename: null,
        targetPublicId: oldPublicId,
        migrationAction: "SKIP_ALREADY_MIGRATED",
        status: "ALREADY_MIGRATED",
        timestamp: currentTimestamp,
      });
      continue;
    }

    // Case 2: Cloudinary URL missing imagePublicId (Needs publicId backfill)
    if (rawUrl && rawUrl.includes("res.cloudinary.com") && !oldPublicId) {
      const derivedPublicId = extractPublicIdFromCloudinaryUrl(rawUrl);
      if (derivedPublicId) {
        if (isDryRun) {
          auditEntries.push({
            productId: product._id,
            productName: product.name,
            oldImageUrl: rawUrl,
            oldImagePublicId: null,
            catalogTagOrSourceFilename: null,
            targetPublicId: derivedPublicId,
            migrationAction: "BACKFILL_PUBLIC_ID",
            status: "READY_FOR_PUBLIC_ID_BACKFILL",
            timestamp: currentTimestamp,
          });
        } else {
          try {
            await Product.updateOne(
              { _id: product._id },
              { $set: { imagePublicId: derivedPublicId, updatedAt: new Date() } }
            );
            auditEntries.push({
              productId: product._id,
              productName: product.name,
              oldImageUrl: rawUrl,
              oldImagePublicId: null,
              catalogTagOrSourceFilename: null,
              targetPublicId: derivedPublicId,
              migrationAction: "BACKFILL_PUBLIC_ID",
              status: "SUCCESS",
              newImageUrl: rawUrl,
              newImagePublicId: derivedPublicId,
              timestamp: currentTimestamp,
            });
            console.log(`[BACKFILL SUCCESS] Product ${product._id} publicId set: ${derivedPublicId}`);
          } catch (dbErr: any) {
            auditEntries.push({
              productId: product._id,
              productName: product.name,
              oldImageUrl: rawUrl,
              oldImagePublicId: null,
              catalogTagOrSourceFilename: null,
              targetPublicId: derivedPublicId,
              migrationAction: "BACKFILL_PUBLIC_ID",
              status: "DB_UPDATE_FAILED",
              error: dbErr.message,
              timestamp: currentTimestamp,
            });
          }
        }
        continue;
      }
    }

    // Case 3: External non-local URL (not Cloudinary, not /whyte_catalog_images/)
    if (rawUrl && /^https?:\/\//i.test(rawUrl) && !rawUrl.includes("localhost") && !rawUrl.includes("res.cloudinary.com")) {
      auditEntries.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl: rawUrl,
        oldImagePublicId: oldPublicId,
        catalogTagOrSourceFilename: null,
        targetPublicId: null,
        migrationAction: "SKIP_EXTERNAL_URL",
        status: "EXTERNAL_URL",
        timestamp: currentTimestamp,
      });
      continue;
    }

    // Case 4: Resolve Local Catalog File (either from rawUrl or from notes tag)
    let fileName: string | null = null;
    let catalogTag: string | null = null;

    if (rawUrl && (rawUrl.startsWith("/whyte_catalog_images/") || rawUrl.startsWith("whyte_catalog_images/"))) {
      fileName = path.basename(rawUrl);
    } else if (product.notes && product.notes.includes("Catalog:")) {
      const match = product.notes.match(/Catalog:\s*([^_]+)_(\d+)/);
      if (match) {
        catalogTag = `${match[1]}_${match[2]}`;
        fileName = catalogMapByTag.get(catalogTag) ?? null;
      }
    }

    // Case 5: Product genuinely has no image mapping in catalog or database
    if (!fileName) {
      auditEntries.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl: rawUrl,
        oldImagePublicId: oldPublicId,
        catalogTagOrSourceFilename: null,
        targetPublicId: null,
        migrationAction: "SKIP_NO_IMAGE",
        status: "NO_IMAGE",
        timestamp: currentTimestamp,
      });
      continue;
    }

    let resolvedPath: string | null = null;
    const publicPath = path.join(localDirPublic, fileName);
    const dataPath = path.join(localDirData, fileName);

    if (fs.existsSync(publicPath)) {
      resolvedPath = publicPath;
    } else if (fs.existsSync(dataPath)) {
      resolvedPath = dataPath;
    }

    if (!resolvedPath) {
      auditEntries.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl: rawUrl,
        oldImagePublicId: oldPublicId,
        catalogTagOrSourceFilename: catalogTag || fileName,
        targetPublicId: null,
        migrationAction: "UPLOAD_TO_CLOUDINARY",
        status: "MISSING_LOCAL_FILE",
        error: `Local image file '${fileName}' not found in public/ or data/ folders.`,
        timestamp: currentTimestamp,
      });
      continue;
    }

    const fileBaseName = path.parse(fileName).name;
    const targetPublicId = `whyte/products/${fileBaseName}`;
    const targetFolder = "whyte/products";

    if (isDryRun) {
      auditEntries.push({
        productId: product._id,
        productName: product.name,
        oldImageUrl: rawUrl ?? `/whyte_catalog_images/${fileName}`,
        oldImagePublicId: oldPublicId,
        catalogTagOrSourceFilename: catalogTag || fileName,
        targetPublicId,
        migrationAction: "UPLOAD_TO_CLOUDINARY",
        status: "READY_FOR_UPLOAD",
        resolvedLocalPath: resolvedPath,
        timestamp: currentTimestamp,
      });
    } else {
      // Execute upload & DB update safely
      try {
        console.log(`[UPLOADING] Product ${product._id} (${product.name}) -> ${fileName}...`);
        const fileBuffer = fs.readFileSync(resolvedPath);

        // Upload to Cloudinary using configured credentials
        const uploadRes = await uploadImage(fileBuffer, targetFolder);

        // Verify response
        if (!uploadRes.url || !uploadRes.publicId) {
          throw new Error("Cloudinary returned invalid upload response.");
        }

        try {
          // Update MongoDB product record only after upload succeeds
          await Product.updateOne(
            { _id: product._id },
            {
              $set: {
                imageUrl: uploadRes.url,
                imagePublicId: uploadRes.publicId,
                updatedAt: new Date(),
              },
            }
          );

          auditEntries.push({
            productId: product._id,
            productName: product.name,
            oldImageUrl: rawUrl,
            oldImagePublicId: oldPublicId,
            catalogTagOrSourceFilename: catalogTag || fileName,
            targetPublicId: uploadRes.publicId,
            migrationAction: "UPLOAD_TO_CLOUDINARY",
            status: "SUCCESS",
            resolvedLocalPath: resolvedPath,
            newImageUrl: uploadRes.url,
            newImagePublicId: uploadRes.publicId,
            timestamp: currentTimestamp,
          });
          console.log(`[SUCCESS] Product ${product._id} updated: ${uploadRes.publicId}`);
        } catch (dbErr: any) {
          console.error(`❌ [DB UPDATE FAILED] Product ${product._id} Cloudinary asset created (${uploadRes.publicId}) but DB update failed: ${dbErr.message}`);
          auditEntries.push({
            productId: product._id,
            productName: product.name,
            oldImageUrl: rawUrl,
            oldImagePublicId: oldPublicId,
            catalogTagOrSourceFilename: catalogTag || fileName,
            targetPublicId: uploadRes.publicId,
            migrationAction: "UPLOAD_TO_CLOUDINARY",
            status: "DB_UPDATE_FAILED",
            resolvedLocalPath: resolvedPath,
            newImageUrl: uploadRes.url,
            error: dbErr.message,
            timestamp: currentTimestamp,
          });
        }
      } catch (uploadErr: any) {
        console.error(`❌ [UPLOAD FAILED] Product ${product._id}: ${uploadErr.message}`);
        auditEntries.push({
          productId: product._id,
          productName: product.name,
          oldImageUrl: rawUrl,
          oldImagePublicId: oldPublicId,
          catalogTagOrSourceFilename: catalogTag || fileName,
          targetPublicId,
          migrationAction: "UPLOAD_TO_CLOUDINARY",
          status: "UPLOAD_FAILED",
          resolvedLocalPath: resolvedPath,
          error: uploadErr.message,
          timestamp: currentTimestamp,
        });
      }
    }
  }

  // Save Audit Log file locally
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const auditLogFileName = isDryRun
    ? "migration-audit-log-dry-run.json"
    : `migration-audit-log-execute-${Date.now()}.json`;
  const auditLogPath = path.join(dataDir, auditLogFileName);
  
  fs.writeFileSync(auditLogPath, JSON.stringify(auditEntries, null, 2), "utf8");
  console.log(`\n📄 [AUDIT LOG SAVED] Saved audit log record to: ${auditLogPath}`);

  // Summary Output
  console.log("\n========================================");
  console.log(`SUMMARY OF ${isDryRun ? "DRY-RUN ANALYSIS" : "MIGRATION RESULTS"}`);
  console.log("========================================");

  const total = auditEntries.length;
  const alreadyMigrated = auditEntries.filter((r) => r.status === "ALREADY_MIGRATED").length;
  const noImage = auditEntries.filter((r) => r.status === "NO_IMAGE").length;
  const readyForUpload = auditEntries.filter((r) => r.status === "READY_FOR_UPLOAD").length;
  const readyForBackfill = auditEntries.filter((r) => r.status === "READY_FOR_PUBLIC_ID_BACKFILL").length;
  const success = auditEntries.filter((r) => r.status === "SUCCESS").length;
  const missingFiles = auditEntries.filter((r) => r.status === "MISSING_LOCAL_FILE").length;
  const uploadFailed = auditEntries.filter((r) => r.status === "UPLOAD_FAILED").length;
  const dbUpdateFailed = auditEntries.filter((r) => r.status === "DB_UPDATE_FAILED").length;
  const externalUrls = auditEntries.filter((r) => r.status === "EXTERNAL_URL").length;

  console.log(`Total Products: ${total}`);
  console.log(`Already Migrated (URL + publicId): ${alreadyMigrated}`);
  console.log(`No Image Assigned in Catalog: ${noImage}`);
  console.log(`External Non-Cloudinary URLs: ${externalUrls}`);
  console.log(`Missing Local Files: ${missingFiles}`);

  if (isDryRun) {
    console.log(`Ready for Local Image Upload: ${readyForUpload}`);
    console.log(`Ready for Cloudinary publicId Backfill: ${readyForBackfill}`);

    if (readyForUpload > 0) {
      console.log("\nSample Local Image Upload Preview (First 5):");
      const sampleReady = auditEntries.filter((r) => r.status === "READY_FOR_UPLOAD").slice(0, 5);
      sampleReady.forEach((r) => {
        console.log(` - Product #${r.productId} ("${r.productName}"):`);
        console.log(`   Local File: ${r.resolvedLocalPath}`);
        console.log(`   Would Upload To: ${r.targetPublicId}`);
        console.log(`   Would Update: imageUrl and imagePublicId`);
      });
    }

    if (readyForBackfill > 0) {
      console.log("\nSample Cloudinary publicId Backfill Preview:");
      const sampleBackfill = auditEntries.filter((r) => r.status === "READY_FOR_PUBLIC_ID_BACKFILL").slice(0, 5);
      sampleBackfill.forEach((r) => {
        console.log(` - Product #${r.productId} ("${r.productName}"):`);
        console.log(`   Existing URL: ${r.oldImageUrl}`);
        console.log(`   Would Backfill imagePublicId: ${r.targetPublicId}`);
      });
    }

    console.log("\n========================================");
    console.log("NO DATABASE OR CLOUDINARY CHANGES WERE MADE");
    console.log("========================================\n");
  } else {
    console.log(`Successful Updates: ${success}`);
    console.log(`Upload Failures: ${uploadFailed}`);
    console.log(`DB Update Failures (Orphans created): ${dbUpdateFailed}`);

    if (uploadFailed > 0 || dbUpdateFailed > 0 || missingFiles > 0) {
      console.log("\nFailures / Issues Detail:");
      auditEntries
        .filter((r) => ["UPLOAD_FAILED", "DB_UPDATE_FAILED", "MISSING_LOCAL_FILE"].includes(r.status))
        .forEach((r) => {
          console.log(` - Product #${r.productId} [${r.status}]: ${r.error || "Unknown error"}`);
        });
    }
  }

  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error("Migration process crashed:", err);
  process.exit(1);
});
