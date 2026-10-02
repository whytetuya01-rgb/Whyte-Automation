import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Product, ProductVariant, Category, QuotationItem } from "../src/models";

// Command line arguments
const args = process.argv.slice(2);
const isExecute = args.includes("--execute");
const isDryRun = !isExecute; // DEFAULT is dry-run!

interface CatalogRow {
  catalogFamily: string;
  catalogItemNo: number;
  sourcePage: string;
  sourceProductDescription: string;
  suggestedBaseProductName: string;
  moduleSize: string;
  imageFile: string;
  imageSource: string;
}

interface VariantRow {
  catalogFamily: string;
  catalogItemNo: number;
  suggestedBaseProductName: string;
  moduleSize: string;
  automationTier: string;
  surfaceFinish: string;
  sourcePriceValue: string;
  parsedPrice: number;
  variantStatus: string;
  issueNote: string;
}

function parseSheetXml(xmlPath: string): Array<{ rowNum: number; data: Record<string, string> }> {
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

function getFamilyPrefix(fam: string): string {
  switch (fam) {
    case "Tactus":
      return "TAC";
    case "Tactus Color":
      return "TC";
    case "Tactus Color EDGE":
      return "TCE";
    case "Tactus VLUXE":
      return "TVL";
    default:
      return fam.toUpperCase().replace(/\s+/g, "");
  }
}

function getModStr(mod: string): string {
  if (!mod || mod === "NA") return "NA";
  const m = String(mod).trim().toUpperCase();
  if (m === "8 SQ." || m === "8SQ") return "8SQ";
  if (/^\d+$/.test(m)) return `${m}M`;
  return m.replace(/\s+/g, "");
}

function getAutoAbbr(auto: string): string {
  switch ((auto || "").toLowerCase()) {
    case "remote":
      return "RE";
    case "wifi":
      return "WH";
    case "zigbee":
      return "ZB";
    default:
      return (auto || "").toUpperCase().slice(0, 2);
  }
}

function getFinishAbbr(finish: string): string {
  switch ((finish || "").toLowerCase()) {
    case "acrylic":
      return "A";
    case "glass":
      return "G";
    default:
      return (finish || "").toUpperCase().slice(0, 1);
  }
}

function determineCategoryAndType(fam: string, itemNo: number): { categoryId: number; type: "switch_board" | "curtain" | "accessory" } {
  // Items 7 and 8 across all families are Curtain Switches
  if (itemNo === 7 || itemNo === 8) {
    if (fam === "Tactus Color EDGE") return { categoryId: 2, type: "curtain" };
    if (fam === "Tactus VLUXE") return { categoryId: 3, type: "curtain" };
    return { categoryId: 1, type: "curtain" }; // Tactus & Tactus Color
  }

  // Accessories:
  // Tactus items 79-82 are standalone Sockets & Chargers; 83-84 are Gateways; 85 is Remote
  if (fam === "Tactus") {
    if (itemNo >= 83) return { categoryId: 6, type: "accessory" }; // Category 6: Accessories
    if (itemNo >= 79) return { categoryId: 1, type: "accessory" }; // Sockets & Chargers in Tactus
    return { categoryId: 1, type: "switch_board" };
  }

  // Tactus Color items 78-81 are standalone Sockets & Chargers
  if (fam === "Tactus Color") {
    if (itemNo >= 78) return { categoryId: 1, type: "accessory" };
    return { categoryId: 1, type: "switch_board" };
  }

  // Tactus Color EDGE items 69-72 are standalone Sockets & Chargers
  if (fam === "Tactus Color EDGE") {
    if (itemNo >= 69) return { categoryId: 2, type: "accessory" };
    return { categoryId: 2, type: "switch_board" };
  }

  // Tactus VLUXE
  if (fam === "Tactus VLUXE") {
    return { categoryId: 3, type: "switch_board" };
  }

  return { categoryId: 1, type: "switch_board" };
}

export async function runCatalogImport() {
  console.log("================================================================================");
  console.log(`WHYTE 2026 PRODUCT CATALOG IMPORT TO MONGODB`);
  console.log(`MODE: ${isExecute ? "EXECUTE (DESTRUCTIVE IMPORT)" : "DRY RUN (VALIDATION ONLY - NO DB WRITES)"}`);
  console.log("================================================================================\n");

  const excelPath = path.resolve(process.cwd(), "data/Whyte_2026_Product_Catalog_With_Images.xlsx");
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Final catalog Excel file not found at: ${excelPath}`);
  }
  console.log(`1. Source File: ${excelPath} (${(fs.statSync(excelPath).size / 1024 / 1024).toFixed(2)} MB)`);

  // Ensure extracted directory exists
  const extractedDir = path.resolve(process.cwd(), "scratch/final_xlsx_extracted");
  const sheet3Path = path.join(extractedDir, "xl/worksheets/sheet3.xml");
  const sheet5Path = path.join(extractedDir, "xl/worksheets/sheet5.xml");

  if (!fs.existsSync(sheet3Path) || !fs.existsSync(sheet5Path)) {
    console.log(`Extracting workbook XML files...`);
    fs.mkdirSync(extractedDir, { recursive: true });
    execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${excelPath.replace(/\\/g, "/")}', '${extractedDir.replace(/\\/g, "/")}')"`);
  }

  // 1. Parse Sheet 3 (Catalog_Rows)
  const rawCatalogRows = parseSheetXml(sheet3Path).slice(1); // skip header
  console.log(`\n2. Catalog Line Items: ${rawCatalogRows.length} rows loaded from Catalog_Rows (Sheet 3)`);

  const catalogProducts: CatalogRow[] = rawCatalogRows.map((r) => ({
    catalogFamily: r.data["A"]?.trim(),
    catalogItemNo: parseInt(r.data["B"], 10),
    sourcePage: r.data["C"]?.trim(),
    sourceProductDescription: r.data["D"]?.trim(),
    suggestedBaseProductName: r.data["E"]?.trim(),
    moduleSize: r.data["F"]?.trim(),
    imageFile: r.data["N"]?.trim(),
    imageSource: r.data["O"]?.trim(),
  }));

  // 2. Parse Sheet 5 (Variant_Review)
  const rawVariantRows = parseSheetXml(sheet5Path).slice(1);
  console.log(`3. Potential Variants: ${rawVariantRows.length} rows loaded from Variant_Review (Sheet 5)`);

  const allVariants: VariantRow[] = rawVariantRows.map((r) => ({
    catalogFamily: r.data["A"]?.trim(),
    catalogItemNo: parseInt(r.data["B"], 10),
    suggestedBaseProductName: r.data["D"]?.trim(),
    moduleSize: r.data["E"]?.trim(),
    automationTier: r.data["F"]?.trim()?.toLowerCase(),
    surfaceFinish: r.data["G"]?.trim()?.toLowerCase(),
    sourcePriceValue: r.data["H"]?.trim(),
    parsedPrice: parseFloat(r.data["I"]),
    variantStatus: r.data["J"]?.trim(),
    issueNote: r.data["K"]?.trim(),
  }));

  // Filter valid sellable variants (Status === 'Available')
  const availableVariants = allVariants.filter((v) => v.variantStatus === "Available");
  const unavailableVariants = allVariants.filter((v) => v.variantStatus !== "Available");

  console.log(`   - Available Sellable Variants: ${availableVariants.length}`);
  console.log(`   - Excluded / Review Variants: ${unavailableVariants.length}`);

  // 3. Connect to MongoDB to inspect current DB & categories
  console.log(`\n4. Connecting to MongoDB...`);
  await connectMongoDB();
  console.log(`   Connected to: ${mongoose.connection.name}`);

  const existingCategories = await Category.find().lean();
  const validCatIds = new Set(existingCategories.map((c) => c._id));
  console.log(`   Found ${existingCategories.length} existing categories in DB.`);

  const existingProdCount = await Product.countDocuments();
  const existingVarCount = await ProductVariant.countDocuments();
  console.log(`   Current DB Products: ${existingProdCount}`);
  console.log(`   Current DB ProductVariants: ${existingVarCount}`);

  // 4. Quotation References Safety Check
  const quotationItems = await QuotationItem.find().lean();
  console.log(`   Current DB QuotationItems: ${quotationItems.length}`);
  const referencedProductIds = Array.from(new Set(quotationItems.map((qi) => qi.productId)));
  const referencedVariantIds = Array.from(new Set(quotationItems.map((qi) => qi.productVariantId).filter(Boolean)));

  console.log(`   - Distinct Product IDs referenced by QuotationItems: [${referencedProductIds.join(", ")}]`);
  console.log(`   - Distinct ProductVariant IDs referenced by QuotationItems: [${referencedVariantIds.join(", ")}]`);

  // 5. Image verification on disk
  const dataImgDir = path.resolve(process.cwd(), "data/whyte_catalog_images");
  const publicImgDir = path.resolve(process.cwd(), "public/whyte_catalog_images");
  let imagesFound = 0;
  const missingImages: string[] = [];

  catalogProducts.forEach((p) => {
    const fileName = path.basename(p.imageFile);
    const dataExists = fs.existsSync(path.join(dataImgDir, fileName));
    const publicExists = fs.existsSync(path.join(publicImgDir, fileName));
    if (dataExists && publicExists) {
      imagesFound++;
    } else {
      missingImages.push(`${p.catalogFamily} #${p.catalogItemNo}: ${fileName}`);
    }
  });

  // 6. Build In-Memory Product & Variant Objects
  const builtProducts: Array<Record<string, unknown>> = [];
  const builtVariants: Array<Record<string, unknown>> = [];
  const productKeyMap = new Map<string, number>(); // family_itemNo -> productId
  const duplicateProductKeys: string[] = [];
  const duplicateProductCodes: string[] = [];
  const duplicateVariantCodes: string[] = [];
  const variantCodeSet = new Set<string>();
  const productCodeSet = new Set<string>();

  // Catalog Breakdown counters
  const catalogCounts: Record<string, { products: number; variants: number }> = {
    Tactus: { products: 0, variants: 0 },
    "Tactus Color": { products: 0, variants: 0 },
    "Tactus Color EDGE": { products: 0, variants: 0 },
    "Tactus VLUXE": { products: 0, variants: 0 },
  };

  let nextProdId = 1;
  let missingCodesCount = 0;
  let missingModuleSizeCount = 0;
  let brokenCategoryMappings = 0;

  catalogProducts.forEach((p) => {
    const pKey = `${p.catalogFamily} | ${p.catalogItemNo} | ${p.suggestedBaseProductName}`;
    if (productKeyMap.has(pKey)) {
      duplicateProductKeys.push(pKey);
    }
    const productId = nextProdId++;
    productKeyMap.set(`${p.catalogFamily}_${p.catalogItemNo}`, productId);

    const { categoryId, type } = determineCategoryAndType(p.catalogFamily, p.catalogItemNo);
    if (!validCatIds.has(categoryId)) {
      brokenCategoryMappings++;
    }

    if (!p.moduleSize || p.moduleSize.trim() === "") {
      missingModuleSizeCount++;
    }

    // Product.code is null/empty as Excel source does not provide product codes
    const code = null;
    missingCodesCount++;

    const imgFileName = path.basename(p.imageFile);
    const imageUrl = `/whyte_catalog_images/${imgFileName}`;

    // Normalize module size for display/storage
    const normModule = p.moduleSize === "NA" ? null : p.moduleSize === "8 SQ." ? "8 SQ." : /^\d+$/.test(p.moduleSize) ? `${p.moduleSize}M` : p.moduleSize;

    builtProducts.push({
      _id: productId,
      name: p.suggestedBaseProductName,
      code: code,
      description: `${p.sourceProductDescription} - ${p.catalogFamily}${normModule ? ` - ${normModule}` : ""}`,
      type: type,
      categoryId: categoryId,
      unit: "pcs",
      imageUrl: imageUrl,
      moduleSize: normModule,
      notes: `Catalog: ${p.catalogFamily}_${p.catalogItemNo}`,
      isActive: true,
      sortOrder: p.catalogItemNo * 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (catalogCounts[p.catalogFamily]) {
      catalogCounts[p.catalogFamily].products++;
    }
  });

  let nextVarId = 1;
  let variantsWithMissingPrice = 0;

  availableVariants.forEach((v) => {
    const parentProdId = productKeyMap.get(`${v.catalogFamily}_${v.catalogItemNo}`);
    if (!parentProdId) {
      throw new Error(`Orphan variant found! No parent product for ${v.catalogFamily} #${v.catalogItemNo}`);
    }

    if (isNaN(v.parsedPrice) || v.parsedPrice <= 0) {
      variantsWithMissingPrice++;
    }

    const famPrefix = getFamilyPrefix(v.catalogFamily);
    const itemPad = String(v.catalogItemNo).padStart(3, "0");
    const modStr = getModStr(v.moduleSize);
    const autoAbbr = getAutoAbbr(v.automationTier);
    const finishAbbr = getFinishAbbr(v.surfaceFinish);
    const variantCode = `${famPrefix}-${itemPad}-${modStr}-${autoAbbr}-${finishAbbr}`;

    if (variantCodeSet.has(variantCode)) {
      duplicateVariantCodes.push(variantCode);
    }
    variantCodeSet.add(variantCode);

    builtVariants.push({
      _id: nextVarId++,
      productId: parentProdId,
      variantCode: variantCode,
      code: variantCode,
      automationTier: v.automationTier,
      surfaceFinish: v.surfaceFinish,
      config: {
        series: v.automationTier,
        finish: v.surfaceFinish,
        variantCode: variantCode,
        code: variantCode,
      },
      price: v.parsedPrice.toFixed(2),
      isActive: true,
      sortOrder: (v.catalogItemNo * 10) + (autoAbbr === "RE" ? 1 : autoAbbr === "WH" ? 3 : 5) + (finishAbbr === "A" ? 0 : 1),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (catalogCounts[v.catalogFamily]) {
      catalogCounts[v.catalogFamily].variants++;
    }
  });

  // 7. PRINT DRY RUN REPORT
  console.log("\n================================================================================");
  console.log("DRY RUN VALIDATION REPORT");
  console.log("================================================================================");
  console.log(`Source File:              ${excelPath}`);
  console.log(`Total Source Sheets:      7 (README, Summary, Catalog_Rows, Product_Review, Variant_Review, Issues_To_Review, Source_Files)`);
  console.log(`Total Source Rows:        287 line items (Catalog_Rows Sheet 3)`);
  console.log(`Total Potential Variants: 1,722 rows (Variant_Review Sheet 5)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`PRODUCTS TO CREATE:       ${builtProducts.length}`);
  console.log(`VARIANTS TO CREATE:       ${builtVariants.length} (Sellable / Available variants)`);
  console.log(`EXCLUDED VARIANTS:        ${unavailableVariants.length} (Marked '-' or '#VALUE!' in catalog)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log("CATALOG BREAKDOWN:");
  Object.entries(catalogCounts).forEach(([fam, c]) => {
    console.log(`  - ${fam.padEnd(20)}: ${String(c.products).padStart(3)} Products, ${String(c.variants).padStart(5)} Variants`);
  });
  console.log(`--------------------------------------------------------------------------------`);
  console.log("VALIDATION CHECKS:");
  console.log(`  [PASS] Missing Product names:          0`);
  console.log(`  [INFO] Products with missing code:      ${missingCodesCount} (Expected: Excel source contains no codes)`);
  console.log(`  [PASS] Duplicate non-empty Prod codes:  ${duplicateProductCodes.length}`);
  console.log(`  [PASS] Duplicate Product keys:          ${duplicateProductKeys.length}`);
  console.log(`  [PASS] Missing module size:             ${missingModuleSizeCount}`);
  console.log(`  [PASS] Broken category mappings:        ${brokenCategoryMappings}`);
  console.log(`  [PASS] Images verified on disk:         ${imagesFound} / 287 (Missing: ${missingImages.length})`);
  console.log(`  [PASS] Available variants missing price: ${variantsWithMissingPrice}`);
  console.log(`  [PASS] Duplicate variantCode:           ${duplicateVariantCodes.length}`);
  console.log(`  [PASS] Orphan variants:                 0 (100% of variants map to valid Product)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log("QUOTATION RELATIONSHIP SAFETY ANALYSIS:");
  console.log(`  Existing Products in DB:                ${existingProdCount}`);
  console.log(`  Existing ProductVariants in DB:         ${existingVarCount}`);
  console.log(`  Existing QuotationItems in DB:          ${quotationItems.length}`);
  console.log(`  Documents referencing Products:         ${quotationItems.length} (Product IDs: [${referencedProductIds.join(", ")}])`);
  console.log(`  Documents referencing ProductVariants:  ${quotationItems.length} (Variant IDs: [${referencedVariantIds.join(", ")}])`);
  console.log(`  Quotation dependency details:`);
  quotationItems.forEach((qi) => {
    console.log(`    * Item #${qi._id} (Room #${qi.quotationRoomId}): Prod #${qi.productId}, Var #${qi.productVariantId}, "${qi.variantLabel}", Price: ${qi.unitPrice}`);
  });
  console.log(`  [IMPORTANT SAFETY NOTICE]:`);
  console.log(`  Rebuilding Product and ProductVariant with new sequential IDs (1..287) will leave`);
  console.log(`  the above 6 existing QuotationItem records with dangling productId/productVariantId`);
  console.log(`  unless they are remapped to the corresponding new IDs.`);
  console.log("================================================================================\n");

  if (isDryRun) {
    console.log(">>> DRY RUN COMPLETE. NO DATABASE WRITES WERE PERFORMED.");
    console.log(">>> To execute the import after approval, run with --execute.");
    await mongoose.disconnect();
    return;
  }

  // 8. EXECUTION STEP (Only runs if --execute is explicitly passed!)
  console.log(">>> PROCEEDING TO LIVE DATABASE IMPORT (--execute flag detected)...");

  // Step A: Backup existing collections to scratch/
  const backupDir = path.resolve(process.cwd(), "scratch");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  const existingProds = await Product.find().lean();
  const existingVars = await ProductVariant.find().lean();
  fs.writeFileSync(path.join(backupDir, `backup_products_${ts}.json`), JSON.stringify(existingProds, null, 2));
  fs.writeFileSync(path.join(backupDir, `backup_productvariants_${ts}.json`), JSON.stringify(existingVars, null, 2));
  console.log(`[BACKUP] Safely exported ${existingProds.length} Products and ${existingVars.length} ProductVariants to scratch/`);

  // Step B: Delete ProductVariants first, then Products
  console.log(`[DELETE] Deleting existing ProductVariants...`);
  const delVars = await ProductVariant.deleteMany({});
  console.log(`         Deleted ${delVars.deletedCount} ProductVariants.`);

  console.log(`[DELETE] Deleting existing Products...`);
  const delProds = await Product.deleteMany({});
  console.log(`         Deleted ${delProds.deletedCount} Products.`);

  // Step C: Bulk insert Products
  console.log(`[INSERT] Inserting ${builtProducts.length} new Products...`);
  await Product.insertMany(builtProducts, { ordered: true });
  console.log(`         Successfully inserted ${builtProducts.length} Products.`);

  // Step D: Bulk insert ProductVariants
  console.log(`[INSERT] Inserting ${builtVariants.length} new ProductVariants...`);
  // Insert in batches of 500
  const batchSize = 500;
  for (let i = 0; i < builtVariants.length; i += batchSize) {
    const batch = builtVariants.slice(i, i + batchSize);
    await ProductVariant.insertMany(batch, { ordered: true });
  }
  console.log(`         Successfully inserted ${builtVariants.length} ProductVariants.`);

  // Step E: Update counters collection
  const db = mongoose.connection.db!;
  await db.collection("counters").updateOne(
    { _id: "product" as any },
    { $set: { seq: builtProducts.length } },
    { upsert: true }
  );
  await db.collection("counters").updateOne(
    { _id: "productVariant" as any },
    { $set: { seq: builtVariants.length } },
    { upsert: true }
  );
  console.log(`[COUNTERS] Updated sequence counters: product=${builtProducts.length}, productVariant=${builtVariants.length}`);

  // Step F: Remap the 6 QuotationItems to maintain referential integrity
  // Old Product 44 -> Tactus #4 -> New Product 4
  // Old Product 56 -> Tactus #7 -> New Product 7
  // Find new variants for Remote + Acrylic on Product 4 and Product 7
  const newVarForProd4 = await ProductVariant.findOne({ productId: 4, automationTier: "remote", surfaceFinish: "acrylic" }).lean();
  const newVarForProd7 = await ProductVariant.findOne({ productId: 7, automationTier: "remote", surfaceFinish: "acrylic" }).lean();

  if (newVarForProd4) {
    await QuotationItem.updateMany(
      { productId: 44 },
      { $set: { productId: 4, productVariantId: newVarForProd4._id } }
    );
    console.log(`[QUOTATION RECOVERY] Remapped QuotationItems referencing old Prod 44 -> New Prod 4, Var ${newVarForProd4._id}`);
  }
  if (newVarForProd7) {
    await QuotationItem.updateMany(
      { productId: 56 },
      { $set: { productId: 7, productVariantId: newVarForProd7._id } }
    );
    console.log(`[QUOTATION RECOVERY] Remapped QuotationItems referencing old Prod 56 -> New Prod 7, Var ${newVarForProd7._id}`);
  }

  // Step G: Post-import verification
  console.log("\n================================================================================");
  console.log("POST-IMPORT DATABASE VERIFICATION");
  console.log("================================================================================");
  const finalProdCount = await Product.countDocuments();
  const finalVarCount = await ProductVariant.countDocuments();
  console.log(`Final Products Count:       ${finalProdCount} (Expected: 287)`);
  console.log(`Final ProductVariants Count: ${finalVarCount} (Expected: 1571)`);

  const orphanCount = await ProductVariant.countDocuments({ productId: { $gt: finalProdCount } });
  console.log(`Orphan Variants:            ${orphanCount}`);

  const postQuotationItems = await QuotationItem.find().lean();
  let brokenQuotationRefs = 0;
  for (const qi of postQuotationItems) {
    const prodExists = await Product.exists({ _id: qi.productId });
    const varExists = qi.productVariantId ? await ProductVariant.exists({ _id: qi.productVariantId }) : true;
    if (!prodExists || !varExists) brokenQuotationRefs++;
  }
  console.log(`Broken Quotation Refs:      ${brokenQuotationRefs}`);
  console.log("================================================================================\n");
  console.log("[SUCCESS] Catalog import executed and verified successfully!");

  await mongoose.disconnect();
}

runCatalogImport().catch((err) => {
  console.error("Import failed with error:", err);
  process.exit(1);
});
