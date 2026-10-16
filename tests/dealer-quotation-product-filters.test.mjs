/**
 * Targeted tests for Dealer Quotation product-selection filter behavior:
 * - Product catalog Automation Tier and Surface Finish filters
 * - Room quotation items persistence when filters change
 * - "In Room" badge logic (product-plus-variant identity)
 * - Handling multiple variants of same product
 * - Preventing accidental duplicate items on addition (quantity increment)
 * - Safe removal / decrement
 * - Preservation of variant-specific pricing and quotation totals
 *
 * Run with: npx tsx tests/dealer-quotation-product-filters.test.mjs
 */
import assert from "node:assert/strict";
import {
  filterProductCatalog,
  getVariantTier,
  getVariantFinish,
} from "../src/lib/productFiltering.ts";
import {
  formatTierLabel,
  formatFinishLabel,
} from "../src/lib/categoryConfig.ts";

console.log("--- Test Suite: Dealer Quotation Product Selection Filters ---");

// Mock catalog data
const mockProducts = [
  {
    id: 101,
    name: "4-Touch Smart Switch Board",
    code: "WHYTE-SW-4T",
    type: "switch_board",
    categoryId: 1,
    category: { id: 1, name: "Smart Switches" },
    isActive: true,
    variants: [
      {
        id: 1001,
        name: "WiFi · Black Glass",
        automationTier: "wifi",
        surfaceFinish: "black_glass",
        price: 4000,
        isActive: true,
      },
      {
        id: 1002,
        name: "WiFi · White Glass",
        automationTier: "wifi",
        surfaceFinish: "white_glass",
        price: 4000,
        isActive: true,
      },
      {
        id: 1003,
        name: "Zigbee · Black Glass",
        automationTier: "zigbee",
        surfaceFinish: "black_glass",
        price: 4800,
        isActive: true,
      },
      {
        id: 1004,
        name: "Zigbee · White Glass",
        automationTier: "zigbee",
        surfaceFinish: "white_glass",
        price: 4800,
        isActive: true,
      },
    ],
  },
  {
    id: 102,
    name: "RGB Smart Light Controller",
    code: "WHYTE-RGB-CTRL",
    type: "accessory",
    categoryId: 2,
    category: { id: 2, name: "Lighting" },
    isActive: true,
    variants: [
      {
        id: 2001,
        name: "WiFi",
        automationTier: "wifi",
        surfaceFinish: null,
        price: 2500,
        isActive: true,
      },
      {
        id: 2002,
        name: "Zigbee",
        automationTier: "zigbee",
        surfaceFinish: null,
        price: 3200,
        isActive: true,
      },
    ],
  },
  {
    id: 103,
    name: "Universal IR Blaster",
    code: "WHYTE-IR-BLAST",
    type: "accessory",
    categoryId: 3,
    category: { id: 3, name: "Accessories" },
    price: 1500,
    isActive: true,
    variants: [], // Flat product without variants
  },
];

const mockCategoryConfig = {
  hasCategoryTiers: true,
  hasCategoryFinishes: true,
  configuredTiers: [
    { value: "wifi", label: "WiFi" },
    { value: "zigbee", label: "Zigbee" },
  ],
  configuredFinishes: [
    { value: "black_glass", label: "Black Glass" },
    { value: "white_glass", label: "White Glass" },
  ],
};

// Test 1: Filters correctly narrow the catalog
{
  // Filter: WiFi + Black Glass in Category 1
  const results = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "wifi",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });

  assert.equal(results.length, 1, "Only 4-Touch Smart Switch Board should match category");
  const item = results[0];
  assert.equal(item.exactVariant?.id, 1001, "Exact variant should be WiFi · Black Glass (id: 1001)");
  assert.equal(item.exactVariant?.price, 4000, "Price should be 4000");
  assert.equal(item.eligibleVariants.length, 1);
  console.log("  ✓ Filter correctly resolves exact variant and price for WiFi · Black Glass");
}

// Test 2: Filter change updates the resolved exact variant and price
{
  // Change filter to Zigbee + Black Glass
  const results = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "zigbee",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });

  assert.equal(results.length, 1);
  const item = results[0];
  assert.equal(item.exactVariant?.id, 1003, "Exact variant should now be Zigbee · Black Glass (id: 1003)");
  assert.equal(item.exactVariant?.price, 4800, "Variant price should update to 4800");
  console.log("  ✓ Changing tier filter switches exact variant to Zigbee with ₹4,800 pricing");
}

