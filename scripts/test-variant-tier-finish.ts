import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { ProductVariant } from "../src/models/ProductVariant";
import { serializeVariant } from "../src/lib/productVariantService";
import { formatTierLabel, formatFinishLabel } from "../src/lib/categoryConfig";
import { getVariantTier, getVariantFinish, isVariantEligible } from "../src/lib/productFiltering";
import assert from "node:assert/strict";

async function run() {
  console.log("==================================================");
  console.log("TESTING VARIANT TIER & FINISH INTEGRATION");
  console.log("==================================================\n");

  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("[PASS] Connected to MongoDB Atlas.\n");

  // 1. Verify Real Variant 1 (Remote + Acrylic)
  console.log("--- 1. Testing Real Variant 1 (_id: 1) ---");
  const rawVar1 = await ProductVariant.findById(1).lean();
  assert.ok(rawVar1, "Variant 1 must exist in DB");
  console.log("Raw MongoDB Variant 1:", {
    _id: rawVar1._id,
    automationTier: rawVar1.automationTier,
    surfaceFinish: rawVar1.surfaceFinish,
    price: rawVar1.price?.toString(),
    priceWithoutTax: rawVar1.priceWithoutTax?.toString(),
  });

  const serialized1 = serializeVariant(rawVar1 as any);
  console.log("Serialized Variant 1:", serialized1);

  assert.equal(serialized1.automationTier, "remote");
  assert.equal(serialized1.surfaceFinish, "acrylic");
  assert.equal(serialized1.tierLabel, "Remote");
  assert.equal(serialized1.finishLabel, "Acrylic");
  assert.equal(serialized1.name, "Remote · Acrylic");
  assert.equal(formatTierLabel(serialized1.automationTier), "Remote");
  assert.equal(formatFinishLabel(serialized1.surfaceFinish), "Acrylic");
  console.log("[PASS] Variant 1 correctly returns 'Remote' and 'Acrylic'!\n");

  // 2. Verify Real Variant 3 (WiFi + Acrylic)
  console.log("--- 2. Testing Real Variant 3 (_id: 3) ---");
  const rawVar3 = await ProductVariant.findById(3).lean();
  assert.ok(rawVar3, "Variant 3 must exist in DB");
  const serialized3 = serializeVariant(rawVar3 as any);
  console.log("Serialized Variant 3:", serialized3);

  assert.equal(serialized3.automationTier, "wifi");
  assert.equal(serialized3.surfaceFinish, "acrylic");
  assert.equal(serialized3.tierLabel, "WiFi");
  assert.equal(serialized3.finishLabel, "Acrylic");
  assert.equal(serialized3.name, "WiFi · Acrylic");
  assert.equal(formatTierLabel(serialized3.automationTier), "WiFi");
  assert.equal(formatFinishLabel(serialized3.surfaceFinish), "Acrylic");
  console.log("[PASS] Variant 3 correctly returns 'WiFi' and 'Acrylic'!\n");

  // 3. Verify Label Formatter Dictionary
  console.log("--- 3. Testing Label Formatter Dictionary ---");
  assert.equal(formatTierLabel("remote"), "Remote");
  assert.equal(formatTierLabel("wifi"), "WiFi");
  assert.equal(formatTierLabel("bluetooth"), "Bluetooth");
  assert.equal(formatTierLabel("wired"), "Wired");
  assert.equal(formatTierLabel("zigbee"), "Zigbee");
  assert.equal(formatTierLabel(null), null);
  assert.equal(formatTierLabel(""), null);

  assert.equal(formatFinishLabel("acrylic"), "Acrylic");
  assert.equal(formatFinishLabel("glass"), "Glass");
  assert.equal(formatFinishLabel("metal"), "Metal");
  assert.equal(formatFinishLabel("wood"), "Wood");
  assert.equal(formatFinishLabel(null), null);
  assert.equal(formatFinishLabel(""), null);
  console.log("[PASS] Label formatters successfully map all tier/finish cases!\n");

  // 4. Verify Filter Behavior
  console.log("--- 4. Testing Filter Behavior ---");
  assert.equal(getVariantTier(serialized1 as any), "remote");
  assert.equal(getVariantFinish(serialized1 as any), "acrylic");

  // Test single filter: Remote
  const remoteEligible = isVariantEligible(serialized1 as any, {
    automationTier: "remote",
    surfaceFinish: "all",
  });
  assert.equal(remoteEligible, true);

  const wifiEligibleForRemoteFilter = isVariantEligible(serialized3 as any, {
    automationTier: "remote",
    surfaceFinish: "all",
  });
  assert.equal(wifiEligibleForRemoteFilter, false);

  // Test combined filter: Remote + Acrylic
  const comboMatch = isVariantEligible(serialized1 as any, {
    automationTier: "remote",
    surfaceFinish: "acrylic",
  });
  assert.equal(comboMatch, true);

  const comboMismatch = isVariantEligible(serialized3 as any, {
    automationTier: "remote",
    surfaceFinish: "acrylic",
  });
  assert.equal(comboMismatch, false);

  console.log("[PASS] Product catalog filtering works accurately using automationTier and surfaceFinish!\n");

  console.log("==================================================");
  console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
  console.log("==================================================");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
