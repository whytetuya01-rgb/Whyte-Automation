import assert from "node:assert/strict";
import { ROOM_PRESET_PACKAGES, resolvePresetProduct } from "../src/lib/roomPresets";
import type { EditorCatalogProduct } from "../src/types";

function pass(name: string) {
  console.log(`✓ ${name}`);
}

async function run() {
  console.log("\n--- Testing Room Presets & Smart Packages ---");

  // 1. Check presets structure
  assert.equal(ROOM_PRESET_PACKAGES.length, 3, "There should be 3 preset packages");
  assert.equal(ROOM_PRESET_PACKAGES[0].id, "essential");
  assert.equal(ROOM_PRESET_PACKAGES[1].id, "standard");
  assert.equal(ROOM_PRESET_PACKAGES[2].id, "luxury");
  pass("1. Preset package definitions are valid");

  // Mock catalog products
  const mockProducts: EditorCatalogProduct[] = [
    {
      id: 101,
      name: "Whyte Touch 4 Switch 1 Socket",
      code: "WT-4S1SK",
      categoryId: 1,
      isActive: true,
      variants: [
        {
          id: 1001,
          productId: 101,
          automationTier: "zigbee",
          surfaceFinish: "glass_black",
          price: 4500,
          isActive: true,
        },
        {
          id: 1002,
          productId: 101,
          automationTier: "wifi",
          surfaceFinish: "glass_white",
          price: 4200,
          isActive: true,
        },
      ],
    } as any,
    {
      id: 102,
      name: "Smart Fan Regulator",
      code: "WT-FAN-1",
      categoryId: 1,
      isActive: true,
      variants: [
        {
          id: 1003,
          productId: 102,
          automationTier: "zigbee",
          surfaceFinish: "glass_black",
          price: 2800,
          isActive: true,
        },
      ],
    } as any,
    {
      id: 103,
      name: "Power Socket Module 16A",
      code: "WT-SK-16A",
      categoryId: 2,
      isActive: true,
      variants: [],
    } as any,
  ];

  // 2. Resolve matching both tier & finish
  const resolvedZigbeeBlack = resolvePresetProduct(
    { keywords: ["Touch 4 Switch 1 Socket"], quantity: 1, label: "Switchboard" },
    mockProducts,
    "zigbee",
    "glass_black"
  );
  assert.ok(resolvedZigbeeBlack, "Should resolve product");
  assert.equal(resolvedZigbeeBlack?.product.id, 101);
  assert.equal(resolvedZigbeeBlack?.variant?.id, 1001);
  pass("2. resolvePresetProduct accurately matches tier and finish");

  // 3. Resolve matching fallback when "all" is passed
  const resolvedWildcard = resolvePresetProduct(
    { keywords: ["Fan Regulator"], quantity: 1, label: "Fan" },
    mockProducts,
    "all",
    "all"
  );
  assert.ok(resolvedWildcard, "Should resolve product even with 'all' tier/finish");
  assert.equal(resolvedWildcard?.product.id, 102);
  assert.equal(resolvedWildcard?.variant?.id, 1003);
  pass("3. resolvePresetProduct handles 'all' wildcards without failing");

  // 4. Resolve product with no variants
  const resolvedNoVariant = resolvePresetProduct(
    { keywords: ["Power Socket", "Socket"], quantity: 1, label: "Socket" },
    mockProducts,
    "zigbee",
    "glass_black"
  );
  assert.ok(resolvedNoVariant, "Should resolve product without variants");
  assert.equal(resolvedNoVariant?.product.id, 103);
  assert.equal(resolvedNoVariant?.variant, undefined);
  pass("4. resolvePresetProduct supports products without variants");

  // 5. Inactive products are skipped
  const mockWithInactive: EditorCatalogProduct[] = [
    {
      id: 201,
      name: "Touch 4 Switch",
      isActive: false, // inactive!
    } as any,
    {
      id: 202,
      name: "Touch 4 Switch Alternate",
      isActive: true,
    } as any,
  ];
  const resolvedActiveOnly = resolvePresetProduct(
    { keywords: ["Touch 4 Switch"], quantity: 1, label: "Switch" },
    mockWithInactive
  );
  assert.equal(resolvedActiveOnly?.product.id, 202, "Should skip inactive product and match active one");
  pass("5. resolvePresetProduct strictly skips inactive products");

  console.log("\nALL TESTS PASSED!\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

