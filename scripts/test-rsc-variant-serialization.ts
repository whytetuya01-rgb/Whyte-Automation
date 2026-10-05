import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Product, ProductVariant } from "@/models";
import { normalizeProduct, normalizeProducts } from "@/lib/quotationNormalization";
import { serializeVariant } from "@/lib/productVariantService";

async function main() {
  console.log("==================================================");
  console.log("TESTING RSC PRODUCT & VARIANT SERIALIZATION");
  console.log("==================================================");

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");

  await mongoose.connect(uri);
  console.log("[PASS] Connected to MongoDB Atlas.");

  // Fetch Product 185 with its variants (which includes Variant 829 from the error)
  const rawProduct = await Product.findById(185)
    .populate({ path: "variants" })
    .lean({ virtuals: true, getters: true });

  if (!rawProduct) {
    throw new Error("Product 185 not found");
  }

  console.log("\n--- 1. Inspecting Raw Product 185 ---");
  const rawVariant829 = (rawProduct as any).variants?.find((v: any) => v._id === 829 || v.id === 829);
  console.log("Raw Variant 829 keys:", Object.keys(rawVariant829));
  console.log("Raw Variant 829 priceWithoutTax:", rawVariant829.priceWithoutTax);
  console.log("Raw priceWithoutTax has toJSON:", typeof rawVariant829.priceWithoutTax?.toJSON);

  console.log("\n--- 2. Inspecting Normalized Product 185 ---");
  const normalizedProduct = normalizeProduct(rawProduct);
  const normVariant829 = normalizedProduct.variants?.find((v) => v.id === 829);
  console.log("Normalized Variant 829:", normVariant829);

  if (!normVariant829) {
    throw new Error("Normalized Variant 829 not found");
  }

  // Verifications
  if (typeof normVariant829.priceWithoutTax !== "string") {
    throw new Error(`priceWithoutTax is not string: ${typeof normVariant829.priceWithoutTax}`);
  }
  if (typeof normVariant829.taxPercent !== "string") {
    throw new Error(`taxPercent is not string: ${typeof normVariant829.taxPercent}`);
  }
  if (typeof normVariant829.taxAmount !== "string") {
    throw new Error(`taxAmount is not string: ${typeof normVariant829.taxAmount}`);
  }
  if (typeof normVariant829.cost !== "string") {
    throw new Error(`cost is not string: ${typeof normVariant829.cost}`);
  }
  if (typeof normVariant829.purchaseTaxPercent !== "string") {
    throw new Error(`purchaseTaxPercent is not string: ${typeof normVariant829.purchaseTaxPercent}`);
  }
  if (normVariant829.automationTier !== "remote") {
    throw new Error(`automationTier expected 'remote', got: ${normVariant829.automationTier}`);
  }
  if (normVariant829.surfaceFinish !== "glass") {
    throw new Error(`surfaceFinish expected 'glass', got: ${normVariant829.surfaceFinish}`);
  }
  if (normVariant829.tierLabel !== "Remote") {
    throw new Error(`tierLabel expected 'Remote', got: ${normVariant829.tierLabel}`);
  }
  if (normVariant829.finishLabel !== "Glass") {
    throw new Error(`finishLabel expected 'Glass', got: ${normVariant829.finishLabel}`);
  }

  console.log("[PASS] Variant 829 field types & values verified successfully!");

  console.log("\n--- 3. Verifying RSC Serialization (Zero toJSON methods) ---");
  function checkNoToJSON(obj: any, path = "root") {
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.toJSON === "function") {
      throw new Error(`RSC REJECTION RISK: Found toJSON at ${path}: ${obj}`);
    }
    for (const [key, val] of Object.entries(obj)) {
      checkNoToJSON(val, `${path}.${key}`);
    }
  }

  checkNoToJSON(normalizedProduct, "product185");
  console.log("[PASS] Recursively checked normalized Product 185: ZERO objects with toJSON methods found!");

  console.log("\n--- 4. Testing Product Batch Normalization (All Products) ---");
  const allActive = await Product.find({ isActive: true })
    .populate({ path: "variants", match: { isActive: true } })
    .lean({ virtuals: true, getters: true });

  const normalizedBatch = normalizeProducts(allActive);
  checkNoToJSON(normalizedBatch, "allActiveProducts");
  console.log(`[PASS] Successfully normalized ${normalizedBatch.length} active products with all their variants for RSC!`);

  console.log("\n==================================================");
  console.log("ALL RSC SERIALIZATION CHECKS PASSED!");
  console.log("==================================================");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
