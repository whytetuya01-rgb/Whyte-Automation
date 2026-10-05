const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch (e) {}
const mongoose = require("mongoose");

async function checkProductGroups() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const byCat = await db.collection("products").aggregate([
    { $group: { _id: "$categoryId", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Products by categoryId:", byCat);

  const byType = await db.collection("products").aggregate([
    { $group: { _id: "$type", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Products by type:", byType);

  await mongoose.disconnect();
}
checkProductGroups().catch(console.error);
