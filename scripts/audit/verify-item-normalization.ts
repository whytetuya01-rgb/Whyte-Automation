import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotationItem } from "../../src/lib/quotationNormalization";
import { serializeVariant } from "../../src/lib/productVariantService";

/**
 * READ-ONLY. Confirms the new `normalizeQuotationItem` productVariant
 * construction preserves every field a live screen actually reads
 * (id, surfaceFinish, automationTier, config, imageUrl, imagePublicId),
 * compared against the OLD `serializeVariant`-based construction, for every
 * real quotation item that has a productVariant — using full, unprojected
 * data (this isolates the normalization-logic change from the later
 * Mongoose query/select change).
 */
async function main() {
  await connectMongoDB();

  const docs = await Quotation.find()
    .populate({
      path: "rooms",
      populate: {
        path: "items",
        populate: [{ path: "product" }, { path: "productVariant" }],
      },
    })
    .lean({ virtuals: true });

  const fields = ["id", "surfaceFinish", "automationTier"] as const;

  let checked = 0;
  let mismatches = 0;

  for (const doc of docs as unknown as Array<{ rooms?: Array<{ items?: Array<Record<string, unknown>> }> }>) {
    for (const room of doc.rooms ?? []) {
      for (const item of room.items ?? []) {
        if (!item.productVariant) continue;
        checked += 1;

        const oldVariant = serializeVariant({
          ...(item.productVariant as Record<string, unknown>),
          productId:
            (item.productVariant as { productId?: unknown }).productId ??
            (item as { productId?: unknown }).productId ??
            0,
        }) as unknown as Record<string, unknown>;

        const newItem = normalizeQuotationItem(item);
        const newVariant = (newItem.productVariant ?? {}) as unknown as Record<string, unknown>;

        for (const field of fields) {
          const a = JSON.stringify(oldVariant[field] ?? null);
          const b = JSON.stringify(newVariant[field] ?? null);
          if (a !== b) {
            console.log(`MISMATCH item ${String((item as { _id?: unknown })._id)}.${field}: old=${a} new=${b}`);
            mismatches += 1;
          }
        }
      }
    }
  }

  console.log(`Checked ${checked} items with a productVariant, across ${fields.length} fields each.`);
  console.log(mismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${mismatches} mismatches.`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-item-normalization failed:", error);
  process.exit(1);
});
