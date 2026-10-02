import mongoose, { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";

let isTransactionSupported: boolean | null = null;

/**
 * Checks whether the connected MongoDB topology supports multi-document transactions (ReplicaSet / Mongos).
 */
export async function checkTransactionSupport(): Promise<boolean> {
  if (isTransactionSupported !== null) {
    return isTransactionSupported;
  }

  await connectMongoDB();
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) {
      isTransactionSupported = false;
      return false;
    }
    const helloResult = await admin.command({ hello: 1 });
    // MongoDB supports transactions only if setName (replica set) or msg === 'isdbgrid' (mongos) is present
    isTransactionSupported = Boolean(helloResult.setName || helloResult.msg === "isdbgrid");
    return isTransactionSupported;
  } catch {
    isTransactionSupported = false;
    return false;
  }
}

/**
 * Runs a transactional operation. If MongoDB supports multi-document transactions (ReplicaSet),
 * uses Mongoose ClientSession with withTransaction(). If running on standalone MongoDB,
 * executes directly.
 */
export async function withTransaction<T>(
  operation: (session?: ClientSession) => Promise<T>
): Promise<T> {
  await connectMongoDB();
  const supported = await checkTransactionSupport();

  if (supported) {
    const session = await mongoose.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await operation(session);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }

  // Standalone MongoDB fallback
  return await operation();
}
