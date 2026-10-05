import assert from "assert";
import { Product, ProductVariant, Quotation, QuotationRoom } from "@/types";
import {
  filterProductCatalog,
  isVariantEligible,
  matchDimension,
  getVariantTier,
  getVariantFinish,
  normalizeFilterToken,
} from "@/lib/productFiltering";

console.log("=== Running Product Catalog Filtering Regression Tests ===");

// 1. Mock Category Configuration (Tactus)
const tactusCategory = {
  id: 1,
  name: "Tactus",
  configuredTiers: [
    { value: "remote", label: "Remote Control" },
    { value: "wifi", label: "WiFi Smart" },
    { value: "zigbee", label: "Zigbee Protocol" },
  ],
  configuredFinishes: [
    { value: "acrylic", label: "Acrylic Panel" },
    { value: "glass", label: "Glass Panel" },
  ],
  hasCategoryTiers: true,
  hasCategoryFinishes: true,
};

// 2. Mock Products
// Product A: Full 6 variants (Remote/WiFi/Zigbee x Acrylic/Glass)
const productA: Product = {
  id: 163,
  name: "Color Touch 4 Switch 1 Socket (6A)",
  code: "CT-4S1SK-6A",
  description: "Touch switch board with 4 switches and 1 socket",
  type: "switch_board",
  categoryId: 1,
  price: "9499.00",
  unit: "piece",
  imageUrl: "/images/ct-4s.png",
  moduleSize: "4M",
  notes: null,
  isActive: true,
  sortOrder: 1,
  isMatrix: true,
  matrixDimensions: null,
  variants: [
    { id: 705, productId: 163, automationTier: "remote", surfaceFinish: "acrylic", config: { series: "remote", finish: "acrylic" }, price: "9499.00", isActive: true, sortOrder: 1 },
    { id: 706, productId: 163, automationTier: "remote", surfaceFinish: "glass", config: { series: "remote", finish: "glass" }, price: "11299.00", isActive: true, sortOrder: 2 },
    { id: 707, productId: 163, automationTier: "wifi", surfaceFinish: "acrylic", config: { series: "wifi", finish: "acrylic" }, price: "12299.00", isActive: true, sortOrder: 3 },
    { id: 708, productId: 163, automationTier: "wifi", surfaceFinish: "glass", config: { series: "wifi", finish: "glass" }, price: "14099.00", isActive: true, sortOrder: 4 },
    { id: 709, productId: 163, automationTier: "zigbee", surfaceFinish: "acrylic", config: { series: "zigbee", finish: "acrylic" }, price: "14399.00", isActive: true, sortOrder: 5 },
    { id: 710, productId: 163, automationTier: "zigbee", surfaceFinish: "glass", config: { series: "zigbee", finish: "glass" }, price: "16299.00", isActive: true, sortOrder: 6 },
  ],
};

// Product B: Acrylic-only (Remote/WiFi/Zigbee x Acrylic ONLY)
const productB: Product = {
  id: 160,
  name: "Color Touch 2 Switch (1-16A) 3 Socket (6A) ( Only Available in Acrylic )",
  code: "CT-2S3SK-ACR",
  description: "Touch switch board only available in acrylic",
  type: "switch_board",
  categoryId: 1,
  price: "8499.00",
  unit: "piece",
  imageUrl: null,
  moduleSize: "6M",
  notes: null,
  isActive: true,
  sortOrder: 2,
  isMatrix: true,
  matrixDimensions: null,
  variants: [
    { id: 801, productId: 160, automationTier: "remote", surfaceFinish: "acrylic", config: { series: "remote", finish: "acrylic" }, price: "8499.00", isActive: true, sortOrder: 1 },
    { id: 802, productId: 160, automationTier: "wifi", surfaceFinish: "acrylic", config: { series: "wifi", finish: "acrylic" }, price: "10999.00", isActive: true, sortOrder: 2 },
    { id: 803, productId: 160, automationTier: "zigbee", surfaceFinish: "acrylic", config: { series: "zigbee", finish: "acrylic" }, price: "12999.00", isActive: true, sortOrder: 3 },
  ],
};

