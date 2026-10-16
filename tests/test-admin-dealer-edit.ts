import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// Simple .env parser for standalone test runner
try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  // Ignore
}
import {
  saveRolePermissions,
  resetRoleToDefaults,
  getAllRolesMetadata,
  getRolePermissions,
} from "../src/lib/roleService";
import { connectMongoDB } from "../src/lib/mongodb";
import { ADMIN_DEFAULT_PERMISSIONS, DEALER_DEFAULT_PERMISSIONS } from "../src/lib/permissions";

async function run() {
  console.log("Connecting to MongoDB...");
  await connectMongoDB();

  console.log("1. Fetching current roles metadata...");
  const initialRoles = await getAllRolesMetadata(null);
  const adminRole = initialRoles.find((r) => r.key === "admin");
  const dealerRole = initialRoles.find((r) => r.key === "dealer");

  console.log("Initial admin isEditable:", adminRole?.isEditable, "isCustomized:", adminRole?.isCustomized);
  console.log("Initial dealer isEditable:", dealerRole?.isEditable, "isCustomized:", dealerRole?.isCustomized);

  assert.equal(adminRole?.isEditable, true, "Admin must be marked editable");
  assert.equal(dealerRole?.isEditable, true, "Dealer must be marked editable");

  console.log("\n2. Testing saving customized admin permissions...");
  // Customize admin to revoke catalog:delete
  const customAdminPerms = Array.from(ADMIN_DEFAULT_PERMISSIONS).filter((p) => p !== "catalog:delete");
  const savedAdmin = await saveRolePermissions("admin", customAdminPerms, 1);
  console.log("Saved admin customized:", savedAdmin?.isCustomized, "perms count:", savedAdmin?.permissions.length);
  assert.equal(savedAdmin?.isCustomized, true);
  assert.equal(savedAdmin?.permissions.includes("catalog:delete" as any), false);

  // TODO(Phase 1 Step 4): this test predates company-scoped roles and needs a
  // full rewrite once saveRolePermissions/getRolePermissions take a companyId.
  const effectiveAdminPerms = await getRolePermissions("admin", null);
  assert.equal(effectiveAdminPerms.includes("catalog:delete" as any), false);
  console.log("Effective admin perms verify: catalog:delete is revoked");

  console.log("\n3. Testing saving customized dealer permissions...");
  // Customize dealer to add catalog:read
  const customDealerPerms = [...Array.from(DEALER_DEFAULT_PERMISSIONS), "catalog:read"];
  const savedDealer = await saveRolePermissions("dealer", customDealerPerms, 1);
  console.log("Saved dealer customized:", savedDealer?.isCustomized, "perms count:", savedDealer?.permissions.length);
  assert.equal(savedDealer?.isCustomized, true);
  assert.equal(savedDealer?.permissions.includes("catalog:read" as any), true);

  const effectiveDealerPerms = await getRolePermissions("dealer", null);
  assert.equal(effectiveDealerPerms.includes("catalog:read" as any), true);
  console.log("Effective dealer perms verify: catalog:read is granted");

  console.log("\n4. Resetting admin and dealer back to defaults...");
  await resetRoleToDefaults("admin", 1);
  await resetRoleToDefaults("dealer", 1);

  const resetAdmin = (await getAllRolesMetadata(1)).find((r) => r.key === "admin");
  const resetDealer = (await getAllRolesMetadata(1)).find((r) => r.key === "dealer");
  assert.equal(resetAdmin?.isCustomized, false);
  assert.equal(resetDealer?.isCustomized, false);
  console.log("Successfully restored defaults.");

  console.log("\nAll direct roleService operations succeeded!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error during test:", err);
  process.exit(1);
});
