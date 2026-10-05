import mongoose from "mongoose";
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);
import { filterProductCatalog } from "@/lib/productFiltering";
import { Product } from "@/types";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const prods = await db.collection("products").find({}).toArray();
  const vars = await db.collection("productvariants").find({}).toArray();
  const products: Product[] = prods.map((p) => ({
    ...p,
    id: Number(p._id),
    variants: vars
      .filter((v) => Number(v.productId) === Number(p._id))
      .map((v) => ({ ...v, id: Number(v._id), price: String(v.price) })),
  })) as any;

  console.log("Total DB products loaded:", products.length);

  // Scenario 1: Tactus + Remote Control + Acrylic Panel
  const res1 = filterProductCatalog(products, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "acrylic",
  });
  console.log("Matching in Tactus + Remote + Acrylic:", res1.length);
  for (const r of res1) {
    for (const v of r.eligibleVariants) {
      if (v.automationTier !== "remote" || v.surfaceFinish !== "acrylic") {
        throw new Error(`Invalid variant found in product ${r.product.id}: ${JSON.stringify(v)}`);
      }
    }
  }
  console.log("✓ All eligible variants in Tactus + Remote + Acrylic are strictly remote & acrylic!");

  // Scenario 2: Tactus + Remote Control + Glass Panel
  const res2 = filterProductCatalog(products, {
    categoryId: 1,
    automationTier: "remote",
    surfaceFinish: "glass",
  });
  console.log("Matching in Tactus + Remote + Glass:", res2.length);
  for (const r of res2) {
    for (const v of r.eligibleVariants) {
      if (v.automationTier !== "remote" || v.surfaceFinish !== "glass") {
        throw new Error(`Invalid variant found in product ${r.product.id}: ${JSON.stringify(v)}`);
      }
    }
  }
  console.log("✓ All eligible variants in Tactus + Remote + Glass are strictly remote & glass!");

  // Check that acrylic-only products (like 160) are excluded from glass filter
  const prod160InGlass = res2.find((r) => r.product.id === 160);
  if (prod160InGlass) {
    throw new Error("Product 160 (acrylic only) should NOT be present in Glass filter!");
  }
  console.log("✓ Acrylic-only products correctly excluded when Glass is selected!");

  // Check that product 330 (which has no remote variant) is excluded from remote filter
  const prod330InRemote = res1.find((r) => r.product.id === 330);
  if (prod330InRemote) {
    throw new Error("Product 330 (no remote variant) should NOT be present in Remote filter!");
  }
  console.log("✓ Product 330 (no remote variants) correctly excluded when Remote is selected!");

  await mongoose.disconnect();
  console.log("\n>>> All real database product filtering checks passed cleanly! <<<\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
