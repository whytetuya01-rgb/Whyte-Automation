import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import { Quotation } from "../../src/models";
import { aggregateQuotationRoomTotals } from "../../src/lib/quotationTotals";

async function timeIt(label: string, fn: () => Promise<unknown>, runs = 5): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1e6);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`${label}: avg ${avg.toFixed(1)}ms over ${runs} runs [${samples.map((s) => s.toFixed(1)).join(", ")}]`);
}

async function main() {
  await connectMongoDB();

  await timeIt("OLD: find().populate(rooms->items).lean() [admin, all quotations]", async () => {
    await Quotation.find({})
      .populate({ path: "rooms", populate: { path: "items", select: "quantity unitPrice" } })
      .lean({ virtuals: true });
  });

  await timeIt("NEW: find().select(light).lean() + aggregateQuotationRoomTotals", async () => {
    const docs = await Quotation.find({}).select("_id status discountType discountValue").lean();
    const ids = docs.map((d) => String(d._id));
    await aggregateQuotationRoomTotals(ids);
  });

  process.exit(0);
}

main().catch((error) => {
  console.error("benchmark failed:", error);
  process.exit(1);
});
