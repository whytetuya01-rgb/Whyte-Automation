const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch (e) {}
const mongoose = require("mongoose");

async function removeRetrofitCategory() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const targetId = 5;
  const targetCategory = await db.collection("categories").findOne({ _id: targetId });

  if (!targetCategory) {
    console.log(`Category ID ${targetId} not found in database. Already removed?`);
    await mongoose.disconnect();
    return;
  }

  console.log("Found Target Category to Remove:");
  console.log(JSON.stringify(targetCategory, null, 2));

  if (!targetCategory.name.toLowerCase().includes("retrofit")) {
    throw new Error(`Safety check failed: Category ID ${targetId} name is "${targetCategory.name}", not Retrofit!`);
  }

  // 1. Dependency checks
  const childCategories = await db.collection("categories").countDocuments({ parentId: targetId });
  const categoryProducts = await db.collection("products").countDocuments({ categoryId: targetId });
  const retrofitTypeProducts = await db.collection("products").countDocuments({ type: "retrofit" });
  
  console.log("\nDependency Audit Results:");
  console.log(`- Child categories with parentId=${targetId}: ${childCategories}`);
  console.log(`- Products assigned to categoryId=${targetId}: ${categoryProducts}`);
  console.log(`- Products with type="retrofit": ${retrofitTypeProducts}`);

  if (childCategories > 0 || categoryProducts > 0 || retrofitTypeProducts > 0) {
    throw new Error("Safety check failed: Active dependencies found for Retrofit Modules! Aborting deletion.");
  }

  // 2. Perform safe deletion of the category document only
  console.log(`\nDeleting category record ID ${targetId} ("${targetCategory.name}")...`);
  const deleteResult = await db.collection("categories").deleteOne({ _id: targetId });
  console.log(`Delete result: acknowledged=${deleteResult.acknowledged}, deletedCount=${deleteResult.deletedCount}`);

  if (deleteResult.deletedCount !== 1) {
    throw new Error(`Failed to delete category ${targetId}! deletedCount: ${deleteResult.deletedCount}`);
  }

  // 3. Verify post-deletion state
  const remainingCategories = await db.collection("categories").find({}).sort({ _id: 1 }).toArray();
  console.log(`\nRemaining categories in DB (${remainingCategories.length}):`);
  remainingCategories.forEach(c => {
    console.log(`  ID: ${c._id} | Name: "${c.name}" | Level: ${c.level} | SortOrder: ${c.sortOrder}`);
  });

  const checkDeleted = await db.collection("categories").findOne({ _id: targetId });
  console.log(`\nVerification: Category ${targetId} exists in DB: ${checkDeleted !== null}`);

  await mongoose.disconnect();
  console.log("\nDatabase operation completed safely and cleanly.");
}

removeRetrofitCategory().catch(err => {
  console.error("Error executing removal:", err);
  process.exit(1);
});
