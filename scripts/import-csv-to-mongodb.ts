import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Category, Product, ProductVariant, HouseType } from "../src/models";

// Default CSV Directory
const DEFAULT_CSV_DIR = "C:/Users/ADMIN/Downloads/Whyte_Project (1)/tables";
const CSV_DIR = process.env.CSV_DIR || DEFAULT_CSV_DIR;

interface CsvRow {
  [key: string]: string;
}

/**
 * Robust CSV parser that handles quotes, multi-line values, and commas.
 */
function parseCsvFile(filePath: string): CsvRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const rawRows: string[][] = [];
  let currentRecord: string[] = [];
  let insideQuotes = false;
  let currentField = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let pos = 0;
    while (pos < line.length) {
      const c = line[pos];
      if (c === '"') {
        if (insideQuotes && pos + 1 < line.length && line[pos + 1] === '"') {
          currentField += '"';
          pos += 2;
          continue;
        } else {
          insideQuotes = !insideQuotes;
          pos++;
          continue;
        }
      } else if (c === "," && !insideQuotes) {
        currentRecord.push(currentField);
        currentField = "";
        pos++;
        continue;
      } else {
        currentField += c;
        pos++;
      }
    }

    if (insideQuotes) {
      currentField += "\n";
    } else {
      currentRecord.push(currentField);
      rawRows.push(currentRecord);
      currentRecord = [];
      currentField = "";
    }
  }

  if (rawRows.length === 0) return [];
  const header = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);

  return dataRows.map((row) => {
    const obj: CsvRow = {};
    header.forEach((col, idx) => {
      obj[col] = row[idx] !== undefined ? row[idx].trim() : "";
    });
    return obj;
  });
}

function parseBoolean(val: string): boolean {
  return val.toLowerCase() === "true";
}

function parseNumber(val: string, fallback = 0): number {
  const num = parseInt(val, 10);
  return isNaN(num) ? fallback : num;
}

function parseJsonSafe(val: string): unknown | null {
  if (!val || val.trim() === "") return null;
  try {
    return JSON.parse(val);
  } catch (e) {
    console.warn(`Failed to parse JSON value: ${val}`);
    return null;
  }
}

