import mongoose, { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { ApiError } from "@/lib/api-response";

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

// ── writes that must be all-or-nothing ───────────────────────────────────────────────────────────────────────────────

/** True where a change that must be all-or-nothing may NOT quietly run as separate writes. */
export function transactionsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

const RECHECK_UNSUPPORTED_AFTER_MS = 15_000;
let supportedNow: boolean | null = null;
let uncheckedUntil = 0;
let warnedWithoutTransactions = false;

/**
 * Whether the connected MongoDB can run transactions. A "yes" is remembered; a "no" is looked at again after a few seconds,
 * so one failed check (a network blip while asking) does not block follow-up changes until the server restarts.
 */
async function transactionsSupportedNow(): Promise<boolean> {
  if (supportedNow === true) return true;
  if (supportedNow === false && Date.now() < uncheckedUntil) return false;
  try {
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    supportedNow = Boolean(hello && (hello.setName || hello.msg === "isdbgrid"));
  } catch {
    supportedNow = false;
  }
  if (!supportedNow) uncheckedUntil = Date.now() + RECHECK_UNSUPPORTED_AFTER_MS;
  return supportedNow;
}

/** For tests: forget what was learned about the database. */
export function resetTransactionSupportForTests(): void {
  supportedNow = null;
  uncheckedUntil = 0;
  warnedWithoutTransactions = false;
}

/**
 * Runs `operation` as one transaction, for changes that are only correct if ALL of their writes happen or NONE do
 * (a follow-up and its task, owner and timeline entry).
 *
 *  - Production: a database without transactions makes this fail safely with a clear 503, changing nothing. It never
 *    quietly falls back to separate writes.
 *  - Development and tests: a database without transactions (a plain local mongod) still works, but says so loudly once,
 *    so nobody mistakes it for the real thing.
 */
export async function withRequiredTransaction<T>(operation: (session?: ClientSession) => Promise<T>): Promise<T> {
  await connectMongoDB();
  if (!(await transactionsSupportedNow())) {
    if (transactionsRequired()) {
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "This change must be saved all at once, and the database does not support that (it needs a MongoDB replica set). Nothing was changed. Please contact your administrator.",
        { details: { reason: "TRANSACTIONS_UNAVAILABLE" } }
      );
    }
    if (!warnedWithoutTransactions) {
      warnedWithoutTransactions = true;
      console.warn("[transactions] This MongoDB has no transaction support: follow-up changes are saved as separate writes. This is allowed outside production only; production refuses to run this way.");
    }
    return await operation();
  }

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
