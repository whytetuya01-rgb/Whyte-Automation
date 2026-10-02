const { encode } = require("next-auth/jwt");

const secret = "whyte-quotation-secret-key-change-in-production-12345";

async function runLiveTests() {
  console.log("=== RUNNING LIVE HTTP TESTS ON http://localhost:3000 ===");

  // 1. Generate NextAuth JWT session token
  const token = await encode({
    token: {
      name: "Super Admin",
      email: "admin@whyte.com",
      role: "super_admin",
      id: "1",
      sub: "1",
    },
    secret,
  });

  const headers = {
    "Content-Type": "application/json",
    Cookie: `next-auth.session-token=${token}`,
  };

  // Helper fetch function
  async function patchProduct(id, body) {
    const res = await fetch(`http://localhost:3000/api/products/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  async function postProduct(body) {
    const res = await fetch(`http://localhost:3000/api/products`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  // Baseline GET /api/products/207
  const baselineRes = await fetch("http://localhost:3000/api/products/207", { headers });
  const baseline = await baselineRes.json();
  console.log(`[BASELINE] Product 207 name: "${baseline.name}", isActive: ${baseline.isActive}, variants: ${baseline.variants?.length}`);

  // Test 1: Invalid isActive values are rejected
  console.log("\n--- TEST 1: Invalid isActive values rejected ---");
  const invalidInputs = ["false", 1, null, "true", {}];
  for (const inv of invalidInputs) {
    const { status, data } = await patchProduct(207, { isActive: inv });
    console.log(`Input ${JSON.stringify(inv)} -> Status: ${status}, Response:`, data);
    if (status !== 400 || data.error !== "isActive must be a boolean") {
      throw new Error(`Test 1 Failed for input ${JSON.stringify(inv)}`);
    }
  }
  console.log("PASSED: Invalid isActive values rejected with 400.");

  // Test 2: PATCH { isActive: false } on Product 207
  console.log("\n--- TEST 2: PATCH /api/products/207 { isActive: false } ---");
  {
    const { status, data } = await patchProduct(207, { isActive: false });
    console.log(`Status: ${status}, isActive: ${data.isActive}`);
    if (status !== 200 || data.isActive !== false) {
      throw new Error(`Test 2 Failed! Status: ${status}, Response: ${JSON.stringify(data)}`);
    }

    // Check that other fields are unchanged
    if (data.name !== baseline.name) throw new Error("Name changed!");
    if (data.code !== baseline.code) throw new Error("Code changed!");
    if (data.moduleSize !== baseline.moduleSize) throw new Error("Module size changed!");
    if (data.variants?.length !== baseline.variants?.length) throw new Error("Variant count changed!");
    console.log("PASSED: Product 207 isActive set to false with all other fields and variants untouched.");
  }

  // Test 3: PATCH { isActive: true } on Product 207
  console.log("\n--- TEST 3: PATCH /api/products/207 { isActive: true } ---");
  {
    const { status, data } = await patchProduct(207, { isActive: true });
    console.log(`Status: ${status}, isActive: ${data.isActive}`);
    if (status !== 200 || data.isActive !== true) {
      throw new Error(`Test 3 Failed! Status: ${status}, Response: ${JSON.stringify(data)}`);
    }

    if (data.name !== baseline.name) throw new Error("Name changed!");
    if (data.code !== baseline.code) throw new Error("Code changed!");
    if (data.variants?.length !== baseline.variants?.length) throw new Error("Variant count changed!");
    console.log("PASSED: Product 207 isActive set to true with all other fields and variants untouched.");
  }

  // Test 4: Full Product update with category validation
  console.log("\n--- TEST 4: Full Product update category-specific validation ---");
  {
    const { status, data } = await patchProduct(207, {
      categoryId: 1,
      automationTier: "InvalidTierName",
      surfaceFinish: "acrylic",
    });
    console.log(`Status: ${status}, Response:`, data);
    if (status !== 400 || !data.error?.includes("Invalid automation tier")) {
      throw new Error(`Test 4 Failed! Expected 400 with invalid tier, got: ${JSON.stringify(data)}`);
    }
    console.log("PASSED: Category validation properly enforced for category updates.");
  }

  // Test 5: CREATE (POST /api/products) still enforces Automation Tier where applicable
  console.log("\n--- TEST 5: CREATE (POST /api/products) validation ---");
  {
    const { status, data } = await postProduct({
      name: "Test Switch",
      type: "switch_board",
      categoryId: 1, // Tactus requires automation tier
      variants: [{ config: {}, price: 5000 }],
      // missing automationTier
    });
    console.log(`Status: ${status}, Response:`, data);
    if (status !== 400 || data.error !== "Automation Tier is required for this category") {
      throw new Error(`Test 5 Failed! Expected 'Automation Tier is required for this category', got: ${JSON.stringify(data)}`);
    }
    console.log("PASSED: CREATE product still strictly enforces category requirements!");
  }

  // Test 6: Verify unauthenticated request is still rejected
  console.log("\n--- TEST 6: Unauthenticated request rejected ---");
  {
    const res = await fetch("http://localhost:3000/api/products/207", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    const data = await res.json();
    console.log(`Status: ${res.status}, Response:`, data);
    if (res.status !== 401 || data.error !== "Unauthorized") {
      throw new Error("Test 6 Failed: Unauthenticated request was not rejected with 401!");
    }
    console.log("PASSED: Authentication is strictly enforced.");
  }

  console.log("\n==================================================");
  console.log("ALL 6 LIVE HTTP TESTS PASSED 100%!");
  console.log("==================================================");
}

runLiveTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
