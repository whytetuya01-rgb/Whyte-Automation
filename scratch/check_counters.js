const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch (e) {}
const mongoose = require("mongoose");

async function checkCounters() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const counters = await db.collection("counters").find({}).toArray();
  console.log("Counters:", counters);
  await mongoose.disconnect();
}
checkCounters().catch(console.error);
