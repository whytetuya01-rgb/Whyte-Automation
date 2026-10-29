/**
 * The legacy flat `whyte/products/` images belong to the default company (slug `whyte-automations`), the same
 * company the tenant backfill classifies them under. A company that self-registers as "Whyte" (slug `whyte`) must
 * never be able to manage or delete them. Runs against a throwaway database on the local MongoDB.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/legacy-image-owner.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { ApiError } from "../src/lib/api-response";
import { DEFAULT_COMPANY_SLUG } from "../src/lib/tenant/constants";
import { LEGACY_ASSET_OWNER_SLUG, assertImageManageable, resolveLegacyOwnerCompanyId } from "../src/lib/imageOwnership";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const forbidden = async (fn: () => Promise<unknown>, label: string) => {
  await assert.rejects(fn, (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN", label);
};

async function main() {
  assert.equal(LEGACY_ASSET_OWNER_SLUG, DEFAULT_COMPANY_SLUG, "legacy assets belong to the one shared default company");
  pass("the legacy asset owner is the shared default company slug, not a separate literal");

  const dbName = `whyte_legacy_image_owner_${randomBytes(5).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  let failed = false;
  try {
    const now = new Date();
    const base = { status: "active", phone: "1", address: "x", isDeleted: false, createdAt: now, updatedAt: now };
    await mongoose.connection.collection("companies").insertMany([
      { _id: 1, name: "Whyte Automations", slug: "whyte-automations", ...base } as never,
      // A different tenant that self-registered as "Whyte".
      { _id: 7, name: "Whyte", slug: "whyte", ...base } as never,
      { _id: 8, name: "Acme Homes", slug: "acme-homes", ...base } as never,
    ]);

    assert.equal(await resolveLegacyOwnerCompanyId(), 1);
    await assertImageManageable("whyte/products/switch-plate-01", 1);
    await forbidden(() => assertImageManageable("whyte/products/switch-plate-01", 7), "a company named 'Whyte' cannot touch Whyte's legacy images");
    await forbidden(() => assertImageManageable("whyte/products/switch-plate-01", 8), "nor can any other company");
    pass("the default company manages its legacy images; a self-registered 'whyte' company and others are refused");

    await mongoose.connection.collection("companies").updateOne({ _id: 1 } as never, { $set: { isDeleted: true } });
    assert.equal(await resolveLegacyOwnerCompanyId(), null, "a deleted default company owns nothing");
    await forbidden(() => assertImageManageable("whyte/products/switch-plate-01", 7), "and the 'whyte' company still cannot take them over");
    pass("without a live default company nobody can manage the legacy images");
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
    if (failed) process.exitCode = 1;
  }
}

main()
  .then(() => {
    console.log(`\n${count} passed`);
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
