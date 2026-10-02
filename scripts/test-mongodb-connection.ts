import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";

async function testConnection() {
  console.log("=== Testing MongoDB Connection ===");
  console.log(`MONGODB_URI configured: ${process.env.MONGODB_URI ? "YES" : "NO"}`);
  console.log(`Target URI: ${process.env.MONGODB_URI}`);

  try {
    const startTime = Date.now();
    await connectMongoDB();
    const elapsed = Date.now() - startTime;

    console.log(`\nConnection established successfully in ${elapsed}ms!`);
    console.log(`Mongoose readyState: ${mongoose.connection.readyState} (1 = connected)`);
    console.log(`Database name: ${mongoose.connection.name}`);
    console.log(`Host: ${mongoose.connection.host}`);
    console.log(`Port: ${mongoose.connection.port}`);

    // Test a basic ping command on admin database to verify active communication
    const adminDb = mongoose.connection.db?.admin();
    if (adminDb) {
      const pingResult = await adminDb.ping();
      console.log(`Ping result:`, pingResult);
    }

    console.log("\n[SUCCESS] MongoDB connection test passed without errors.");
  } catch (error) {
    console.error("\n[FAILED] MongoDB connection test failed:", error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("Mongoose connection closed cleanly.");
    }
  }
}

testConnection();
