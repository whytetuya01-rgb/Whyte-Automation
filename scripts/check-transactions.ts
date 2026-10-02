import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";

async function checkTransactionSupport() {
  await connectMongoDB();
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    console.log("[TRANSACTIONS] MongoDB transaction started successfully! (ReplicaSet or ShardedCluster)");
    await session.abortTransaction();
    console.log("[TRANSACTIONS] Supported: YES");
  } catch (error: any) {
    console.log("[TRANSACTIONS] Transaction failed:", error.message);
    console.log("[TRANSACTIONS] Supported: NO (Standalone MongoDB instance)");
  } finally {
    session.endSession();
    await mongoose.disconnect();
  }
}

checkTransactionSupport().catch(console.error);
