import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import { Product } from "../src/models";

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

async function runInvestigation() {
  console.log("================================================================================");
  console.log("DETAILED CATALOG & IMAGE INVESTIGATION");
  console.log("================================================================================\n");

  await connectMongoDB();

  // 1. Inspect MongoDB Products
  const products = await Product.find().lean().sort({ _id: 1 });
  const totalProducts = products.length;

  const withImageUrl = products.filter((p) => p.imageUrl && p.imageUrl !== "null" && p.imageUrl.trim() !== "");
  const withLocalPath = products.filter((p) => p.imageUrl && p.imageUrl.startsWith("/whyte_catalog_images/"));
  const withCloudinaryUrl = products.filter((p) => p.imageUrl && p.imageUrl.includes("res.cloudinary.com"));
  const withNullOrEmptyUrl = products.filter((p) => !p.imageUrl || p.imageUrl === "null" || p.imageUrl.trim() === "");
  const withImagePublicId = products.filter((p) => p.imagePublicId && p.imagePublicId.trim() !== "");

  console.log("1. MONGODB PRODUCTS STATS:");
  console.log(` - Total Products in DB: ${totalProducts}`);
  console.log(` - Products with non-empty imageUrl: ${withImageUrl.length}`);
  console.log(` - Products with imageUrl starting with /whyte_catalog_images/: ${withLocalPath.length}`);
  console.log(` - Products with Cloudinary URLs (res.cloudinary.com): ${withCloudinaryUrl.length}`);
  console.log(` - Products with null/empty imageUrl: ${withNullOrEmptyUrl.length}`);
  console.log(` - Products with imagePublicId: ${withImagePublicId.length}\n`);

  // 2. Inspect Local Catalog Image Directory
  const localDirPublic = path.resolve(process.cwd(), "public/whyte_catalog_images");
  const localDirData = path.resolve(process.cwd(), "data/whyte_catalog_images");

  const publicFiles = fs.existsSync(localDirPublic) ? fs.readdirSync(localDirPublic) : [];
  const dataFiles = fs.existsSync(localDirData) ? fs.readdirSync(localDirData) : [];

  console.log("2. LOCAL CATALOG IMAGE DIRECTORY STATS:");
  console.log(` - Files in public/whyte_catalog_images/: ${publicFiles.length}`);
  console.log(` - Files in data/whyte_catalog_images/: ${dataFiles.length}\n`);

  // 3. Inspect Sheet 3 XML catalog source
  const sheet3Path = path.resolve(process.cwd(), "scratch/final_xlsx_extracted/xl/worksheets/sheet3.xml");
  const rawCatalogRows = parseSheetXml(sheet3Path).slice(1);
  console.log("3. EXCEL CATALOG SOURCE STATS:");
  console.log(` - Catalog Rows in Sheet 3: ${rawCatalogRows.length}`);

  const catalogImageMappings: Array<{
    itemNo: number;
    family: string;
    name: string;
    imageFile: string;
    imageFileName: string;
    expectedLocalPath: string;
    localFileExists: boolean;
  }> = rawCatalogRows.map((r, idx) => {
    const family = r.data["A"]?.trim() || "";
    const itemNo = parseInt(r.data["B"], 10) || idx + 1;
    const name = r.data["E"]?.trim() || "";
    const imageFile = r.data["N"]?.trim() || "";
    const imageFileName = path.basename(imageFile);
    const expectedLocalPath = `/whyte_catalog_images/${imageFileName}`;
    const localFileExists = fs.existsSync(path.join(localDirPublic, imageFileName));
    return {
      itemNo,
      family,
      name,
      imageFile,
      imageFileName,
      expectedLocalPath,
      localFileExists,
    };
  });

  console.log(` - Valid catalog image mappings in Excel: ${catalogImageMappings.length}`);
  const existingFilesCount = catalogImageMappings.filter((m) => m.localFileExists).length;
  console.log(` - Catalog image files physically present on disk: ${existingFilesCount} / ${catalogImageMappings.length}\n`);

  // 4. Match Database Products with Excel Catalog Mappings
  console.log("4. MATCHING MONGODB PRODUCTS WITH CATALOG MAPPINGS:");
  let matchByNotesCount = 0;
  let matchByOrderCount = 0;

  const matchedReport: Array<{
    dbId: number;
    dbName: string;
    dbNotes: string | null;
    currentImageUrl: string | null;
    expectedLocalPath: string;
    localFileExists: boolean;
  }> = [];

  products.forEach((p, idx) => {
    // Check if notes has "Catalog: Family_ItemNo"
    let catalogItem = catalogImageMappings[idx]; // default by 1-to-1 order
    if (p.notes && p.notes.includes("Catalog:")) {
      const match = p.notes.match(/Catalog:\s*([^_]+)_(\d+)/);
      if (match) {
        const famPrefix = match[1];
        const itemNo = parseInt(match[2], 10);
        const found = catalogImageMappings.find(
          (m) => m.itemNo === itemNo && m.family.toLowerCase().includes(famPrefix.toLowerCase())
        );
        if (found) {
          catalogItem = found;
          matchByNotesCount++;
        }
      }
    }

    if (catalogItem) {
      matchByOrderCount++;
      matchedReport.push({
        dbId: p._id,
        dbName: p.name,
        dbNotes: p.notes ?? null,
        currentImageUrl: p.imageUrl ?? null,
        expectedLocalPath: catalogItem.expectedLocalPath,
        localFileExists: catalogItem.localFileExists,
      });
    }
  });

  console.log(` - Products matched with catalog image maps: ${matchedReport.length}`);
  console.log(`   - Matched by notes tag: ${matchByNotesCount}`);
  console.log(`   - Matched by 1-to-1 catalog index: ${matchedReport.length - matchByNotesCount}`);

  // Report sample of 10 matched products
  console.log("\nSample Catalog Products & Image Mappings:");
  matchedReport.slice(0, 15).forEach((m) => {
    console.log(` Product #${m.dbId} ("${m.dbName}")`);
    console.log(`   Current DB imageUrl: "${m.currentImageUrl}"`);
    console.log(`   Expected Local Path: "${m.expectedLocalPath}" (File exists: ${m.localFileExists})`);
  });

  process.exit(0);
}

runInvestigation().catch((err) => {
  console.error("Investigation crashed:", err);
  process.exit(1);
});
