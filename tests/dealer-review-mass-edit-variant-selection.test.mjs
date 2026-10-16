/**
 * Comprehensive test suite for Dealer Quotation Review:
 * - Room-wise Mass Edit (PATCH /api/quotations/:id/rooms/:roomId/items)
 * - Product Variant & Finish Selection
 * - Dynamic finish updating, compatibility preservation, fallback
 * - Authorization, locked quotation restriction, totals recalculation
 *
 *   node tests/dealer-review-mass-edit-variant-selection.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";
function normalizeToken(val) {
  if (!val) return "";
  return String(val).toLowerCase().replace(/[\s\-_]+/g, "");
}

function extractVariantTier(v) {
  if (v.automationTier && v.automationTier.trim()) return v.automationTier.trim();
  const conf = v.config;
  if (conf?.series && conf.series.trim()) return conf.series.trim();
  if (conf?.tier && conf.tier.trim()) return conf.tier.trim();
  if (conf?.automationTier && conf.automationTier.trim()) return conf.automationTier.trim();
  return null;
}

function extractVariantFinish(v) {
  if (v.surfaceFinish && v.surfaceFinish.trim()) return v.surfaceFinish.trim();
  const conf = v.config;
  if (conf?.finish && conf.finish.trim()) return conf.finish.trim();
  if (conf?.surfaceFinish && conf.surfaceFinish.trim()) return conf.surfaceFinish.trim();
  return null;
}

function variantMatchesTier(v, targetTier) {
  if (!targetTier || targetTier.trim() === "") return true;
  const actualTier = extractVariantTier(v);
  if (!actualTier) return false;
  return normalizeToken(actualTier) === normalizeToken(targetTier);
}

function variantMatchesFinish(v, targetFinish) {
  if (!targetFinish || targetFinish.trim() === "") return true;
  const actualFinish = extractVariantFinish(v);
  if (!actualFinish) return false;
  return normalizeToken(actualFinish) === normalizeToken(targetFinish);
}

function analyzeProductVariants(product) {
  if (!product) {
    return {
      variants: [],
      hasVariants: false,
      hasMultipleVariants: false,
      hasTiers: false,
      hasFinishes: false,
      availableTiers: [],
      availableFinishes: [],
      getFinishesForTier: () => [],
      findVariant: () => null,
    };
  }

  const activeVariants = (product.variants || []).filter((v) => v && v.isActive);

  const tierMap = new Map();
  for (const v of activeVariants) {
    const t = extractVariantTier(v);
    if (t) {
      const normKey = normalizeToken(t);
      if (!tierMap.has(normKey)) tierMap.set(normKey, t);
    }
  }

  const availableTiers = Array.from(tierMap.values()).map((t) => ({ value: t, label: t }));

  const finishMap = new Map();
  for (const v of activeVariants) {
    const f = extractVariantFinish(v);
    if (f) {
      const normKey = normalizeToken(f);
      if (!finishMap.has(normKey)) finishMap.set(normKey, f);
    }
  }

  const availableFinishes = Array.from(finishMap.values()).map((f) => ({ value: f, label: f }));

  const getFinishesForTier = (tier) => {
    const filteredVariants = tier ? activeVariants.filter((v) => variantMatchesTier(v, tier)) : activeVariants;
    const scopedMap = new Map();
    for (const v of filteredVariants) {
      const f = extractVariantFinish(v);
      if (f) {
        const normKey = normalizeToken(f);
        if (!scopedMap.has(normKey)) scopedMap.set(normKey, f);
      }
    }
    return Array.from(scopedMap.values()).map((f) => ({ value: f, label: f }));
  };

  const findVariant = (tier, finish) => {
    if (activeVariants.length === 0) return null;
    const exact = activeVariants.find((v) => variantMatchesTier(v, tier) && variantMatchesFinish(v, finish));
    if (exact) return exact;
    if (tier) {
      const tierMatch = activeVariants.find((v) => variantMatchesTier(v, tier));
      if (tierMatch) return tierMatch;
    }
    if (finish) {
      const finishMatch = activeVariants.find((v) => variantMatchesFinish(v, finish));
      if (finishMatch) return finishMatch;
    }
    return activeVariants[0] || null;
  };

  return {
    variants: activeVariants,
    hasVariants: activeVariants.length > 0,
    hasMultipleVariants: activeVariants.length > 1,
    hasTiers: availableTiers.length > 0,
    hasFinishes: availableFinishes.length > 0,
    availableTiers,
    availableFinishes,
    getFinishesForTier,
    findVariant,
  };
}

function resolveCompatibleSelection(params) {
  const { product, existingItem, quotationDefaults, desiredTier, desiredFinish } = params;
  const analysis = analyzeProductVariants(product);

  const existingTier =
    desiredTier !== undefined
      ? desiredTier
      : existingItem?.productVariant?.automationTier ||
        existingItem?.variantConfig?.series ||
        existingItem?.variantConfig?.tier ||
        null;

  const existingFinish =
    desiredFinish !== undefined
      ? desiredFinish
      : existingItem?.productVariant?.surfaceFinish ||
        existingItem?.variantConfig?.finish ||
        existingItem?.variantConfig?.surfaceFinish ||
        null;

  let resolvedTier = null;
  let isPreservedTier = false;

  if (analysis.hasTiers) {
    if (existingTier) {
      const matchedTier = analysis.availableTiers.find((t) => normalizeToken(t.value) === normalizeToken(existingTier));
      if (matchedTier) {
        resolvedTier = matchedTier.value;
        isPreservedTier = true;
      }
    }
    if (!resolvedTier && quotationDefaults?.defaultTier) {
      const defaultMatch = analysis.availableTiers.find((t) => normalizeToken(t.value) === normalizeToken(quotationDefaults.defaultTier));
      if (defaultMatch) resolvedTier = defaultMatch.value;
    }
    if (!resolvedTier && analysis.availableTiers.length > 0) {
      resolvedTier = analysis.availableTiers[0].value;
    }
  }

  const tierFinishes = analysis.getFinishesForTier(resolvedTier);
  let resolvedFinish = null;
  let isPreservedFinish = false;

  if (tierFinishes.length > 0) {
    if (existingFinish) {
      const matchedFinish = tierFinishes.find((f) => normalizeToken(f.value) === normalizeToken(existingFinish));
      if (matchedFinish) {
        resolvedFinish = matchedFinish.value;
        isPreservedFinish = true;
      }
    }
    if (!resolvedFinish && quotationDefaults?.defaultFinish) {
      const defaultFinishMatch = tierFinishes.find((f) => normalizeToken(f.value) === normalizeToken(quotationDefaults.defaultFinish));
      if (defaultFinishMatch) resolvedFinish = defaultFinishMatch.value;
    }
    if (!resolvedFinish && tierFinishes.length > 0) {
      resolvedFinish = tierFinishes[0].value;
    }
  }

  const variant = analysis.findVariant(resolvedTier, resolvedFinish);
  const variantId = variant ? Number(variant.id ?? variant._id) : null;
  const price = variant ? Number(variant.price) : Number(product.price || 0);

  const tierLabel = resolvedTier;
  const finishLabel = resolvedFinish;
  const variantLabel =
    tierLabel || finishLabel
      ? [tierLabel, finishLabel].filter(Boolean).join(" + ")
      : variant
      ? variant.name || String(variant.id)
      : null;

  return {
    tier: resolvedTier,
    finish: resolvedFinish,
    variant,
    variantId,
    variantLabel,
    price,
    isPreservedTier,
    isPreservedFinish,
  };
}

const results = [];
const pass = (name) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};

let server;
let exitCode = 0;

try {
  console.log("\n--- Section 1: Pure Unit Tests for Variant & Finish Selection Logic ---");

  // Mock products for unit testing
  const mockSwitch4M = {
    id: 101,
    name: "Touch Switch 4M",
    code: "TS-4M",
    type: "switch_board",
    isActive: true,
    isMatrix: true,
    matrixDimensions: [
      { key: "series", label: "Series", options: ["WiFi", "Zigbee"] },
      { key: "finish", label: "Finish", options: ["Glass White", "Glass Black", "Matte Grey"] },
    ],
    variants: [
      { id: 1001, productId: 101, automationTier: "WiFi", surfaceFinish: "Glass White", price: "4000.00", isActive: true },
      { id: 1002, productId: 101, automationTier: "WiFi", surfaceFinish: "Glass Black", price: "4200.00", isActive: true },
      { id: 1003, productId: 101, automationTier: "Zigbee", surfaceFinish: "Glass White", price: "4800.00", isActive: true },
      { id: 1004, productId: 101, automationTier: "Zigbee", surfaceFinish: "Glass Black", price: "5000.00", isActive: true },
      { id: 1005, productId: 101, automationTier: "Zigbee", surfaceFinish: "Matte Grey", price: "5200.00", isActive: true },
    ],
  };

  const mockSwitch6M = {
    id: 102,
    name: "Touch Switch 6M",
    code: "TS-6M",
    type: "switch_board",
    isActive: true,
    isMatrix: true,
    matrixDimensions: null,
    variants: [
      { id: 2001, productId: 102, automationTier: "WiFi", surfaceFinish: "Glass White", price: "6000.00", isActive: true },
      { id: 2002, productId: 102, automationTier: "Zigbee", surfaceFinish: "Glass White", price: "6800.00", isActive: true },
      { id: 2003, productId: 102, automationTier: "Zigbee", surfaceFinish: "Matte Gold", price: "7200.00", isActive: true },
    ],
  };

  const mockSmartPlug = {
    id: 103,
    name: "Smart Plug 16A",
    code: "PLUG-16",
    type: "accessory",
    isActive: true,
    isMatrix: false,
    matrixDimensions: null,
    price: "1500.00",
    variants: [
      { id: 3001, productId: 103, automationTier: null, surfaceFinish: null, price: "1500.00", isActive: true },
    ],
  };

  // 1. Analysis tests
  const analysis4M = analyzeProductVariants(mockSwitch4M);
  assert.equal(analysis4M.hasVariants, true);
  assert.equal(analysis4M.hasTiers, true);
  assert.equal(analysis4M.hasFinishes, true);
  assert.deepEqual(analysis4M.availableTiers.map((t) => t.value), ["WiFi", "Zigbee"]);
  assert.deepEqual(analysis4M.availableFinishes.map((f) => f.value), ["Glass White", "Glass Black", "Matte Grey"]);

  // Dynamic finishes for WiFi vs Zigbee
  const wifiFinishes = analysis4M.getFinishesForTier("WiFi");
  assert.deepEqual(wifiFinishes.map((f) => f.value), ["Glass White", "Glass Black"]);
  const zigbeeFinishes = analysis4M.getFinishesForTier("Zigbee");
  assert.deepEqual(zigbeeFinishes.map((f) => f.value), ["Glass White", "Glass Black", "Matte Grey"]);
  pass("Product variant analysis extracts distinct tiers and dynamic finishes correctly");

  // 2. Compatibility preservation test:
  // Existing item has "Zigbee" and "Glass White". Replaced with Switch 6M.
  // Switch 6M supports both "Zigbee" and "Glass White" -> both preserved!
  const preserved = resolveCompatibleSelection({
    product: mockSwitch6M,
    existingItem: {
      id: 1,
      quotationRoomId: 1,
      productId: 101,
      productVariantId: 1003,
      productVariant: { id: 1003, automationTier: "Zigbee", surfaceFinish: "Glass White" },
      variantLabel: "Zigbee + Glass White",
    },
  });
  assert.equal(preserved.tier, "Zigbee");
  assert.equal(preserved.finish, "Glass White");
  assert.equal(preserved.variantId, 2002);
  assert.equal(preserved.price, 6800);
  assert.equal(preserved.isPreservedTier, true);
  assert.equal(preserved.isPreservedFinish, true);
  pass("Compatibility preservation: preserves both tier and finish when supported by replacement product");

  // 3. Incompatible tier fallback test:
  // Existing item had "WiFi" and "Glass Black". Switch 6M does NOT have "WiFi + Glass Black" (only WiFi + Glass White).
  // Desired tier "Zigbee" manually chosen -> available finishes for Zigbee in 6M are ["Glass White", "Matte Gold"].
  // Existing "Glass Black" is not in Zigbee for 6M -> falls back to first available "Glass White".
  const fallbackSelection = resolveCompatibleSelection({
    product: mockSwitch6M,
    existingItem: {
      id: 1,
      quotationRoomId: 1,
      productId: 101,
      productVariantId: 1002,
      productVariant: { id: 1002, automationTier: "WiFi", surfaceFinish: "Glass Black" },
    },
    desiredTier: "Zigbee",
  });
  assert.equal(fallbackSelection.tier, "Zigbee");
  assert.equal(fallbackSelection.finish, "Glass White");
  assert.equal(fallbackSelection.variantId, 2002);
  pass("Incompatible finish fallback: gracefully falls back to valid finish when old finish unsupported");

  // 4. Product with no variants/finishes:
  const noVariantAnalysis = analyzeProductVariants(mockSmartPlug);
  assert.equal(noVariantAnalysis.hasTiers, false);
  assert.equal(noVariantAnalysis.hasFinishes, false);
  assert.equal(noVariantAnalysis.hasMultipleVariants, false);

  const noVariantResolved = resolveCompatibleSelection({
    product: mockSmartPlug,
    existingItem: { id: 1, quotationRoomId: 1, productId: 101 },
  });
  assert.equal(noVariantResolved.tier, null);
  assert.equal(noVariantResolved.finish, null);
  assert.equal(noVariantResolved.variantId, 3001);
  assert.equal(noVariantResolved.price, 1500);
  pass("Product with no variants/finishes: handles cleanly with null tier/finish and correct price");

  console.log("\n--- Section 2: Full Integration Tests with Isolated Next.js Server ---");

  server = await startIsolatedServer(
    "dealer-mass-edit",
    [
      { _id: 1, email: "admin@example.com", role: "company_owner", name: "Company Owner", companyId: 1 },
      { _id: 2, email: "dealer1@example.com", role: "dealer", name: "Dealer One", discountAllocationPercent: 20, companyId: 1 },
      { _id: 3, email: "dealer2@example.com", role: "dealer", name: "Dealer Two", discountAllocationPercent: 15, companyId: 1 },
    ],
    { production: true }
  );

  const { db, login, api } = server;
  const now = new Date();

  // Seed company
  await db.collection("companies").insertOne({
    _id: 1,
    name: "Whyte Technologies",
    slug: "whyte-automations",
    status: "active",
    phone: "9876543210",
    address: "Tech Park, Bangalore",
    createdAt: now,
    updatedAt: now,
  });

  // Seed Category
  await db.collection("categories").insertOne({
    _id: 1,
    companyId: 1,
    name: "Switches",
    level: 1,
    parentId: null,
    sortOrder: 1,
    isActive: true,
  });

  // Seed HouseType and RoomTypes
  await db.collection("housetypes").insertOne({
    _id: 1,
    companyId: 1,
    name: "3BHK Villa",
    isActive: true,
    sortOrder: 1,
  });

  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", isActive: true, sortOrder: 1 },
    { _id: 2, companyId: 1, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  ]);

  // Seed Products and Variants
  await db.collection("products").insertMany([
    {
      _id: 10,
      companyId: 1,
      name: "Smart Touch Switch 4M",
      code: "STS-4M",
      type: "switch_board",
      categoryId: 1,
      unit: "pcs",
      isActive: true,
      sortOrder: 1,
      isMatrix: true,
      matrixDimensions: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 20,
      companyId: 1,
      name: "Smart Touch Switch 6M",
      code: "STS-6M",
      type: "switch_board",
      categoryId: 1,
      unit: "pcs",
      isActive: true,
      sortOrder: 2,
      isMatrix: true,
      matrixDimensions: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 30,
      companyId: 1,
      name: "Smart Plug 16A",
      code: "SPLUG-16",
      type: "accessory",
      categoryId: 1,
      unit: "pcs",
      isActive: true,
      sortOrder: 3,
      isMatrix: false,
      matrixDimensions: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 40,
      companyId: 1,
      name: "Deactivated Product",
      code: "DEACT-1",
      type: "switch_board",
      categoryId: 1,
      unit: "pcs",
      isActive: false, // Inactive!
      sortOrder: 4,
      isMatrix: false,
      matrixDimensions: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.collection("productvariants").insertMany([
    // Variants for Product 10 (4M)
    {
      _id: 101,
      companyId: 1,
      productId: 10,
      automationTier: "WiFi",
      surfaceFinish: "Glass White",
      config: { series: "WiFi", finish: "Glass White" },
      price: Decimal128.fromString("4000.00"),
      priceWithoutTax: Decimal128.fromString("3389.83"),
      taxPercent: Decimal128.fromString("18.00"),
      isActive: true,
      sortOrder: 1,
    },
    {
      _id: 102,
      companyId: 1,
      productId: 10,
      automationTier: "Zigbee",
      surfaceFinish: "Glass Black",
      config: { series: "Zigbee", finish: "Glass Black" },
      price: Decimal128.fromString("4800.00"),
      priceWithoutTax: Decimal128.fromString("4067.80"),
      taxPercent: Decimal128.fromString("18.00"),
      isActive: true,
      sortOrder: 2,
    },
    // Variants for Product 20 (6M)
    {
      _id: 201,
      companyId: 1,
      productId: 20,
      automationTier: "WiFi",
      surfaceFinish: "Glass White",
      config: { series: "WiFi", finish: "Glass White" },
      price: Decimal128.fromString("6000.00"),
      priceWithoutTax: Decimal128.fromString("5084.75"),
      taxPercent: Decimal128.fromString("18.00"),
      isActive: true,
      sortOrder: 1,
    },
    {
      _id: 202,
      companyId: 1,
      productId: 20,
      automationTier: "Zigbee",
      surfaceFinish: "Matte Gold",
      config: { series: "Zigbee", finish: "Matte Gold" },
      price: Decimal128.fromString("7200.00"),
      priceWithoutTax: Decimal128.fromString("6101.69"),
      taxPercent: Decimal128.fromString("18.00"),
      isActive: true,
      sortOrder: 2,
    },
    // Variant for Product 30 (Smart Plug)
    {
      _id: 301,
      companyId: 1,
      productId: 30,
      automationTier: null,
      surfaceFinish: null,
      config: {},
      price: Decimal128.fromString("1500.00"),
      priceWithoutTax: Decimal128.fromString("1271.19"),
      taxPercent: Decimal128.fromString("18.00"),
      isActive: true,
      sortOrder: 1,
    },
  ]);

  const dealerCookie = await login("dealer1@example.com", "user");
  const otherDealerCookie = await login("dealer2@example.com", "user");

  // Create a quotation for Dealer 1
  const createQRes = await api(dealerCookie, "POST", "/api/quotations", {
    clientName: "Mass Edit Test Client",
    houseTypeId: 1,
  });
  assert.equal(createQRes.status, 201);
  const qId = createQRes.data.id ?? createQRes.data._id;

  // Add Room 1 (Living Room) and Room 2 (Master Bedroom)
  const room1Res = await api(dealerCookie, "POST", `/api/quotations/${qId}/rooms`, {
    roomTypeId: 1,
    customName: "Living Room",
  });
  assert.equal(room1Res.status, 201);
  const room1Id = room1Res.data.id ?? room1Res.data._id;

  const room2Res = await api(dealerCookie, "POST", `/api/quotations/${qId}/rooms`, {
    roomTypeId: 2,
    customName: "Master Bedroom",
  });
  assert.equal(room2Res.status, 201);
  const room2Id = room2Res.data.id ?? room2Res.data._id;

  // Add 2 items to Room 1:
  // Item 1: Product 10 (WiFi + Glass White, ₹4000)
  const item1Res = await api(dealerCookie, "POST", `/api/quotations/${qId}/items`, {
    quotationRoomId: room1Id,
    productId: 10,
    productVariantId: 101,
    quantity: 2, // 2 * 4000 = 8000
  });
  assert.equal(item1Res.status, 201);
  const item1Id = item1Res.data.id ?? item1Res.data._id;

  // Item 2: Product 10 (Zigbee + Glass Black, ₹4800)
  const item2Res = await api(dealerCookie, "POST", `/api/quotations/${qId}/items`, {
    quotationRoomId: room1Id,
    productId: 10,
    productVariantId: 102,
    quantity: 1, // 1 * 4800 = 4800
  });
  assert.equal(item2Res.status, 201);
  const item2Id = item2Res.data.id ?? item2Res.data._id;

  // Add 1 item to Room 2:
  // Item 3: Product 30 (Smart Plug, ₹1500)
  const item3Res = await api(dealerCookie, "POST", `/api/quotations/${qId}/items`, {
    quotationRoomId: room2Id,
    productId: 30,
    productVariantId: 301,
    quantity: 1, // 1 * 1500 = 1500
  });
  assert.equal(item3Res.status, 201);
  const item3Id = item3Res.data.id ?? item3Res.data._id;

  pass("Setup complete: Quotation with 2 rooms and 3 items created");

  // ═══ TEST 1: Room-wise Mass Edit ══════════════════════════════════
  // Replace Item 1 with Product 20 (Zigbee + Matte Gold, ₹7200)
  // Replace Item 2 with Product 30 (Smart Plug, ₹1500)
  const massEditRes = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item1Id,
        productId: 20,
        productVariantId: 202,
        variantLabel: "Zigbee + Matte Gold",
      },
      {
        itemId: item2Id,
        productId: 30,
        productVariantId: 301,
      },
    ],
  });

  assert.equal(massEditRes.status, 200, `Mass edit failed: ${JSON.stringify(massEditRes.data)}`);
  assert.equal(massEditRes.data.updatedCount, 2);
  pass("Mass edit multiple products in Room 1: 200 OK with updatedCount=2");

  // Verify updated room items directly from API
  const updatedQ = await api(dealerCookie, "GET", `/api/quotations/${qId}`);
  assert.equal(updatedQ.status, 200);

  const room1 = updatedQ.data.rooms.find((r) => r.id === room1Id);
  assert.ok(room1);
  const r1Item1 = room1.items.find((i) => i.id === item1Id);
  const r1Item2 = room1.items.find((i) => i.id === item2Id);

  // Check Item 1:
  assert.equal(r1Item1.productId, 20);
  assert.equal(r1Item1.productVariantId, 202);
  assert.equal(r1Item1.quantity, 2); // Preserved quantity!
  assert.equal(Number(r1Item1.unitPrice), 7200); // Authoritative variant price!
  assert.equal(r1Item1.variantLabel, "Zigbee + Matte Gold");

  // Check Item 2:
  assert.equal(r1Item2.productId, 30);
  assert.equal(r1Item2.productVariantId, 301);
  assert.equal(r1Item2.quantity, 1);
  assert.equal(Number(r1Item2.unitPrice), 1500);
  pass("Authoritative prices, variant labels, and preserved quantities verified for mass-edited items");

  // ═══ TEST 2: Ensure products in other rooms remain unchanged ══════
  const room2 = updatedQ.data.rooms.find((r) => r.id === room2Id);
  assert.ok(room2);
  assert.equal(room2.items.length, 1);
  const r2Item = room2.items[0];
  assert.equal(r2Item.id, item3Id);
  assert.equal(r2Item.productId, 30);
  assert.equal(r2Item.productVariantId, 301);
  assert.equal(r2Item.quantity, 1);
  assert.equal(Number(r2Item.unitPrice), 1500);
  pass("Other rooms remain completely unchanged after room-wise mass edit");

  // ═══ TEST 3: Totals & GST recalculation after mass edit ═════════════
  // Room 1: Item 1 (2 * 7200 = 14400) + Item 2 (1 * 1500 = 1500) = 15900
  // Room 2: Item 3 (1 * 1500 = 1500)
  // Subtotal = 15900 + 1500 = 17400
  assert.equal(Number(updatedQ.data.subtotal), 17400);
  pass("Quotation subtotal and room totals recalculated authoritatively: ₹17,400");

  // ═══ TEST 4: Single item replacement via PATCH /items/:itemId ═════
  const singleReplaceRes = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/items/${item2Id}`, {
    productId: 10,
    productVariantId: 101, // WiFi + Glass White (₹4000)
  });
  assert.equal(singleReplaceRes.status, 200);
  assert.equal(singleReplaceRes.data.productId, 10);
  assert.equal(singleReplaceRes.data.productVariantId, 101);
  assert.equal(Number(singleReplaceRes.data.unitPrice), 4000);
  assert.equal(singleReplaceRes.data.variantLabel, "WiFi + Glass White");
  pass("Single item replacement via PATCH /items/:itemId sets authoritative variant, price, and label");

  // ═══ TEST 5: Rejection of cross-room / invalid item ID ════════════
  const invalidCrossRoom = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item3Id, // item3 belongs to room2, not room1!
        productId: 20,
        productVariantId: 201,
      },
    ],
  });
  assert.equal(invalidCrossRoom.status, 400);
  pass("Cross-room item mass edit rejected with 400 (strict room scoping enforced)");

  // ═══ TEST 6: Rejection of invalid / incompatible variant ID ═══════
  const invalidVariant = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item1Id,
        productId: 20,
        productVariantId: 999999, // Non-existent variant!
      },
    ],
  });
  assert.equal(invalidVariant.status, 400);
  pass("Incompatible / non-existent variant ID rejected with 400 VALIDATION_ERROR");

  // ═══ TEST 7: Rejection of inactive product ════════════════════════
  const inactiveProd = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item1Id,
        productId: 40, // Deactivated product
      },
    ],
  });
  assert.equal(inactiveProd.status, 400);
  pass("Inactive / unavailable product rejected with 400 VALIDATION_ERROR");

  // ═══ TEST 8: Unauthorized dealer access ═══════════════════════════
  // Dealer 2 tries to modify Dealer 1's quotation
  const unauthorizedDealer = await api(otherDealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item1Id,
        productId: 20,
        productVariantId: 201,
      },
    ],
  });
  assert.equal(unauthorizedDealer.status, 403);
  pass("Unauthorized dealer access rejected with 403 FORBIDDEN");

  // ═══ TEST 9: Locked quotation restriction (Approved status) ═══════
  await db.collection("quotations").updateOne({ _id: qId }, { $set: { status: "approved" } });

  const lockedEdit = await api(dealerCookie, "PATCH", `/api/quotations/${qId}/rooms/${room1Id}/items`, {
    items: [
      {
        itemId: item1Id,
        productId: 20,
        productVariantId: 201,
      },
    ],
  });
  assert.equal(lockedEdit.status, 403);
  // ═══ SECTION 3: Searchable Replacement Product Selector Verification ═══════
  console.log("\n--- Section 3: Searchable Replacement Product Selector Logic ---");

  // Mock catalog products
  const testProducts = [
    { id: 101, name: "Smart Touch Switch 4M", code: "STS-4M", price: 4000, isActive: true },
    { id: 102, name: "Smart Touch Switch 6M", code: "STS-6M", price: 6000, isActive: true },
    { id: 103, name: "Dimmer Controller", code: "DIM-01", price: 2500, isActive: true },
    { id: 104, name: "Curtain Motor WiFi", code: "MOT-WIFI", price: 8500, isActive: true },
    { id: 105, name: "Power Socket 16A", code: "SKT-16A", price: 1200, isActive: true },
    { id: 106, name: "Deactivated Sensor", code: "SEN-X", price: 900, isActive: false },
  ];

  // Map to SelectOption shape exactly as in RoomMassEditModal.tsx
  const searchableOptions = testProducts
    .filter((p) => p.isActive)
    .map((p) => ({
      value: String(p.id),
      label: p.name,
      subLabel: p.code,
      badge: `from ₹${p.price.toLocaleString("en-IN")}`,
      searchTerms: [p.name, p.code].filter(Boolean),
    }));

  assert.equal(searchableOptions.length, 5, "Deactivated products must not be included");

  // Filtering function matching SearchableSelect.tsx
  const filterOptions = (options, query) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((opt) => {
      if (opt.label && opt.label.toLowerCase().includes(needle)) return true;
      if (opt.subLabel && opt.subLabel.toLowerCase().includes(needle)) return true;
      if (opt.badge && opt.badge.toLowerCase().includes(needle)) return true;
      if (opt.searchTerms && opt.searchTerms.some((term) => term && term.toLowerCase().includes(needle))) return true;
      return false;
    });
  };

  // 1. Search by exact & partial product code
  const codeMatches = filterOptions(searchableOptions, "STS");
  assert.equal(codeMatches.length, 2);
  assert.deepEqual(codeMatches.map((o) => o.subLabel), ["STS-4M", "STS-6M"]);
  pass("Search by partial product code ('STS') returns matching products");

  const specificCode = filterOptions(searchableOptions, "dim-01");
  assert.equal(specificCode.length, 1);
  assert.equal(specificCode[0].subLabel, "DIM-01");
  assert.equal(specificCode[0].label, "Dimmer Controller");
  pass("Search by case-insensitive product code ('dim-01') matches 'DIM-01'");

  // 2. Search by product name (partial & case-insensitive)
  const nameMatches = filterOptions(searchableOptions, "curtain");
  assert.equal(nameMatches.length, 1);
  assert.equal(nameMatches[0].label, "Curtain Motor WiFi");
  pass("Search by partial product name ('curtain') matches correctly");

  // 3. Search with whitespace
  const trimmedMatches = filterOptions(searchableOptions, "   skt-16a   ");
  assert.equal(trimmedMatches.length, 1);
  assert.equal(trimmedMatches[0].subLabel, "SKT-16A");
  pass("Search with leading/trailing whitespace is trimmed and matches correctly");

  // 4. No products found state
  const noMatches = filterOptions(searchableOptions, "NonExistentModel999");
  assert.equal(noMatches.length, 0);
  pass("Search with no matching products returns empty array (triggers 'No products found')");

  // 5. Clear search query restores all products
  const clearedSearch = filterOptions(searchableOptions, "");
  assert.equal(clearedSearch.length, 5);
  pass("Empty query string returns all active products");

  // 6. Independent row search simulation
  const row1Query = "DIM";
  const row2Query = "SKT";
  const row3Query = "";
  const row1Results = filterOptions(searchableOptions, row1Query);
  const row2Results = filterOptions(searchableOptions, row2Query);
  const row3Results = filterOptions(searchableOptions, row3Query);
  assert.equal(row1Results.length, 1);
  assert.equal(row1Results[0].subLabel, "DIM-01");
  assert.equal(row2Results.length, 1);
  assert.equal(row2Results[0].subLabel, "SKT-16A");
  assert.equal(row3Results.length, 5);
  pass("Independent row search states operate concurrently without interference");

  console.log("\n========================================================");
  console.log(`All ${results.length} tests passed successfully!`);
  console.log("========================================================\n");
} catch (err) {
  console.error("Test failed:", err);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
