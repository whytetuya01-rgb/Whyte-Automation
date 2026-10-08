import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { normalizeQuotation, serializeQuotationForClient } from "../../src/lib/quotationNormalization";
import { attachQuotationActors } from "../../src/lib/quotationActors";

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
  const quotationId = process.argv[3];
  if (!quotationId) throw new Error("usage: measure-quotation-payload-before.ts <quotationId>");

  const samples: number[] = [];
  let doc;
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint();
    doc = await fetchOld(quotationId);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  if (!doc) throw new Error("quotation not found");

  const [withActors] = await attachQuotationActors([doc]);
  const normalized = normalizeQuotation(JSON.parse(JSON.stringify(withActors)));
  const serialized = serializeQuotationForClient(normalized);
  const json = JSON.stringify(serialized);

  console.log(`OLD query times: [${samples.map((s) => s.toFixed(1)).join(", ")}] ms`);
  console.log(`OLD serialized payload size: ${json.length} bytes (${(json.length / 1024).toFixed(1)} KB)`);
  process.exit(0);
}

main().catch((error) => {
  console.error("measure-quotation-payload-before failed:", error);
  process.exit(1);
});