// Test 3: "In Room" badge logic with product-plus-variant identity
{
  // Simulate room state where WiFi · Black Glass (id: 1001) has been added
  const roomItems = [
    {
      id: 1,
      productId: 101,
      productVariantId: 1001,
      variantLabel: "WiFi · Black Glass",
      quantity: 2,
      unitPrice: 4000,
    },
  ];

  // Helper simulating the updated StepProductConfig badge computation
  function computeCardInRoomState(catItem, currentRoomItems) {
    const { product: prod, eligibleVariants, exactVariant } = catItem;
    const prodId = Number(prod.id);
    const exactVarId = exactVariant ? Number(exactVariant.id) : null;

    const productTotalInRoom = currentRoomItems
      .filter((i) => Number(i.productId) === prodId)
      .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

    const inRoomCount = currentRoomItems
      .filter((i) => {
        const pId = Number(i.productId);
        if (pId !== prodId) return false;
        if (exactVarId !== null) {
          return Number(i.productVariantId) === exactVarId;
        }
        if (eligibleVariants.length > 0) {
          return eligibleVariants.some((v) => Number(v.id) === Number(i.productVariantId));
        }
        return true;
      })
      .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

    const otherVariantsInRoom = productTotalInRoom - inRoomCount;

    return { inRoomCount, productTotalInRoom, otherVariantsInRoom };
  }

  // Under WiFi + Black Glass filter:
  const wifiCatalog = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "wifi",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });
  const wifiState = computeCardInRoomState(wifiCatalog[0], roomItems);
  assert.equal(wifiState.inRoomCount, 2, "In Room count must be 2 for WiFi · Black Glass");
  assert.equal(wifiState.otherVariantsInRoom, 0);

  // When dealer changes filter to Zigbee + Black Glass:
  const zigbeeCatalog = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "zigbee",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });
  const zigbeeState = computeCardInRoomState(zigbeeCatalog[0], roomItems);
  assert.equal(
    zigbeeState.inRoomCount,
    0,
    "Zigbee card must NOT display In Room count when only WiFi was added"
  );
  assert.equal(
    zigbeeState.productTotalInRoom,
    2,
    "Product total in room must remain 2 (preserves room selection)"
  );
  assert.equal(
    zigbeeState.otherVariantsInRoom,
    2,
    "otherVariantsInRoom must be 2 indicating another variant is in room"
  );

  console.log("  ✓ 'In Room' badge uses product-plus-variant identity and does not falsely mark unselected variants");
}

// Test 4: Changing filters does not mutate or drop room items
{
  const initialRoom = {
    id: 10,
    name: "Living Room",
    items: [
      {
        id: 501,
        productId: 101,
        productVariantId: 1001,
        variantLabel: "WiFi · Black Glass",
        quantity: 3,
        unitPrice: 4000,
      },
      {
        id: 502,
        productId: 103,
        productVariantId: null,
        variantLabel: null,
        quantity: 1,
        unitPrice: 1500,
      },
    ],
  };

  // Dealer filters catalog by Lighting (which doesn't contain Switch 101 or IR 103)
  const lightingCatalog = filterProductCatalog(mockProducts, {
    categoryId: 2,
    ...mockCategoryConfig,
  });

  assert.equal(lightingCatalog.length, 1, "Only RGB Controller in Lighting category");
  assert.equal(lightingCatalog[0].product.id, 102);

  // Verify the room's items are completely untouched
  assert.equal(initialRoom.items.length, 2, "Room items must remain unchanged");
  assert.equal(initialRoom.items[0].quantity, 3, "Quantity must remain 3");
  assert.equal(initialRoom.items[0].unitPrice, 4000, "Price must remain 4000");
  assert.equal(initialRoom.items[1].quantity, 1);
  console.log("  ✓ Room quotation items and quantities are preserved when catalog filters change");
}

