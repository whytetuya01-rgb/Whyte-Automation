/**
 * READ-ONLY audit dump: lists every Product with the fields needed to match
 * it against the new "Color Edge" image ZIP. Makes NO writes whatsoever.
 *
 *   node scripts/run-script.js scripts/audit/dump-products.ts
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { Product, Category } from "../../src/models";

async function main() {
  await connectMongoDB();

  const products = await Product.find().sort({ _id: 1 }).lean();
  const categories = await Category.find().lean();
  const categoryById = new Map<number, string>(categories.map((c: any) => [c._id, c.name]));

  const rows = products.map((p: any) => ({
    id: p._id,
    name: p.name,
    code: p.code,
    type: p.type,
    categoryId: p.categoryId,
    categoryName: p.categoryId != null ? categoryById.get(p.categoryId) ?? null : null,
    moduleSize: p.moduleSize,
    automationTier: p.automationTier,
    surfaceFinish: p.surfaceFinish,
    isActive: p.isActive,
    isMatrix: p.isMatrix,
    imageUrl: p.imageUrl,
    imagePublicId: p.imagePublicId,
    notes: p.notes,
  }));

  const outDir = path.resolve(process.cwd(), "scripts/audit");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "all-products-dump.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");

  console.log(`Total products: ${rows.length}`);
  console.log(`Dumped to: ${outPath}`);

  const colorEdge = rows.filter((r) => /color\s*edge/i.test(r.name || "") || /color\s*edge/i.test(r.code || ""));
  console.log(`\nProducts whose name/code mentions "Color Edge": ${colorEdge.length}`);
  colorEdge.slice(0, 10).forEach((r) => console.log(`  #${r.id} ${r.name} | code=${r.code} | module=${r.moduleSize} | img=${r.imageUrl}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Audit dump crashed:", err);
  process.exit(1);
});