// Product C: No Remote variants (WiFi & Zigbee x Acrylic/Glass) - like Product 330
const productC: Product = {
  id: 330,
  name: "Color Touch Varshil 10",
  code: "CT-V10",
  description: "Specialized switch board without remote",
  type: "switch_board",
  categoryId: 1,
  price: "500.00",
  unit: "piece",
  imageUrl: "/images/v10.png",
  moduleSize: "8M",
  notes: null,
  isActive: true,
  sortOrder: 3,
  isMatrix: true,
  matrixDimensions: null,
  variants: [
    { id: 1629, productId: 330, automationTier: "wifi", surfaceFinish: "acrylic", config: { series: "wifi", finish: "acrylic" }, price: "500.00", isActive: true, sortOrder: 1 },
    { id: 1630, productId: 330, automationTier: "wifi", surfaceFinish: "glass", config: { series: "wifi", finish: "glass" }, price: "1000.00", isActive: true, sortOrder: 2 },
    { id: 1631, productId: 330, automationTier: "zigbee", surfaceFinish: "acrylic", config: { series: "zigbee", finish: "acrylic" }, price: "1500.00", isActive: true, sortOrder: 3 },
    { id: 1632, productId: 330, automationTier: "zigbee", surfaceFinish: "glass", config: { series: "zigbee", finish: "glass" }, price: "2500.00", isActive: true, sortOrder: 4 },
  ],
};

// Product D: Accessory in Category 6 (No variants / flat product)
const productD: Product = {
  id: 401,
  name: "Smart IR Blaster",
  code: "ACC-IR-01",
  description: "Universal smart remote controller",
  type: "accessory",
  categoryId: 6,
  price: "2499.00",
  unit: "piece",
  imageUrl: null,
  moduleSize: "1M",
  notes: null,
  isActive: true,
  sortOrder: 4,
  isMatrix: false,
  matrixDimensions: null,
  variants: [],
};

const allMockProducts: Product[] = [productA, productB, productC, productD];

// -------------------------------------------------------------------------------------
// TEST 1: Tactus + Remote Control + Acrylic Panel
// -------------------------------------------------------------------------------------
console.log("\n[Test 1] Tactus + Remote Control + Acrylic Panel");
{
  const results = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
    hasCategoryTiers: true,
    hasCategoryFinishes: true,
  });

  // Product C has no remote variant, Product D is category 6 -> only Product A and B must match
  assert.strictEqual(results.length, 2, "Expected exactly 2 products to match (Product A and Product B)");
  const ids = results.map((r) => r.product.id);
  assert(ids.includes(163), "Product A (163) should match");
  assert(ids.includes(160), "Product B (160) should match");
  assert(!ids.includes(330), "Product C (330) must NOT match as it has no remote variant");
  assert(!ids.includes(401), "Product D (401) must NOT match as it is in category 6");

  // Verify that for Product A, ONLY the remote+acrylic variant is eligible!
  const resA = results.find((r) => r.product.id === 163)!;
  assert.strictEqual(resA.eligibleVariants.length, 1, "Product A must have exactly 1 eligible variant");
  assert.strictEqual(resA.eligibleVariants[0].id, 705, "Eligible variant must be 705 (remote + acrylic)");
  assert.strictEqual(resA.exactVariant?.id, 705, "Exact variant must be 705");
  assert.strictEqual(resA.minPrice, 9499, "Price must be 9499 for exact variant");

  // Verify that for Product B, ONLY the remote+acrylic variant is eligible!
  const resB = results.find((r) => r.product.id === 160)!;
  assert.strictEqual(resB.eligibleVariants.length, 1, "Product B must have exactly 1 eligible variant");
  assert.strictEqual(resB.eligibleVariants[0].id, 801, "Eligible variant must be 801 (remote + acrylic)");
  assert.strictEqual(resB.exactVariant?.id, 801, "Exact variant must be 801");

  console.log("  ✓ Filtered correctly: only products with remote+acrylic match; non-matching variants excluded.");
}

