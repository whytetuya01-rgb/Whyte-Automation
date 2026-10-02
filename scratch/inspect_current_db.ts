import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import {
  Category,
  Product,
  ProductVariant,
  Quotation,
  QuotationRoom,
  QuotationItem,
  HouseType,
  Company,
  AdminUser
} from "../src/models";

async function inspectDb() {
  await connectMongoDB();
  console.log("Connected to MongoDB:", mongoose.connection.name);

  // Collections and counts
  const collections = await mongoose.connection.db!.listCollections().toArray();
  console.log("\n=== ALL COLLECTIONS IN DATABASE ===");
  for (const col of collections) {
    const count = await mongoose.connection.db!.collection(col.name).countDocuments();
    console.log(`- ${col.name}: ${count} documents`);
  }

  // Categories
  console.log("\n=== EXISTING CATEGORIES ===");
  const categories = await Category.find().sort({ _id: 1 }).lean();
  for (const cat of categories) {
    console.log(`ID: ${cat._id} | Name: "${cat.name}" | Level: ${cat.level} | ParentId: ${cat.parentId} | Active: ${cat.isActive}`);
  }

  // Quotation references check
  console.log("\n=== QUOTATION REFERENCES CHECK ===");
  const quotationCount = await Quotation.countDocuments();
  const roomCount = await QuotationRoom.countDocuments();
  const itemCount = await QuotationItem.countDocuments();
  console.log(`Quotations: ${quotationCount}`);
  console.log(`QuotationRooms: ${roomCount}`);
  console.log(`QuotationItems: ${itemCount}`);

  if (itemCount > 0) {
    const sampleItems = await QuotationItem.find().limit(5).lean();
    console.log("Sample QuotationItems:", JSON.stringify(sampleItems, null, 2));

    const distinctProductIds = await QuotationItem.distinct("productId");
    const distinctVariantIds = await QuotationItem.distinct("productVariantId");
    console.log(`Referenced distinct productIds in QuotationItem:`, distinctProductIds);
    console.log(`Referenced distinct productVariantIds in QuotationItem:`, distinctVariantIds);
  } else {
    console.log("No QuotationItems exist in database.");
  }

  // Products check
  console.log("\n=== EXISTING PRODUCTS SAMPLE ===");
  const prodCount = await Product.countDocuments();
  console.log(`Total Products: ${prodCount}`);
  if (prodCount > 0) {
    const sampleProds = await Product.find().limit(3).lean();
    console.log("Sample Products:", JSON.stringify(sampleProds, null, 2));
  }

  // ProductVariants check
  console.log("\n=== EXISTING PRODUCT VARIANTS SAMPLE ===");
  const varCount = await ProductVariant.countDocuments();
  console.log(`Total ProductVariants: ${varCount}`);
  if (varCount > 0) {
    const sampleVars = await ProductVariant.find().limit(3).lean();
    console.log("Sample ProductVariants:", JSON.stringify(sampleVars, null, 2));
  }

  await mongoose.disconnect();
}

inspectDb().catch(err => {
  console.error("Inspection error:", err);
  process.exit(1);
});
