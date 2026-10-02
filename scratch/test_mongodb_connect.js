const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("ts-node").register({ compilerOptions: { module: "CommonJS" } });
require("tsconfig-paths").register({
  baseUrl: path.resolve(__dirname, ".."),
  paths: { "@/*": ["src/*"] },
});

const { connectMongoDB } = require("../src/lib/mongodb");

async function testConn() {
  console.log("Connecting via src/lib/mongodb...");
  const mongoose = await connectMongoDB();
  console.log("Connected successfully! ReadyState:", mongoose.connection.readyState);
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log("Collections:", collections.map(c => c.name));
  await mongoose.disconnect();
  console.log("Disconnected.");
}

testConn().catch(err => {
  console.error("Connection failed:", err);
  process.exit(1);
});
