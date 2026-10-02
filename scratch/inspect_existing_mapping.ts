import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Product, Category } from "../src/models";

async function inspectCategoryMapping() {
  await connectMongoDB();
  const prods = await Product.find().lean();
  const cats = await Category.find().lean();
  const catMap = new Map(cats.map(c => [c._id, c.name]));

  const summary: Record<string, { total: number, catDistribution: Record<string, number> }> = {};

  for (const p of prods) {
    // p.notes usually contains "Catalog: Tactus_X" or similar
    const note = p.notes || "NoNotes";
    const family = note.split('_')[0].replace("Catalog: ", "").trim();
    if (!summary[family]) {
      summary[family] = { total: 0, catDistribution: {} };
    }
    summary[family].total++;
    const catName = catMap.get(p.categoryId as number) || `Unknown (${p.categoryId})`;
    summary[family].catDistribution[catName] = (summary[family].catDistribution[catName] || 0) + 1;
  }

  console.log("Current DB Products Catalog Family -> Category distribution:");
  console.log(JSON.stringify(summary, null, 2));

  // Also check product types distribution
  const typeSummary: Record<string, number> = {};
  for (const p of prods) {
    typeSummary[p.type] = (typeSummary[p.type] || 0) + 1;
  }
  console.log("\nCurrent DB Product Types:", typeSummary);

  await mongoose.disconnect();
}
inspectCategoryMapping();