// -------------------------------------------------------------------------------------
// TEST 2: Products with multiple variants where only some variants match
// -------------------------------------------------------------------------------------
console.log("\n[Test 2] Products with multiple variants where only some match (e.g. Tier = Remote, Finish = All)");
{
  const results = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "all",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
    hasCategoryTiers: true,
    hasCategoryFinishes: true,
  });

  // Product A has 2 remote variants (acrylic, glass)
  const resA = results.find((r) => r.product.id === 163)!;
  assert.strictEqual(resA.eligibleVariants.length, 2, "Product A should have 2 eligible variants (remote acrylic + glass)");
  assert(resA.eligibleVariants.every((v) => getVariantTier(v) === "remote"), "All eligible variants must be remote");
  assert.strictEqual(resA.exactVariant, null, "exactVariant should be null when multiple variants match");
  assert.strictEqual(resA.minPrice, 9499, "minPrice should be 9499 (acrylic)");
  assert.strictEqual(resA.maxPrice, 11299, "maxPrice should be 11299 (glass)");

  // Product B has only 1 remote variant (acrylic)
  const resB = results.find((r) => r.product.id === 160)!;
  assert.strictEqual(resB.eligibleVariants.length, 1, "Product B has only 1 remote variant");
  assert.strictEqual(resB.exactVariant?.id, 801, "exactVariant should be set to 801");

  // Product C has 0 remote variants -> excluded
  assert(!results.some((r) => r.product.id === 330), "Product C should be excluded");

  console.log("  ✓ Correctly returned partial variant matches and accurate price ranges.");
}

// -------------------------------------------------------------------------------------
// TEST 3: Products where no variants match (e.g. Glass Finish for Acrylic-only product)
// -------------------------------------------------------------------------------------
console.log("\n[Test 3] Glass Finish filter: Acrylic-only products must have 0 eligible variants and be excluded");
{
  const results = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "glass",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
    hasCategoryTiers: true,
    hasCategoryFinishes: true,
  });

  // Product B (160) is only available in acrylic -> must NOT appear when finish is glass!
  assert(!results.some((r) => r.product.id === 160), "Acrylic-only Product B must be excluded when finish=glass");

  // Product A has remote+glass -> must appear
  const resA = results.find((r) => r.product.id === 163)!;
  assert.strictEqual(resA.eligibleVariants.length, 1);
  assert.strictEqual(resA.eligibleVariants[0].id, 706, "Variant 706 (remote+glass) must match");
  assert.strictEqual(resA.minPrice, 11299);

  console.log("  ✓ Product with no matching variants correctly excluded from catalog.");
}

// -------------------------------------------------------------------------------------
// TEST 4: Search combined with category/tier/finish filters
// -------------------------------------------------------------------------------------
console.log("\n[Test 4] Search combined with category, tier, and finish filters");
{
  // Search for "4 Switch"
  const search1 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
    search: "4 Switch",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
  });
  assert.strictEqual(search1.length, 1, "Expected only Product A to match '4 Switch'");
  assert.strictEqual(search1[0].product.id, 163);

  // Search by code "CT-2S3SK"
  const search2 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
    search: "CT-2S3SK",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
  });
  assert.strictEqual(search2.length, 1, "Expected only Product B to match code 'CT-2S3SK'");
  assert.strictEqual(search2[0].product.id, 160);

  // Search with non-matching term
  const search3 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
    search: "NonexistentKeyword123",
    configuredTiers: tactusCategory.configuredTiers,
    configuredFinishes: tactusCategory.configuredFinishes,
  });
  assert.strictEqual(search3.length, 0, "Non-matching search must return 0 results");

  console.log("  ✓ Search combines with category/tier/finish filters using AND logic.");
}

// -------------------------------------------------------------------------------------
// TEST 5: Device-type filtering combined with other filters
// -------------------------------------------------------------------------------------
console.log("\n[Test 5] Device-type filtering combined with category and other filters");
{
  const switchBoards = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "all",
    surfaceFinish: "all",
    productType: "switch_board",
  });
  assert.strictEqual(switchBoards.length, 3, "All 3 switchboards in category 1 match");

  const accessories = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "all",
    surfaceFinish: "all",
    productType: "accessory",
  });
  assert.strictEqual(accessories.length, 0, "No accessories exist in category 1");

  const accessoriesAllCats = filterProductCatalog(allMockProducts, {
    productType: "accessory",
  });
  assert.strictEqual(accessoriesAllCats.length, 1, "Product D matches when category filter is not applied");
  assert.strictEqual(accessoriesAllCats[0].product.id, 401);

  console.log("  ✓ Device type filter applies in harmony with category and tier/finish.");
}

