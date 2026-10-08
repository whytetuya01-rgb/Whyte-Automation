import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation, serializeQuotationForClient } from "../../src/lib/quotationNormalization";
import { attachQuotationActors } from "../../src/lib/quotationActors";

/** READ-ONLY. Same measurement as measure-quotation-payload.ts, but against the NEW slim populate. */
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

async function main() {
  await connectMongoDB();
  const quotationId = process.argv[3];
  if (!quotationId) throw new Error("usage: measure-quotation-payload-after.ts <quotationId>");

  const samples: number[] = [];
  let doc;
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint();
    doc = await fetchNew(quotationId);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  if (!doc) throw new Error("quotation not found");

  const [withActors] = await attachQuotationActors([doc]);
  const normalized = normalizeQuotation(JSON.parse(JSON.stringify(withActors)));
  const serialized = serializeQuotationForClient(normalized);
  const json = JSON.stringify(serialized);

  console.log(`NEW query times: [${samples.map((s) => s.toFixed(1)).join(", ")}] ms`);
  console.log(`NEW serialized payload size: ${json.length} bytes (${(json.length / 1024).toFixed(1)} KB)`);
  process.exit(0);
}

main().catch((error) => {
  console.error("measure-quotation-payload-after failed:", error);
  process.exit(1);
});