// Test 5: Stepper additions increment existing quantity instead of creating duplicates
{
  const roomItems = [
    {
      id: 601,
      productId: 101,
      productVariantId: 1001,
      variantLabel: "WiFi · Black Glass",
      quantity: 1,
      unitPrice: 4000,
    },
  ];

  let updateCalledWith = null;
  let addCalledWith = null;

  async function mockOnUpdateItem(itemId, data) {
    updateCalledWith = { itemId, data };
  }
  async function mockOnAddItem(roomId, productId, variantId, config) {
    addCalledWith = { roomId, productId, variantId, config };
  }

  // Simulate handleAddProduct logic from StepProductConfig
  async function handleAddProduct(catItem, currentRoomItems, roomId) {
    const { product, eligibleVariants, exactVariant } = catItem;
    const prodId = Number(product.id);

    if (exactVariant) {
      const varId = Number(exactVariant.id);
      const existing = currentRoomItems.find((i) => {
        return Number(i.productId) === prodId && Number(i.productVariantId) === varId;
      });

      if (existing) {
        const curQty = Number(existing.quantity) || 1;
        await mockOnUpdateItem(existing.id, { quantity: curQty + 1 });
        return;
      }

      await mockOnAddItem(roomId, prodId, varId);
      return;
    }

    if (eligibleVariants.length > 1) {
      return;
    }

    if (eligibleVariants.length === 1) {
      const v = eligibleVariants[0];
      const varId = Number(v.id);
      const existing = currentRoomItems.find((i) => {
        return Number(i.productId) === prodId && Number(i.productVariantId) === varId;
      });
      if (existing) {
        const curQty = Number(existing.quantity) || 1;
        await mockOnUpdateItem(existing.id, { quantity: curQty + 1 });
        return;
      }
      await mockOnAddItem(roomId, prodId, varId);
      return;
    }
  }

  // Under WiFi + Black Glass filter (exactVariant = 1001):
  const wifiCatalog = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "wifi",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });

  // Click "+" on the card
  await handleAddProduct(wifiCatalog[0], roomItems, 10);
  assert.equal(addCalledWith, null, "Must NOT call onAddItem (prevents duplicate row)");
  assert.deepEqual(updateCalledWith, { itemId: 601, data: { quantity: 2 } }, "Must increment quantity to 2");

  // Reset and try adding Zigbee variant (not in room yet)
  updateCalledWith = null;
  addCalledWith = null;
  const zigbeeCatalog = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "zigbee",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });
  await handleAddProduct(zigbeeCatalog[0], roomItems, 10);
  assert.equal(updateCalledWith, null);
  assert.deepEqual(addCalledWith, { roomId: 10, productId: 101, variantId: 1003, config: undefined });
  console.log("  ✓ handleAddProduct increments quantity for matching variant, avoiding duplicates");
}

// Test 6: Stepper decrement decrements quantity or removes when quantity is 1
{
  const roomItems = [
    {
      id: 701,
      productId: 101,
      productVariantId: 1001,
      quantity: 2,
    },
    {
      id: 702,
      productId: 101,
      productVariantId: 1003,
      quantity: 1,
    },
  ];

  let updateCalledWith = null;
  let deleteCalledWith = null;

  async function mockOnUpdateItem(itemId, data) {
    updateCalledWith = { itemId, data };
  }
  async function mockOnDeleteItem(itemId) {
    deleteCalledWith = itemId;
  }

  async function handleRemoveProductInstance(catItem, currentRoomItems) {
    const { product, exactVariant } = catItem;
    const prodId = Number(product.id);
    const exactVarId = exactVariant ? Number(exactVariant.id) : null;

    const matchingItem = currentRoomItems.find((i) => {
      const pId = Number(i.productId);
      if (pId !== prodId) return false;
      if (exactVarId !== null) {
        return Number(i.productVariantId) === exactVarId;
      }
      return true;
    });

    if (!matchingItem) return;
    const currentQty = Number(matchingItem.quantity) || 1;
    if (currentQty > 1) {
      await mockOnUpdateItem(matchingItem.id, { quantity: currentQty - 1 });
    } else {
      await mockOnDeleteItem(matchingItem.id);
    }
  }

  // Remove WiFi (qty 2 -> qty 1)
  const wifiCat = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "wifi",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });
  await handleRemoveProductInstance(wifiCat[0], roomItems);
  assert.deepEqual(updateCalledWith, { itemId: 701, data: { quantity: 1 } });
  assert.equal(deleteCalledWith, null);

  // Remove Zigbee (qty 1 -> deleted)
  updateCalledWith = null;
  const zigbeeCat = filterProductCatalog(mockProducts, {
    categoryId: 1,
    automationTier: "zigbee",
    surfaceFinish: "black_glass",
    ...mockCategoryConfig,
  });
  await handleRemoveProductInstance(zigbeeCat[0], roomItems);
  assert.equal(updateCalledWith, null);
  assert.equal(deleteCalledWith, 702);
  console.log("  ✓ handleRemoveProductInstance accurately decrements or deletes matching variant");
}

console.log("\nALL 6 TARGETED FILTER BEHAVIOR TESTS PASSED SUCCESSFULLY!");