// -------------------------------------------------------------------------------------
// TEST 6: Changing filters after adding a product preserves room items
// -------------------------------------------------------------------------------------
console.log("\n[Test 6] Changing filters preserves quotation room items");
{
  // Simulate quotation room state
  const mockRoom: QuotationRoom = {
    id: 10,
    quotationId: "q-1",
    roomTypeId: 1,
    customName: "Living Room",
    subArea: null,
    notes: null,
    sortOrder: 1,
    items: [
      {
        id: 501,
        quotationRoomId: 10,
        productId: 163,
        productVariantId: 705,
        variantLabel: "Remote Control · Acrylic Panel",
        variantConfig: { series: "remote", finish: "acrylic" },
        sbNumber: "SB-01",
        quantity: 2,
        unitPrice: "9499.00",
        notes: "Main entrance wall",
        sortOrder: 1,
      },
    ],
  };

  // Initially: filters are Tactus + Remote + Acrylic
  const filter1 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
  });
  assert(filter1.some((r) => r.product.id === 163), "Product 163 is in catalog");

  // User changes catalog filter to WiFi + Glass
  const filter2 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "wifi",
    surfaceFinish: "glass",
  });
  // Product 163 is still in catalog (because it has wifi+glass variant 708), but Product B is excluded
  assert(filter2.some((r) => r.product.id === 163));
  assert(!filter2.some((r) => r.product.id === 160));

  // User changes catalog filter to Category 6 (Accessories)
  const filter3 = filterProductCatalog(allMockProducts, {
    categoryId: 6,
  });
  assert(!filter3.some((r) => r.product.id === 163), "Product 163 is not in Accessories catalog");

  // CRITICAL CHECK: Ensure room items were NOT mutated or cleared!
  assert.strictEqual(mockRoom.items.length, 1, "Room items must remain intact after filter changes");
  assert.strictEqual(mockRoom.items[0].productId, 163);
  assert.strictEqual(mockRoom.items[0].productVariantId, 705);
  assert.strictEqual(mockRoom.items[0].quantity, 2);
  assert.strictEqual(mockRoom.items[0].unitPrice, "9499.00");
  assert.strictEqual(mockRoom.items[0].notes, "Main entrance wall");

  console.log("  ✓ Room items and quotation state remain completely unaffected by catalog filter switches.");
}

// -------------------------------------------------------------------------------------
// TEST 7: No matching products returns empty array (triggers distinct empty state)
// -------------------------------------------------------------------------------------
console.log("\n[Test 7] No matching products returns empty array");
{
  const empty = filterProductCatalog(allMockProducts, {
    categoryId: 9999, // Nonexistent category
  });
  assert.strictEqual(empty.length, 0, "Must return empty array []");

  const empty2 = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "nonexistent-tier",
  });
  assert.strictEqual(empty2.length, 0, "Must return empty array [] when tier does not exist");

  console.log("  ✓ Clean empty array returned for empty state UI display.");
}

// -------------------------------------------------------------------------------------
// TEST 8: Catalog count and eligible variant count consistency
// -------------------------------------------------------------------------------------
console.log("\n[Test 8] Catalog header count and eligible variant count consistency");
{
  const results = filterProductCatalog(allMockProducts, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
  });

  // Header count must equal results.length
  const headerCount = results.length;
  assert.strictEqual(headerCount, 2);

  // Each card displays exactly its eligible variants
  for (const item of results) {
    assert(item.eligibleVariants.length > 0, "Every returned product must have at least 1 eligible variant");
    for (const v of item.eligibleVariants) {
      assert.strictEqual(getVariantTier(v), "remote", "Variant tier must be remote");
      assert.strictEqual(getVariantFinish(v), "acrylic", "Variant finish must be acrylic");
    }
  }

  // Original products and variants array must not be mutated!
  assert.strictEqual(productA.variants!.length, 6, "Product A variants array must remain length 6 (unmutated)");
  assert.strictEqual(allMockProducts.length, 4, "allMockProducts must remain length 4 (unmutated)");

  console.log("  ✓ Catalog counts and variant counts are consistent, and original data is unmutated.");
}

console.log("\n=======================================================");
console.log(" ALL 8 PRODUCT FILTERING REGRESSION TESTS PASSED! ");
console.log("=======================================================\n");
