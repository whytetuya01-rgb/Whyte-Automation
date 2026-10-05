const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
} catch (e) {}

const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("No MONGODB_URI found in .env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log("Connected successfully!");

  const db = mongoose.connection.db;

  // 1. Check categories
  console.log("\n--- CATEGORIES ---");
  const allCategories = await db.collection("categories").find({}).toArray();
  console.log(`Total categories in DB: ${allCategories.length}`);
  allCategories.forEach(c => {
    console.log(`ID: ${c._id} | Name: "${c.name}" | Level: ${c.level} | ParentId: ${c.parentId} | Active: ${c.isActive}`);
  });

  const retrofitCategories = allCategories.filter(c => 
    c.name.toLowerCase().includes("retrofit")
  );
  console.log("\nMatching Retrofit Categories:", JSON.stringify(retrofitCategories, null, 2));

  const retrofitCatIds = retrofitCategories.map(c => c._id);

  // 2. Check Products
  console.log("\n--- PRODUCTS ---");
  const retrofitProducts = await db.collection("products").find({
    $or: [
      { categoryId: { $in: retrofitCatIds } },
      { type: "retrofit" },
      { name: { $regex: /retrofit/i } }
    ]
  }).toArray();
  console.log(`Matching Retrofit Products: ${retrofitProducts.length}`);
  retrofitProducts.forEach(p => {
    console.log(`Product ID: ${p._id} | Name: "${p.name}" | Code: "${p.code}" | Type: "${p.type}" | CategoryId: ${p.categoryId} | Active: ${p.isActive}`);
  });

  const retrofitProductIds = retrofitProducts.map(p => p._id);

  // 3. Check Product Variants
  console.log("\n--- PRODUCT VARIANTS ---");
  const retrofitVariants = await db.collection("productvariants").find({
    productId: { $in: retrofitProductIds }
  }).toArray();
  console.log(`Matching Product Variants: ${retrofitVariants.length}`);
  retrofitVariants.forEach(v => {
    console.log(`Variant ID: ${v._id} | ProductId: ${v.productId} | Code: "${v.variantCode || v.code}" | Tier: "${v.automationTier}" | Finish: "${v.surfaceFinish}" | Price: ${v.price}`);
  });

  const retrofitVariantIds = retrofitVariants.map(v => v._id);

  // 4. Check Quotation Items / Quotations
  console.log("\n--- QUOTATION ITEMS & QUOTATIONS ---");
  const quotationItemsByProd = await db.collection("quotationitems").find({
    $or: [
      { productId: { $in: retrofitProductIds } },
      { variantId: { $in: retrofitVariantIds } }
    ]
  }).toArray();
  console.log(`Quotation items referencing retrofit products/variants: ${quotationItemsByProd.length}`);
  quotationItemsByProd.forEach(qi => {
    console.log(`QuotationItem ID: ${qi._id} | QuotationId: ${qi.quotationId} | ProductId: ${qi.productId} | VariantId: ${qi.variantId} | Desc: "${qi.description || qi.productName}"`);
  });

  // Also check if any quotations directly embed retrofit products or types
  const quotations = await db.collection("quotations").find({}).toArray();
  console.log(`Total quotations in DB: ${quotations.length}`);
  let quotationsReferencing = 0;
  for (const q of quotations) {
    const qStr = JSON.stringify(q);
    if (qStr.toLowerCase().includes("retrofit")) {
      quotationsReferencing++;
      console.log(`Quotation ID: ${q._id} / ${q.quotationNumber} contains "retrofit" in data!`);
    }
  }
  console.log(`Quotations containing text "retrofit": ${quotationsReferencing}`);

  await mongoose.disconnect();
  console.log("\nDisconnected from MongoDB.");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
