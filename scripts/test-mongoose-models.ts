import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import {
  Company,
  Category,
  Product,
  ProductVariant,
  HouseType,
  RoomType,
  HouseTypeRoomTemplate,
  Quotation,
  QuotationRoom,
  QuotationItem,
  AdminUser,
} from "../src/models";

async function runModelValidation() {
  console.log("=== Phase 2: Mongoose Models Validation ===");

  // 1. Verify importing models does not trigger unexpected early DB connection
  console.log(`Initial Mongoose readyState before explicit connect: ${mongoose.connection.readyState} (Expected: 0 = disconnected)`);
  if (mongoose.connection.readyState !== 0) {
    throw new Error("Model import triggered unexpected connection!");
  }

  // 2. Verify all models are registered in mongoose.models
  const registeredModels = Object.keys(mongoose.models);
  console.log(`Registered models count: ${registeredModels.length}`);
  console.log(`Registered models list: ${registeredModels.join(", ")}`);

  const expectedModels = [
    "Company",
    "Category",
    "Product",
    "ProductVariant",
    "HouseType",
    "RoomType",
    "HouseTypeRoomTemplate",
    "Quotation",
    "QuotationRoom",
    "QuotationItem",
    "AdminUser",
  ];

  for (const modelName of expectedModels) {
    if (!registeredModels.includes(modelName)) {
      throw new Error(`Expected model "${modelName}" is not registered in Mongoose!`);
    }
  }
  console.log("[PASS] All 11 expected Mongoose models are properly registered.");

  // 3. Test Hot-Reload re-import safety (ensure mongoose.models.X || mongoose.model(...) prevents OverwriteModelError)
  console.log("Testing hot-reload simulation by re-importing models...");
  delete require.cache[require.resolve("../src/models")];
  delete require.cache[require.resolve("../src/models/Company")];
  delete require.cache[require.resolve("../src/models/Category")];
  delete require.cache[require.resolve("../src/models/Product")];
  delete require.cache[require.resolve("../src/models/ProductVariant")];
  delete require.cache[require.resolve("../src/models/HouseType")];
  delete require.cache[require.resolve("../src/models/RoomType")];
  delete require.cache[require.resolve("../src/models/HouseTypeRoomTemplate")];
  delete require.cache[require.resolve("../src/models/Quotation")];
  delete require.cache[require.resolve("../src/models/QuotationRoom")];
  delete require.cache[require.resolve("../src/models/QuotationItem")];
  delete require.cache[require.resolve("../src/models/AdminUser")];

  const reloaded = require("../src/models");
  if (!reloaded.Product || !reloaded.Quotation) {
    throw new Error("Re-importing models failed during hot reload simulation");
  }
  console.log("[PASS] Hot reload simulation passed (No OverwriteModelError).");

  // 4. Connect to MongoDB to test model instantiation & schema types
  await connectMongoDB();
  console.log("[PASS] MongoDB connected via src/lib/mongodb.ts");

  // 5. Test Model instantiation & Decimal / JSON field validations
  const testProduct = new Product({
    _id: 9999,
    name: "Test Switch Board",
    type: "switch_board",
    price: "1500.50",
    unit: "pcs",
    isMatrix: true,
    matrixDimensions: [{ key: "finish", label: "Finish", options: ["glass", "metal"] }],
  });

  const productJson = testProduct.toJSON();
  console.log(`Product instance created: ID=${productJson.id}, Name=${productJson.name}, Price=${productJson.price}`);
  if (productJson.id !== 9999) throw new Error("Product ID virtual failed");
  if (productJson.price !== "1500.50") throw new Error(`Decimal getter failed: got ${productJson.price}`);

  const testQuotation = new Quotation({
    _id: "cuid_test_123",
    quotationNumber: "WQ-TEST-001",
    clientName: "Test Client",
    status: "draft",
    discountType: "percentage",
    discountValue: "10.00",
  });
  const quotationJson = testQuotation.toJSON();
  console.log(`Quotation instance created: ID=${quotationJson.id}, QuotationNumber=${quotationJson.quotationNumber}, DiscountValue=${quotationJson.discountValue}`);
  if (quotationJson.id !== "cuid_test_123") throw new Error("Quotation ID virtual failed");
  if (quotationJson.discountValue !== "10.00") throw new Error(`Quotation discountValue failed: got ${quotationJson.discountValue}`);

  console.log("\n[SUCCESS] Phase 2: All 11 Mongoose data models validated successfully!");

  await mongoose.disconnect();
  console.log("Mongoose connection closed cleanly.");
}

runModelValidation().catch((err) => {
  console.error("[FAILED] Model validation error:", err);
  process.exit(1);
});
