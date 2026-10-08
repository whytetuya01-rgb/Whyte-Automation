import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation, serializeQuotationForClient } from "../../src/lib/quotationNormalization";
import { attachQuotationActors } from "../../src/lib/quotationActors";

/**
 * READ-ONLY. End-to-end parity for Step 3.1: for EVERY real quotation,
 * fetches it both the OLD way (full `product -> variants`, full
 * `productVariant`) and the NEW way (the exact slim `.select()` the routes
 * now use), runs both through the unchanged `normalizeQuotation` /
 * `serializeQuotationForClient` pipeline, and diffs:
 *
 *   - every field a live screen reads from `item.product` / `item.productVariant`
 *   - every pricing field on the item itself (unitPrice, priceWithoutTax,
 *     taxPercent, taxAmount, linePrice) — must be byte-identical, since none
 *     of those come from product/productVariant
 *   - room/quotation-level totals (subtotal, grandTotal, etc.) — must be
 *     byte-identical for the same reason
 */
async function fetchOld(quotationId: string) {
  return Quotation.findById(quotationId)
    .populate({ path: "houseType" })
    .populate({ path: "dealer", select: "id name email firstName lastName contactNumber gstNumber" })
    .populate({
      path: "rooms",
      options: { sort: { sortOrder: 1 } },
      populate: [
        { path: "roomType" },
        {
          path: "items",
          options: { sort: { sortOrder: 1 } },
          populate: [
            {
              path: "product",
              populate: { path: "variants", match: { isActive: true }, options: { sort: { sortOrder: 1 } } },
            },
            { path: "productVariant" },
          ],
        },
      ],
    })
    .lean({ virtuals: true });
}

async function fetchNew(quotationId: string) {
  return Quotation.findById(quotationId)
    .populate({ path: "houseType" })
    .populate({ path: "dealer", select: "id name email firstName lastName contactNumber gstNumber" })
    .populate({
      path: "rooms",
      options: { sort: { sortOrder: 1 } },
      populate: [
        { path: "roomType" },
        {
          path: "items",
          options: { sort: { sortOrder: 1 } },
          populate: [
            {
              path: "product",
              select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes",
            },
            { path: "productVariant", select: "surfaceFinish automationTier" },
          ],
        },
      ],
    })
    .lean({ virtuals: true });
}

const PRODUCT_FIELDS = [
  "name",
  "code",
  "type",
  "imageUrl",
  "imagePublicId",
  "categoryId",
  "moduleSize",
  "surfaceFinish",
  "automationTier",
  "notes",
] as const;
const VARIANT_FIELDS = ["id", "surfaceFinish", "automationTier"] as const;
const ITEM_PRICING_FIELDS = ["unitPrice", "priceWithoutTax", "taxPercent", "taxAmount", "linePrice", "quantity"] as const;
const QUOTATION_FIELDS = [
  "subtotal",
  "discountAmount",
  "netSubtotal",
  "grandTotal",
  "totalAmount",
  "estimatedEarningAmount",
] as const;

async function main() {
  await connectMongoDB();
  const all = await Quotation.find().select("_id quotationNumber").lean();

  let totalPayloadOld = 0;
  let totalPayloadNew = 0;
  let mismatches = 0;
  let itemsChecked = 0;

  for (const q of all) {
    const id = String(q._id);
    const [oldDoc, newDoc] = await Promise.all([fetchOld(id), fetchNew(id)]);
    if (!oldDoc || !newDoc) {
      console.log(`MISSING ${id}`);
      mismatches += 1;
      continue;
    }

    const [oldActors] = await attachQuotationActors([oldDoc]);
    const [newActors] = await attachQuotationActors([newDoc]);
    const oldNorm = serializeQuotationForClient(normalizeQuotation(JSON.parse(JSON.stringify(oldActors))));
    const newNorm = serializeQuotationForClient(normalizeQuotation(JSON.parse(JSON.stringify(newActors))));

    totalPayloadOld += JSON.stringify(oldNorm).length;
    totalPayloadNew += JSON.stringify(newNorm).length;

    for (const field of QUOTATION_FIELDS) {
      const a = JSON.stringify((oldNorm as unknown as Record<string, unknown>)[field] ?? null);
      const b = JSON.stringify((newNorm as unknown as Record<string, unknown>)[field] ?? null);
      if (a !== b) {
        console.log(`QUOTATION DIFF ${q.quotationNumber}.${field}: ${a} -> ${b}`);
        mismatches += 1;
      }
    }

    const oldRooms = (oldNorm.rooms ?? []) as Array<{ items?: Array<Record<string, unknown>> }>;
    const newRooms = (newNorm.rooms ?? []) as Array<{ items?: Array<Record<string, unknown>> }>;

    for (let r = 0; r < Math.max(oldRooms.length, newRooms.length); r++) {
      const oldItems = oldRooms[r]?.items ?? [];
      const newItems = newRooms[r]?.items ?? [];
      for (let i = 0; i < Math.max(oldItems.length, newItems.length); i++) {
        itemsChecked += 1;
        const oldItem = oldItems[i] ?? {};
        const newItem = newItems[i] ?? {};

        for (const field of ITEM_PRICING_FIELDS) {
          const a = JSON.stringify(oldItem[field] ?? null);
          const b = JSON.stringify(newItem[field] ?? null);
          if (a !== b) {
            console.log(`ITEM PRICING DIFF ${q.quotationNumber} room${r} item${i}.${field}: ${a} -> ${b}`);
            mismatches += 1;
          }
        }

        const oldProduct = (oldItem.product ?? {}) as Record<string, unknown>;
        const newProduct = (newItem.product ?? {}) as Record<string, unknown>;
        for (const field of PRODUCT_FIELDS) {
          const a = JSON.stringify(oldProduct[field] ?? null);
          const b = JSON.stringify(newProduct[field] ?? null);
          if (a !== b) {
            console.log(`PRODUCT DIFF ${q.quotationNumber} room${r} item${i}.product.${field}: ${a} -> ${b}`);
            mismatches += 1;
          }
        }

        const oldVariant = (oldItem.productVariant ?? null) as Record<string, unknown> | null;
        const newVariant = (newItem.productVariant ?? null) as Record<string, unknown> | null;
        if ((oldVariant === null) !== (newVariant === null)) {
          console.log(`VARIANT NULLABILITY DIFF ${q.quotationNumber} room${r} item${i}: old=${oldVariant === null} new=${newVariant === null}`);
          mismatches += 1;
        } else if (oldVariant && newVariant) {
          for (const field of VARIANT_FIELDS) {
            const a = JSON.stringify(oldVariant[field] ?? null);
            const b = JSON.stringify(newVariant[field] ?? null);
            if (a !== b) {
              console.log(`VARIANT DIFF ${q.quotationNumber} room${r} item${i}.productVariant.${field}: ${a} -> ${b}`);
              mismatches += 1;
            }
          }
        }
      }
    }
  }

  console.log(`\nChecked ${all.length} quotations, ${itemsChecked} item-slots.`);
  console.log(`Total OLD payload: ${totalPayloadOld} bytes (${(totalPayloadOld / 1024).toFixed(1)} KB)`);
  console.log(`Total NEW payload: ${totalPayloadNew} bytes (${(totalPayloadNew / 1024).toFixed(1)} KB)`);
  console.log(`Reduction: ${(100 - (totalPayloadNew / totalPayloadOld) * 100).toFixed(1)}%`);
  console.log(mismatches === 0 ? "PARITY OK: 0 mismatches." : `PARITY FAILED: ${mismatches} mismatches.`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-item-payload-slimming failed:", error);
  process.exit(1);
});
