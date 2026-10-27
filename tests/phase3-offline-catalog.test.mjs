/**
 * Phase 3 Offline Catalog Engine Automated Verification
 * Tests:
 * 1. Unauthenticated request -> 401 Unauthorized
 * 2. Super Admin without Act-as -> 403 Forbidden (Company context required)
 * 3. Company 1 user -> receives only Company 1 data (tenant isolation)
 * 4. Company 2 user -> receives only Company 2 data (tenant isolation)
 * 5. Sensitive fields (cost, purchaseTaxPercent, margin) strictly excluded
 * 6. Soft-deleted and inactive products excluded
 * 7. Bathroom room templates excluded
 * 8. Cache-Control: no-store, no-cache headers present
 * 9. Catalog version hash and server timestamp deterministic
 *
 * Run with: node tests/phase3-offline-catalog.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let server, exitCode = 0, n = 0;
const pass = (m) => console.log(`  ✓ ${++n}. ${m}`);

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super Admin" },
    { _id: 2, email: "dealer1@example.com", role: "dealer", name: "Dealer 1", companyId: 1 },
    { _id: 3, email: "dealer2@example.com", role: "dealer", name: "Dealer 2", companyId: 2 },
  ];

  console.log("Starting isolated test server for Phase 3 Offline Catalog...");
  server = await startIsolatedServer("phase3-catalog", USERS, { production: false });
  const { db, login, api, baseUrl } = server;
  const now = new Date();

  // Seed Companies
  await db.collection("companies").insertMany([
    { _id: 1, name: "Company One", slug: "company-1", status: "active", phone: "1111111111", address: "St 1", createdAt: now, updatedAt: now },
    { _id: 2, name: "Company Two", slug: "company-2", status: "active", phone: "2222222222", address: "St 2", createdAt: now, updatedAt: now },
  ]);

  const base = { isActive: true, isDeleted: false, createdAt: now, updatedAt: now };

  // Seed Categories
  await db.collection("categories").insertMany([
    { _id: 10, companyId: 1, name: "Switches C1", level: 1, sortOrder: 1, ...base },
    { _id: 20, companyId: 2, name: "Lighting C2", level: 1, sortOrder: 1, ...base },
  ]);

  // Seed House Types
  await db.collection("housetypes").insertMany([
    { _id: 10, companyId: 1, name: "3BHK Villa C1", sortOrder: 1, ...base },
    { _id: 20, companyId: 2, name: "2BHK Flat C2", sortOrder: 1, ...base },
  ]);

  // Seed Room Types
  await db.collection("roomtypes").insertMany([
    { _id: 100, companyId: 1, name: "Master Bedroom C1", icon: "bed", sortOrder: 1, ...base },
    { _id: 101, companyId: 1, name: "Attached Bathroom C1", icon: "bath", sortOrder: 2, ...base },
    { _id: 200, companyId: 2, name: "Living Room C2", icon: "tv", sortOrder: 1, ...base },
  ]);

  // Seed House Type Room Templates
  await db.collection("housetyperoomtemplates").insertMany([
    { _id: 1, companyId: 1, houseTypeId: 10, roomTypeId: 100, quantity: 1, sortOrder: 1, ...base },
    { _id: 2, companyId: 1, houseTypeId: 10, roomTypeId: 101, quantity: 1, sortOrder: 2, ...base }, // bath
    { _id: 3, companyId: 2, houseTypeId: 20, roomTypeId: 200, quantity: 1, sortOrder: 1, ...base },
  ]);

  // Seed Products
  await db.collection("products").insertMany([
    {
      _id: 1000,
      companyId: 1,
      name: "4-Touch Smart Switch C1",
      description: "Touch switch with automation",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample_switch.jpg",
      categoryId: 10,
      automationTier: "Luxury",
      surfaceFinish: "Glass White",
      ...base,
    },
    {
      _id: 1001,
      companyId: 1,
      name: "Inactive Product C1",
      categoryId: 10,
      isActive: false, // INACTIVE: MUST BE EXCLUDED
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 2000,
      companyId: 2,
      name: "Smart Dimmer C2",
      description: "Dimmer lighting module",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample_dimmer.jpg",
      categoryId: 20,
      ...base,
    },
  ]);

  // Seed Product Variants
  await db.collection("productvariants").insertMany([
    {
      _id: 10001,
      productId: 1000,
      companyId: 1,
      code: "SW-C1-WHT",
      name: "White / Glass",
      automationTier: "Luxury",
      surfaceFinish: "Glass White",
      price: new Decimal128("5500.00"),
      cost: new Decimal128("2800.00"), // SENSITIVE: MUST BE STRIPPED
      purchaseTaxPercent: new Decimal128("18.00"), // SENSITIVE: MUST BE STRIPPED
      config: { series: "Luxury", finish: "Glass White" },
      sortOrder: 1,
      ...base,
    },
    {
      _id: 10002,
      productId: 1000,
      companyId: 1,
      code: "SW-C1-BLK-DELETED",
      name: "Black / Glass (Deleted)",
      price: new Decimal128("5500.00"),
      cost: new Decimal128("2800.00"),
      isActive: true,
      isDeleted: true, // DELETED: MUST BE EXCLUDED
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 20001,
      productId: 2000,
      companyId: 2,
      code: "DIM-C2-SLV",
      name: "Silver",
      price: new Decimal128("7200.00"),
      cost: new Decimal128("3900.00"), // SENSITIVE
      purchaseTaxPercent: new Decimal128("18.00"),
      sortOrder: 1,
      ...base,
    },
  ]);

  // Logins
  const cookies = {
    super: await login("super@example.com", "admin"),
    dealer1: await login("dealer1@example.com", "user"),
    dealer2: await login("dealer2@example.com", "user"),
  };

  const OFFLINE_API = "/api/catalog/offline-package";

  // Test 1: Unauthenticated request rejected
  const unauthRes = await fetch(`${baseUrl}${OFFLINE_API}`);
  assert.equal(unauthRes.status, 401, "Unauthenticated request must return 401");
  pass("Unauthenticated request is rejected with 401 Unauthorized");

  // Test 2: Super Admin without Act-as rejected
  const superRes = await fetch(`${baseUrl}${OFFLINE_API}`, {
    headers: { Cookie: cookies.super },
  });
  assert.equal(superRes.status, 403, "Super Admin without Act-as must be rejected with 403");
  const superData = await superRes.json();
  console.log("superData is:", JSON.stringify(superData));
  assert.ok(superRes.status === 403, "Super Admin receives 403");
  pass("Super Admin without Act-as is rejected with 403 Forbidden");

  // Test 3: Company 1 Dealer downloads package
  const d1Res = await fetch(`${baseUrl}${OFFLINE_API}`, {
    headers: { Cookie: cookies.dealer1 },
  });
  assert.equal(d1Res.status, 200, "Company 1 download must succeed");
  
  // Cache headers check
  const cacheControl = d1Res.headers.get("cache-control") || "";
  assert.ok(cacheControl.includes("no-store") && cacheControl.includes("no-cache"), `Cache-Control must prevent shared caching: ${cacheControl}`);
  pass("Response includes strict no-store / no-cache headers preventing proxy/shared caching");

  const d1Data = await d1Res.json();
  assert.equal(d1Data.success, true, "Company 1 response success is true");
  assert.equal(d1Data.tenant.companyId, 1, "Company 1 companyId matches");
  assert.ok(d1Data.catalogVersion && typeof d1Data.catalogVersion === "string", "Catalog version hash exists");
  assert.ok(d1Data.generatedAt && typeof d1Data.generatedAt === "string", "Server timestamp exists");

  // Validate Products & Isolation
  assert.equal(d1Data.products.length, 1, "Company 1 sees exactly 1 active product");
  assert.equal(d1Data.products[0].id, 1000, "Product 1000 returned");
  assert.equal(d1Data.products[0].name, "4-Touch Smart Switch C1");

  // Validate Variants & Sanitization
  assert.equal(d1Data.products[0].variants.length, 1, "Deleted variant excluded");
  const d1Variant = d1Data.products[0].variants[0];
  assert.equal(d1Variant.code, "SW-C1-WHT");
  assert.equal(Number(d1Variant.price), 5500);
  assert.equal(d1Variant.cost, undefined, "SENSITIVE FIELD 'cost' must be stripped");
  assert.equal(d1Variant.purchaseTaxPercent, undefined, "SENSITIVE FIELD 'purchaseTaxPercent' must be stripped");
  assert.equal(d1Variant.margin, undefined, "SENSITIVE FIELD 'margin' must be stripped");
  assert.equal(d1Variant.dealerMargin, undefined, "SENSITIVE FIELD 'dealerMargin' must be stripped");
  pass("Company 1 catalog downloaded: deleted/inactive products excluded and sensitive cost/margin fields strictly removed");

  // Validate Categories, House Types, Room Types
  assert.equal(d1Data.categories.length, 1, "Company 1 sees only Company 1 category");
  assert.equal(d1Data.categories[0].id, 10);
  assert.equal(d1Data.houseTypes.length, 1, "Company 1 sees only Company 1 house type");
  assert.equal(d1Data.houseTypes[0].id, 10);
  assert.equal(d1Data.roomTypes.length, 2, "Company 1 sees only Company 1 room types");
  // Check bathroom-like template exclusion inside houseType
  const c1Templates = d1Data.houseTypes[0].roomTemplate || [];
  assert.equal(c1Templates.length, 1, "Bathroom room template is filtered out from houseType");
  assert.equal(c1Templates[0].roomTypeId, 100, "Only master bedroom template retained");
  pass("Company 1 entities (categories, house types, room types, non-bathroom templates) returned accurately");

  // Test 4: Company 2 Dealer downloads package -> Strict Multi-Tenant Isolation
  const d2Res = await fetch(`${baseUrl}${OFFLINE_API}`, {
    headers: { Cookie: cookies.dealer2 },
  });
  assert.equal(d2Res.status, 200, "Company 2 download must succeed");
  const d2Data = await d2Res.json();
  assert.equal(d2Data.tenant.companyId, 2, "Company 2 companyId matches");
  assert.equal(d2Data.products.length, 1, "Company 2 sees exactly 1 active product");
  assert.equal(d2Data.products[0].id, 2000, "Company 2 sees Product 2000");
  assert.equal(d2Data.products[0].name, "Smart Dimmer C2");
  assert.equal(d2Data.categories[0].id, 20, "Company 2 sees Category 20");
  assert.equal(d2Data.houseTypes[0].id, 20, "Company 2 sees House Type 20");
  assert.equal(d2Data.roomTypes[0].id, 200, "Company 2 sees Room Type 200");

  // Ensure no cross-contamination between C1 and C2
  const c1ProductIdsInC2 = d2Data.products.filter((p) => p.id === 1000 || p.id === 1001);
  assert.equal(c1ProductIdsInC2.length, 0, "No Company 1 products leaked into Company 2");
  const c2ProductIdsInC1 = d1Data.products.filter((p) => p.id === 2000);
  assert.equal(c2ProductIdsInC1.length, 0, "No Company 2 products leaked into Company 1");
  pass("Strict tenant isolation verified: Company 1 and Company 2 cannot see each other's catalog records");

  // Test 5: Deterministic versioning on unchanged data
  const d1ResAgain = await fetch(`${baseUrl}${OFFLINE_API}`, {
    headers: { Cookie: cookies.dealer1 },
  });
  const d1DataAgain = await d1ResAgain.json();
  assert.equal(d1DataAgain.catalogVersion, d1Data.catalogVersion, "Catalog version hash is identical for unchanged data");
  pass("Deterministic catalog versioning verified: unchanged catalog yields identical hash");

  // Test 6: Cache Invalidation — Change one variant price without changing document counts
  await db.collection("productvariants").updateOne(
    { _id: 10001 },
    { $set: { price: new Decimal128("5999.00") } }
  );
  const vPriceRes = await fetch(`${baseUrl}${OFFLINE_API}?checkVersionOnly=true`, {
    headers: { Cookie: cookies.dealer1 },
  });
  const vPriceData = await vPriceRes.json();
  assert.notEqual(
    vPriceData.catalogVersion,
    d1Data.catalogVersion,
    "catalogVersion must change when variant price changes (counts unchanged)"
  );
  pass("Cache Invalidation verified: Changing variant price modifies catalogVersion without changing document counts");

  // Test 7: Cache Invalidation — Change one product image URL
  await db.collection("products").updateOne(
    { _id: 1000 },
    { $set: { imageUrl: "https://res.cloudinary.com/demo/image/upload/sample_switch_updated_v2.jpg" } }
  );
  const imgRes = await fetch(`${baseUrl}${OFFLINE_API}?checkVersionOnly=true`, {
    headers: { Cookie: cookies.dealer1 },
  });
  const imgData = await imgRes.json();
  assert.notEqual(
    imgData.catalogVersion,
    vPriceData.catalogVersion,
    "catalogVersion must change when product image URL changes"
  );
  pass("Cache Invalidation verified: Changing product image URL modifies catalogVersion");

  // Test 8: Cache Invalidation — Soft-delete one variant
  await db.collection("productvariants").updateOne(
    { _id: 10001 },
    { $set: { isDeleted: true } }
  );
  const delRes = await fetch(`${baseUrl}${OFFLINE_API}?checkVersionOnly=true`, {
    headers: { Cookie: cookies.dealer1 },
  });
  const delData = await delRes.json();
  assert.notEqual(
    delData.catalogVersion,
    imgData.catalogVersion,
    "catalogVersion must change when variant is soft-deleted"
  );
  pass("Cache Invalidation verified: Soft-deleting a variant modifies catalogVersion");

  // Restore variant for user entitlement test
  await db.collection("productvariants").updateOne(
    { _id: 10001 },
    { $set: { isDeleted: false } }
  );

  // Test 9: Cache Invalidation — Change dealer-specific visible pricing / discount entitlement
  await db.collection("adminusers").updateOne(
    { _id: 2 },
    { $set: { discountAllocationPercent: 25 } }
  );
  const discRes = await fetch(`${baseUrl}${OFFLINE_API}?checkVersionOnly=true`, {
    headers: { Cookie: cookies.dealer1 },
  });
  const discData = await discRes.json();
  assert.notEqual(
    discData.catalogVersion,
    imgData.catalogVersion,
    "catalogVersion must change when dealer discount allocation changes"
  );
  pass("Cache Invalidation verified: Changing dealer discount entitlement modifies user's catalogVersion");

  // Test 10: checkVersionOnly endpoint performance and schema
  assert.equal(discData.success, true);
  assert.equal(discData.products, undefined, "checkVersionOnly=true does not transfer product array");
  assert.ok(discData.catalogVersion && discData.counts, "checkVersionOnly=true returns version and counts");
  pass("Fast version-check endpoint verified: returns version and counts without heavy payload");

  console.log(`\nAll ${n} Phase 3 Offline Catalog tests passed successfully!`);

} catch (err) {
  console.error("Test failed:", err);
  exitCode = 1;
} finally {
  if (server) {
    console.log("Shutting down isolated test server...");
    await server.cleanup();
  }
  process.exit(exitCode);
}
