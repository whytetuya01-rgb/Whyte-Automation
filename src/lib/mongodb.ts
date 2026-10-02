import mongoose from "mongoose";
import dns from "dns";

// ─────────────────────────────────────────────────────────────────────────────
// DNS: SRV resolution for mongodb+srv
//
// This machine's resolver is a local one (127.0.0.1) that REFUSES the
// `_mongodb._tcp.<cluster>.mongodb.net` SRV query, so `mongoose.connect` on a
// mongodb+srv URI fails immediately with:
//
//     querySrv ECONNREFUSED _mongodb._tcp.cluster0.yvhpxeg.mongodb.net
//
// Pointing the resolver at public DNS is what makes Atlas reachable here, so
// this is load-bearing — do not remove it without testing the connection.
// ─────────────────────────────────────────────────────────────────────────────
const PUBLIC_DNS_SERVERS = ["8.8.8.8", "8.8.4.4", "1.1.1.1"];

function applyPublicDnsServers(): void {
  try {
    dns.setServers(PUBLIC_DNS_SERVERS);
  } catch {
    // Ignore if restricted in specific environments. The connect retry below
    // still reports a useful error if the system resolver cannot answer.
  }
}

applyPublicDnsServers();

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? {
  conn: null,
  promise: null,
};

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

/** Errors worth retrying: DNS/SRV hiccups, replica-set election, network blips. */
const RETRYABLE_CODE_PATTERN =
  /^(querySrv )?(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)$/i;
const RETRYABLE_NAMES = new Set([
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
]);

function isRetryableConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { name?: string; code?: string; message?: string };
  const name = String(err.name ?? "");
  const code = String(err.code ?? "");
  const message = String(err.message ?? "");

  if (RETRYABLE_NAMES.has(name)) return true;
  if (RETRYABLE_CODE_PATTERN.test(code)) return true;
  // querySrv failures surface the code inside the message text.
  return /\bquerySrv\b/i.test(message) && RETRYABLE_CODE_PATTERN.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects with a bounded retry.
 *
 * Without this, one transient DNS/SRV or replica-set hiccup failed the very
 * first request with a hard 500 while every later request succeeded, because
 * the failed promise was discarded and the next call retried from scratch.
 */
async function connectWithRetry(uri: string): Promise<typeof mongoose> {
  const maxAttempts = 3;
  const baseDelayMs = 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await mongoose.connect(uri, {
        // Never queue operations while disconnected: fail fast and loudly so a
        // broken connection surfaces as an error instead of a silent hang.
        bufferCommands: false,
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      });
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !isRetryableConnectionError(error)) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[mongodb] connection attempt ${attempt}/${maxAttempts} failed ` +
          `(${(error as Error)?.name}: ${(error as Error)?.message}). ` +
          `Retrying in ${delay}ms.`
      );
      await sleep(delay);

      // A later attempt may need working DNS again.
      applyPublicDnsServers();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to connect to MongoDB.");
}

/**
 * Global MongoDB connection utility using Mongoose.
 * Caches the connection across hot reloads in Next.js development mode.
 */
export async function connectMongoDB(): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("Please define the MONGODB_URI environment variable inside .env");
  }

  // An already-open connection is reused, unless it went stale.
  if (cached.conn) {
    const state = cached.conn.connection.readyState;
    if (state === 1) return cached.conn;
    if (state === 0) {
      // 0 === disconnected: drop the cached handle so a fresh attempt is made.
      cached.conn = null;
      cached.promise = null;
    } else {
      // 1 === connected, 2 === connecting, 3 === disconnecting
      return cached.conn;
    }
  }

  // Concurrent callers share one in-flight attempt.
  if (!cached.promise) {
    cached.promise = connectWithRetry(MONGODB_URI);
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Do not cache a failed attempt: the next caller must be able to retry.
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}

export default connectMongoDB;
