const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
} catch (e) {}

const mongoose = require("mongoose");

async function checkAllCollections() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log("Checking all collections for categoryId: 5 or 'retrofit'...");
  for (const col of collections) {
    const name = col.name;
    const docs = await db.collection(name).find({}).toArray();
    let cat5Count = 0;
    let retrofitTextCount = 0;

    for (const doc of docs) {
      const str = JSON.stringify(doc).toLowerCase();
      if (doc.categoryId === 5 || doc.category_id === 5) {
        cat5Count++;
      }
      if (str.includes("retrofit")) {
        retrofitTextCount++;
      }
    }

    if (cat5Count > 0 || retrofitTextCount > 0) {
      console.log(`Collection [${name}]: total=${docs.length}, categoryId=5: ${cat5Count}, has 'retrofit': ${retrofitTextCount}`);
    } else {
      console.log(`Collection [${name}]: total=${docs.length}, no references found.`);
    }
  }

  await mongoose.disconnect();
}

checkAllCollections().catch(console.error);
