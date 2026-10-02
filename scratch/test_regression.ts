import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const nextAuth = require("next-auth/next");
nextAuth.getServerSession = async () => ({ user: { email: "admin@whyte.co.in", role: "admin" } });

import { PATCH } from "../src/app/api/products/[id]/route";
import { POST } from "../src/app/api/products/route";
import { Product, ProductVariant } from "../src/models/index";
import { connectMongoDB } from "../src/lib/mongodb";

function createRequest(body: any, method = "PATCH") {
  return new Request("http://localhost:3000/api/products/207", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runTests() {
  await connectMongoDB();
  console.log("=== RUNNING REGRESSION TESTS FOR PATCH /api/products/[id] ===");

  // Baseline inspection of Product 207
  const initialProduct = await Product.findById(207).lean();
  const initialVariants = await ProductVariant.find({ productId: 207 }).lean();
  console.log(`[BASELINE] Product 207 name: "${initialProduct?.name}", isActive: ${initialProduct?.isActive}, variants: ${initialVariants.length}`);

  // Test 1: Invalid isActive values are rejected
  console.log("\n--- TEST 1: Invalid isActive values rejected ---");
  const invalidBodies = [
    { isActive: "false" },
    { isActive: 1 },
    { isActive: null },
    { isActive: "true" }
  ];
  for (const b of invalidBodies) {
    const req = createRequest(b);
    const res = await PATCH(req, { params: Promise.resolve({ id: "207" }) });
    const json = await res.json();
    console.log(`Input ${JSON.stringify(b)} -> Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    if (res.status !== 400 || json.error !== "isActive must be a boolean") {
      throw new Error(`Test 1 Failed for input ${JSON.stringify(b)}`);
    }
  }
  console.log("PASSED: Invalid isActive values rejected with 400.");

  // Test 2: PATCH isActive: false
  console.log("\n--- TEST 2: PATCH { isActive: false } on Product 207 ---");
  {
    const req = createRequest({ isActive: false });
    const res = await PATCH(req, { params: Promise.resolve({ id: "207" }) });
    const json = await res.json();
    console.log(`Status: ${res.status}, Product 207 isActive: ${json.isActive}`);
    if (res.status !== 200 || json.isActive !== false) {
      throw new Error(`Test 2 Failed! Status: ${res.status}, Response: ${JSON.stringify(json)}`);
    }

    // Verify DB directly
    const pInDb = await Product.findById(207).lean();
    if (pInDb?.isActive !== false) throw new Error("DB did not reflect isActive: false");

    // Verify other fields remain unchanged
    if (pInDb.name !== initialProduct?.name) throw new Error("Product name changed unexpectedly!");
    if (pInDb.code !== initialProduct?.code) throw new Error("Product code changed unexpectedly!");
    if (pInDb.moduleSize !== initialProduct?.moduleSize) throw new Error("Module size changed unexpectedly!");
    if (pInDb.categoryId !== initialProduct?.categoryId) throw new Error("Category ID changed unexpectedly!");

    // Verify variants remain unchanged
    const varsInDb = await ProductVariant.find({ productId: 207 }).lean();
    if (varsInDb.length !== initialVariants.length) throw new Error("Variant count changed!");
    console.log("PASSED: Product 207 isActive updated to false without altering any other fields or variants.");
  }

  // Test 3: PATCH isActive: true
  console.log("\n--- TEST 3: PATCH { isActive: true } on Product 207 ---");
  {
    const req = createRequest({ isActive: true });
    const res = await PATCH(req, { params: Promise.resolve({ id: "207" }) });
    const json = await res.json();
    console.log(`Status: ${res.status}, Product 207 isActive: ${json.isActive}`);
    if (res.status !== 200 || json.isActive !== true) {
      throw new Error(`Test 3 Failed! Status: ${res.status}, Response: ${JSON.stringify(json)}`);
    }

    const pInDb = await Product.findById(207).lean();
    if (pInDb?.isActive !== true) throw new Error("DB did not reflect isActive: true");

    const varsInDb = await ProductVariant.find({ productId: 207 }).lean();
    if (varsInDb.length !== initialVariants.length) throw new Error("Variant count changed!");
    console.log("PASSED: Product 207 isActive updated to true without altering any other fields or variants.");
  }

  // Test 4: Full Product update with category validation
  console.log("\n--- TEST 4: Full Product update with category validation ---");
  {
    // Try updating categoryId to 1 with an invalid automationTier
    const req = createRequest({
      categoryId: 1,
      automationTier: "NonExistentTier",
      surfaceFinish: "acrylic"
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "207" }) });
    const json = await res.json();
    console.log(`Status: ${res.status}, Error: ${json.error}`);
    if (res.status !== 400 || !json.error.includes("Invalid automation tier")) {
      throw new Error(`Test 4 Failed! Expected validation error, got: ${JSON.stringify(json)}`);
    }
    console.log("PASSED: Category validation properly enforced when category/tier fields are updated.");
  }

  // Test 5: CREATE product (POST) still enforces Automation Tier where applicable
  console.log("\n--- TEST 5: CREATE (POST /api/products) validation ---");
  {
    const postReq = new Request("http://localhost:3000/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Touch Switch",
        code: "TEST-01",
        type: "switch_board",
        categoryId: 1, // Tactus requires automation tier
        variants: [{ config: {}, price: 5000 }],
        // Missing automationTier
      }),
    });
    const res = await POST(postReq);
    const json = await res.json();
    console.log(`POST Status: ${res.status}, Error: ${json.error}`);
    if (res.status !== 400 || json.error !== "Automation Tier is required for this category") {
      throw new Error(`Test 5 Failed! Expected 'Automation Tier is required for this category', got: ${JSON.stringify(json)}`);
    }
    console.log("PASSED: CREATE product still strictly enforces category requirements!");
  }

  console.log("\n==================================================");
  console.log("ALL 5 REGRESSION TESTS PASSED SUCCESSFULLY 100%!");
  console.log("==================================================");

  await mongoose.disconnect();
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
