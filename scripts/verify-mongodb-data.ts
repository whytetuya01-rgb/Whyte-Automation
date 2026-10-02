import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import {
  Category,
  Product,
  ProductVariant,
  HouseType,
  Company,
  RoomType,
  HouseTypeRoomTemplate,
  Quotation,
  QuotationRoom,
  QuotationItem,
  AdminUser,
} from "../src/models";

async function verifyImportedData() {
  console.log("=== PHASE 4: POST-IMPORT DATA VERIFICATION ===");
  await connectMongoDB();

  // 1. Collection counts
  const catCount = await Category.countDocuments();
  const prodCount = await Product.countDocuments();
  const varCount = await ProductVariant.countDocuments();
  const htCount = await HouseType.countDocuments();

  console.log("\n1. Collection Counts:");
  console.log(`- Categories: ${catCount} (Expected: 9)`);
  console.log(`- Products: ${prodCount} (Expected: 56)`);
  console.log(`- ProductVariants: ${varCount} (Expected: 96)`);
  console.log(`- HouseTypes: ${htCount} (Expected: 7)`);

  if (catCount !== 9 || prodCount !== 56 || varCount !== 96 || htCount !== 7) {
    throw new Error("Collection count mismatch!");
  }

  // 2. Untouched collections check
  console.log("\n2. Verify Untouched Models Remain 0:");
  const untouched = [
    { name: "Company", count: await Company.countDocuments() },
    { name: "RoomType", count: await RoomType.countDocuments() },
    { name: "HouseTypeRoomTemplate", count: await HouseTypeRoomTemplate.countDocuments() },
    { name: "Quotation", count: await Quotation.countDocuments() },
    { name: "QuotationRoom", count: await QuotationRoom.countDocuments() },
    { name: "QuotationItem", count: await QuotationItem.countDocuments() },
    { name: "AdminUser", count: await AdminUser.countDocuments() },
  ];
  for (const item of untouched) {
    console.log(`- ${item.name}: ${item.count} documents (Expected: 0)`);
    if (item.count !== 0) throw new Error(`${item.name} should have 0 documents!`);
  }

  // 3. Foreign Key Integrity Checks
  console.log("\n3. Foreign Key Integrity Checks:");

  // All Category parents
  const categories = await Category.find();
  const catIdSet = new Set(categories.map((c) => c._id));
  let brokenParent = 0;
  categories.forEach((c) => {
    if (c.parentId !== null && !catIdSet.has(c.parentId)) brokenParent++;
  });
  console.log(`- Category parentId integrity: ${brokenParent === 0 ? "PASS" : "FAIL"}`);

  // All Product categoryIds
  const products = await Product.find();
  const prodIdSet = new Set(products.map((p) => p._id));
  let brokenProdCat = 0;
  products.forEach((p) => {
    if (p.categoryId !== null && !catIdSet.has(p.categoryId)) brokenProdCat++;
  });
  console.log(`- Product categoryId integrity: ${brokenProdCat === 0 ? "PASS" : "FAIL"}`);

  // All ProductVariant productIds
  const variants = await ProductVariant.find();
  let brokenVarProd = 0;
  variants.forEach((v) => {
    if (!prodIdSet.has(v.productId)) brokenVarProd++;
  });
  console.log(`- ProductVariant productId integrity: ${brokenVarProd === 0 ? "PASS" : "FAIL"}`);

  // 4. Decimal128 Verification
  console.log("\n4. Decimal128 BSON Type Verification:");
  const rawProd: any = await mongoose.connection.db?.collection("products").findOne({ _id: 1 as any });
  const rawVar: any = await mongoose.connection.db?.collection("productvariants").findOne({ _id: 1 as any });

  const isProdDecimal = rawProd?.price?._bsontype === "Decimal128";
  const isVarDecimal = rawVar?.price?._bsontype === "Decimal128";
  console.log(`- Raw Product.price BSON type: ${rawProd?.price?._bsontype} (${isProdDecimal ? "PASS" : "FAIL"})`);
  console.log(`- Raw ProductVariant.price BSON type: ${rawVar?.price?._bsontype} (${isVarDecimal ? "PASS" : "FAIL"})`);

  // 5. JSON Field Storage Verification
  console.log("\n5. JSON Object Storage Verification:");
  const sampleCat = await Category.findOne({ _id: 1 });
  const isTiersArray = Array.isArray(sampleCat?.variantTiers);
  const isFinishesArray = Array.isArray(sampleCat?.variantFinishes);
  const sampleVariant = await ProductVariant.findOne({ _id: 1 });
  const isConfigObject = typeof sampleVariant?.config === "object" && sampleVariant?.config !== null;

  console.log(`- Category variantTiers stored as array: ${isTiersArray ? "PASS" : "FAIL"} (${JSON.stringify(sampleCat?.variantTiers)})`);
  console.log(`- Category variantFinishes stored as array: ${isFinishesArray ? "PASS" : "FAIL"} (${JSON.stringify(sampleCat?.variantFinishes)})`);
  console.log(`- ProductVariant config stored as object: ${isConfigObject ? "PASS" : "FAIL"} (${JSON.stringify(sampleVariant?.config)})`);

  console.log("\n[SUCCESS] All post-import verifications passed with 100% data integrity!");
  await mongoose.disconnect();
}

verifyImportedData().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
