const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch (e) {}
const mongoose = require("mongoose");

async function checkRetroSeries() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const cat4Products = await db.collection("products").find({ categoryId: 4 }).toArray();
  console.log(`Products in category 4 (Retro Series): ${cat4Products.length}`);
  if (cat4Products.length > 0) {
    console.log("Sample:", cat4Products.slice(0, 3).map(p => ({ id: p._id, name: p.name, type: p.type })));
  }
  await mongoose.disconnect();
}
checkRetroSeries().catch(console.error);