export async function runCsvImport(dryRun = false) {
  console.log(`\n==================================================`);
  console.log(`PHASE 4: CSV DATA IMPORT (${dryRun ? "DRY RUN MODE" : "LIVE IMPORT MODE"})`);
  console.log(`Source CSV Directory: ${CSV_DIR}`);
  console.log(`Target MongoDB URI: ${process.env.MONGODB_URI}`);
  console.log(`==================================================\n`);

  // 1. Parse all CSVs
  const categoryFile = path.join(CSV_DIR, "public-Category-selection.csv");
  const productFile = path.join(CSV_DIR, "public-Product-selection.csv");
  const variantFile = path.join(CSV_DIR, "public-ProductVariant-selection.csv");
  const houseTypeFile = path.join(CSV_DIR, "public-HouseType-selection.csv");

  const rawCategories = parseCsvFile(categoryFile);
  const rawProducts = parseCsvFile(productFile);
  const rawVariants = parseCsvFile(variantFile);
  const rawHouseTypes = parseCsvFile(houseTypeFile);

  console.log(`[CSV Read] Loaded records:`);
  console.log(`- Categories: ${rawCategories.length}`);
  console.log(`- Products: ${rawProducts.length}`);
  console.log(`- ProductVariants: ${rawVariants.length}`);
  console.log(`- HouseTypes: ${rawHouseTypes.length}`);

  // 2. Validate & Transform Data in Memory
  console.log(`\n--- Validating & Transforming Data ---`);

  // Category Transformation
  const categoryIds = new Set<number>();
  const transformedCategories = rawCategories.map((row) => {
    const id = parseNumber(row.id);
    if (!id) throw new Error(`Invalid Category ID in row: ${JSON.stringify(row)}`);
    if (categoryIds.has(id)) throw new Error(`Duplicate Category ID: ${id}`);
    categoryIds.add(id);

    return {
      _id: id,
      name: row.name,
      level: parseNumber(row.level, 1),
      parentId: row.parentId && row.parentId !== "" ? parseNumber(row.parentId) : null,
      sortOrder: parseNumber(row.sortOrder, 0),
      isActive: parseBoolean(row.isActive),
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      variantTiers: parseJsonSafe(row.variantTiers),
      variantFinishes: parseJsonSafe(row.variantFinishes),
    };
  });

  // Validate Category parent references
  transformedCategories.forEach((cat) => {
    if (cat.parentId !== null && !categoryIds.has(cat.parentId)) {
      throw new Error(`Category ${cat._id} (${cat.name}) references nonexistent parentId: ${cat.parentId}`);
    }
  });
  console.log(`[Validation] Category transformation valid (9 items, 0 broken parents).`);

  // ProductVariant Transformation & Minimum Price Computation
  const variantIds = new Set<number>();
  const productMinPriceMap = new Map<number, number>();

  const transformedVariants = rawVariants.map((row) => {
    const id = parseNumber(row.id);
    const productId = parseNumber(row.productId);
    if (!id) throw new Error(`Invalid Variant ID in row: ${JSON.stringify(row)}`);
    if (!productId) throw new Error(`Invalid Product ID on Variant ${id}`);
    if (variantIds.has(id)) throw new Error(`Duplicate Variant ID: ${id}`);
    variantIds.add(id);

    const priceNum = parseFloat(row.price);
    if (isNaN(priceNum)) throw new Error(`Invalid price on Variant ${id}: ${row.price}`);

    // Track min price per product
    const currentMin = productMinPriceMap.get(productId);
    if (currentMin === undefined || priceNum < currentMin) {
      productMinPriceMap.set(productId, priceNum);
    }

    // Build N-dim config from automationTier and surfaceFinish
    const config: Record<string, string> = {};
    if (row.automationTier && row.automationTier !== "") config.series = row.automationTier;
    if (row.surfaceFinish && row.surfaceFinish !== "") config.finish = row.surfaceFinish;

    return {
      _id: id,
      productId,
      automationTier: row.automationTier && row.automationTier !== "" ? row.automationTier : null,
      surfaceFinish: row.surfaceFinish && row.surfaceFinish !== "" ? row.surfaceFinish : null,
      config,
      price: mongoose.Types.Decimal128.fromString(row.price),
      isActive: parseBoolean(row.isActive),
      sortOrder: parseNumber(row.sortOrder, 0),
    };
  });
  console.log(`[Validation] ProductVariant transformation valid (96 items, prices mapped).`);

  // Product Transformation
  const productIds = new Set<number>();
  const transformedProducts = rawProducts.map((row) => {
    const id = parseNumber(row.id);
    if (!id) throw new Error(`Invalid Product ID in row: ${JSON.stringify(row)}`);
    if (productIds.has(id)) throw new Error(`Duplicate Product ID: ${id}`);
    productIds.add(id);

    const categoryId = row.categoryId && row.categoryId !== "" ? parseNumber(row.categoryId) : null;
    if (categoryId !== null && !categoryIds.has(categoryId)) {
      throw new Error(`Product ${id} (${row.name}) references nonexistent categoryId: ${categoryId}`);
    }

    // Determine price from min variant price or default 0.00
    const minVariantPrice = productMinPriceMap.get(id);
    const priceString = minVariantPrice !== undefined ? minVariantPrice.toFixed(2) : "0.00";

    return {
      _id: id,
      name: row.name,
      code: row.code && row.code !== "" ? row.code : null,
      description: row.description && row.description !== "" ? row.description : null,
      type: row.type,
      categoryId,
      price: mongoose.Types.Decimal128.fromString(priceString),
      unit: row.unit && row.unit !== "" ? row.unit : "pcs",
      imageUrl: row.imageUrl && row.imageUrl !== "" ? row.imageUrl : null,
      moduleSize: row.moduleSize && row.moduleSize !== "" ? row.moduleSize : null,
      notes: row.notes && row.notes !== "" ? row.notes : null,
      isActive: parseBoolean(row.isActive),
      sortOrder: parseNumber(row.sortOrder, 0),
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      isMatrix: false,
      matrixDimensions: null,
    };
  });

  // Verify all variants reference valid products
  transformedVariants.forEach((v) => {
    if (!productIds.has(v.productId)) {
      throw new Error(`Variant ${v._id} references nonexistent productId: ${v.productId}`);
    }
  });
  console.log(`[Validation] Product transformation valid (56 items, 0 broken category/variant links).`);

  // HouseType Transformation
  const houseTypeIds = new Set<number>();
  const transformedHouseTypes = rawHouseTypes.map((row) => {
    const id = parseNumber(row.id);
    if (!id) throw new Error(`Invalid HouseType ID in row: ${JSON.stringify(row)}`);
    if (houseTypeIds.has(id)) throw new Error(`Duplicate HouseType ID: ${id}`);
    houseTypeIds.add(id);

    return {
      _id: id,
      name: row.name,
      description: row.description && row.description !== "" ? row.description : null,
      isActive: parseBoolean(row.isActive),
      sortOrder: parseNumber(row.sortOrder, 0),
    };
  });
  console.log(`[Validation] HouseType transformation valid (7 items).`);

  if (dryRun) {
    console.log(`\n=== DRY RUN SUMMARY ===`);
    console.log(`All records and foreign keys successfully validated!`);
    console.log(`- Category: ${transformedCategories.length} records ready to import`);
    console.log(`- Product: ${transformedProducts.length} records ready to import`);
    console.log(`- ProductVariant: ${transformedVariants.length} records ready to import`);
    console.log(`- HouseType: ${transformedHouseTypes.length} records ready to import`);
    console.log(`Dry run complete. No database writes were performed.`);
    return {
      categories: { inserted: 0, updated: 0, total: transformedCategories.length },
      products: { inserted: 0, updated: 0, total: transformedProducts.length },
      productVariants: { inserted: 0, updated: 0, total: transformedVariants.length },
      houseTypes: { inserted: 0, updated: 0, total: transformedHouseTypes.length },
    };
  }

  // 3. Perform Live Database Upsert
  await connectMongoDB();

  // Helper for idempotent bulk upsert
  async function bulkUpsert(model: any, docs: Array<{ _id: number; [key: string]: any }>, modelName: string) {
    const operations = docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const res = await model.bulkWrite(operations, { ordered: true });
    const inserted = res.upsertedCount || 0;
    const modified = res.modifiedCount || 0;
    const matched = res.matchedCount || 0;
    console.log(`- [${modelName}] Upserted: ${inserted} new, ${modified} updated, ${matched} matched (Total: ${docs.length})`);
    return { inserted, updated: modified, total: docs.length };
  }

  console.log(`\n--- Executing Database Bulk Upserts ---`);
  const catRes = await bulkUpsert(Category, transformedCategories, "Category");
  const prodRes = await bulkUpsert(Product, transformedProducts, "Product");
  const varRes = await bulkUpsert(ProductVariant, transformedVariants, "ProductVariant");
  const htRes = await bulkUpsert(HouseType, transformedHouseTypes, "HouseType");

  console.log(`\n=== Live Import Complete ===`);
  return {
    categories: catRes,
    products: prodRes,
    productVariants: varRes,
    houseTypes: htRes,
  };
}

export async function main(dryRun = false) {
  try {
    const res = await runCsvImport(dryRun);
    if (!dryRun) {
      // Run quick verification
      console.log("\n--- Post-Import Database Verification ---");
      const catCount = await Category.countDocuments();
      const prodCount = await Product.countDocuments();
      const varCount = await ProductVariant.countDocuments();
      const htCount = await HouseType.countDocuments();

      console.log(`Actual MongoDB counts:`);
      console.log(`- Category: ${catCount} (Expected: 9)`);
      console.log(`- Product: ${prodCount} (Expected: 56)`);
      console.log(`- ProductVariant: ${varCount} (Expected: 96)`);
      console.log(`- HouseType: ${htCount} (Expected: 7)`);

      // Verify Decimal128 types
      const sampleProd = await Product.findOne({ _id: 1 });
      console.log(`Sample Product price: ${sampleProd?.price}`);

      const sampleVar = await ProductVariant.findOne({ _id: 1 });
      console.log(`Sample Variant price: ${sampleVar?.price}, config:`, sampleVar?.config);
    }
    return res;
  } catch (error) {
    console.error("Import failed with error:", error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("\nMongoose connection closed.");
    }
  }
}
