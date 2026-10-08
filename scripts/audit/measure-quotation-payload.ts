import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation, serializeQuotationForClient } from "../../src/lib/quotationNormalization";
import { attachQuotationActors } from "../../src/lib/quotationActors";

/**
 * READ-ONLY. Measures the OLD (current, full populate) quotation GET/editor
 * payload size for the quotation with the most rooms+items, and times the
 * query, as a baseline before Phase 3 Step 3.1 changes anything.
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

async function main() {
  await connectMongoDB();

  const candidates = await Quotation.find()
    .populate({ path: "rooms", select: "_id" })
    .lean();

  // Rank by total item count (need another pass since items aren't populated above)
  const withCounts = await Promise.all(
    candidates.map(async (q) => {
      const rooms = await Quotation.db
        .collection("quotationrooms")
        .find({ quotationId: String(q._id) })
        .toArray();
      const roomIds = rooms.map((r) => r._id);
      const itemCount = await Quotation.db.collection("quotationitems").countDocuments({ quotationRoomId: { $in: roomIds } });
      return { id: String(q._id), quotationNumber: q.quotationNumber, roomCount: rooms.length, itemCount };
    })
  );
  withCounts.sort((a, b) => b.itemCount - a.itemCount);
  const top = withCounts[0];
  console.log(`Richest quotation: ${top.quotationNumber} (${top.id}) — ${top.roomCount} rooms, ${top.itemCount} items`);

  const start = process.hrtime.bigint();
  const doc = await fetchOld(top.id);
  const queryMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (!doc) throw new Error("quotation not found");

  const [withActors] = await attachQuotationActors([doc]);
  const normalized = normalizeQuotation(JSON.parse(JSON.stringify(withActors)));
  const serialized = serializeQuotationForClient(normalized);

  const json = JSON.stringify(serialized);
  console.log(`OLD query time: ${queryMs.toFixed(1)}ms`);
  console.log(`OLD serialized payload size: ${json.length} bytes (${(json.length / 1024).toFixed(1)} KB)`);

  process.exit(0);
}

main().catch((error) => {
  console.error("measure-quotation-payload failed:", error);
  process.exit(1);
});
