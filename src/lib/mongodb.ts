import mongoose from "mongoose";
import dns from "dns";

// ─────────────────────────────────────────────────────────────────────────────
// DNS: SRV resolution for mongodb+srv
//
// On this machine, the local resolver (127.0.0.1) REFUSES the
// `_mongodb._tcp.<cluster>.mongodb.net` SRV query, so `mongoose.connect` on a
// mongodb+srv URI fails immediately with:
//
//     querySrv ECONNREFUSED _mongodb._tcp.cluster0.yvhpxeg.mongodb.net
//
// Pointing the resolver at public DNS is what makes Atlas reachable here, so
// this stays ON by default — do not remove it without testing the connection.
// It overrides the process-wide DNS resolver, which is a machine-level
// workaround, not something every deployment needs or wants; set
// DISABLE_PUBLIC_DNS_OVERRIDE=true (e.g. in a hosting environment with its
// own working resolver) to turn it off without touching this file again.
// ─────────────────────────────────────────────────────────────────────────────
const PUBLIC_DNS_SERVERS = ["8.8.8.8", "8.8.4.4", "1.1.1.1"];

function applyPublicDnsServers(): void {
  if (process.env.DISABLE_PUBLIC_DNS_OVERRIDE === "true") return;
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
  lastFailureTime?: number;
  lastFailureError?: Error | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? {
  conn: null,
  promise: null,
  lastFailureTime: 0,
  lastFailureError: null,
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
 * Configured with 4,000ms server selection timeout and 2 attempts with backoff.
 * This accommodates Atlas SRV resolution (15-400ms) and replica-set primary
 * election (2-3s) while bounding total worst-case outage stalls to ~8.3s
 * instead of 31.5s+ cascading delays.
 */
async function connectWithRetry(uri: string): Promise<typeof mongoose> {
  const maxAttempts = 2;
  const baseDelayMs = 300;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await mongoose.connect(uri, {
        // Never queue operations while disconnected: fail fast and loudly so a
        // broken connection surfaces as an error instead of a silent hang.
        bufferCommands: false,
        serverSelectionTimeoutMS: 4_000,
        connectTimeoutMS: 4_000,
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
let lastConnectDurationMs = 0;

export function getLastDbConnectDurationMs(): number {
  return lastConnectDurationMs;
}

export async function connectMongoDB(): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("Please define the MONGODB_URI environment variable inside .env");
  }

  // 1. Re-use healthy open connection
  if (cached.conn) {
    const state = cached.conn.connection.readyState;
    if (state === 1) return cached.conn;
    if (state === 0) {
      // 0 === disconnected: drop the cached handle so a fresh attempt is made.
      cached.conn = null;
      cached.promise = null;
    } else if (state === 2 && cached.promise) {
      // 2 === connecting: await in-flight connection promise rather than returning unready handle
      return await cached.promise;
    }
  }

  // 2. Failure cooldown check: if an attempt recently failed, fail fast
  // to prevent 63-67s double-retry cascades within a single request
  const now = performance.now();
  const FAILURE_COOLDOWN_MS = 1500;
  if (
    cached.lastFailureTime &&
    now - cached.lastFailureTime < FAILURE_COOLDOWN_MS &&
    cached.lastFailureError
  ) {
    throw cached.lastFailureError;
  }

  const isFirstCall = !cached.promise;
  const start = performance.now();

  // 3. Concurrent callers share one in-flight attempt.
  if (!cached.promise) {
    cached.promise = connectWithRetry(MONGODB_URI);
  }

  try {
    cached.conn = await cached.promise;
    cached.lastFailureTime = 0;
    cached.lastFailureError = null;
    lastConnectDurationMs = Number((performance.now() - start).toFixed(2));
    if (isFirstCall) {
      const isAtlas = MONGODB_URI.includes("mongodb+srv") || MONGODB_URI.includes("mongodb.net");
      console.log(`[PERF:DB] MongoDB initial connection established in ${lastConnectDurationMs} ms (${isAtlas ? "Atlas Cloud" : "Local Database"})`);
    }
  } catch (error) {
    // Record failure time for cooldown to prevent cascading loops
    cached.lastFailureTime = performance.now();
    cached.lastFailureError = error instanceof Error ? error : new Error(String(error));
    cached.promise = null;
    lastConnectDurationMs = Number((performance.now() - start).toFixed(2));
    console.error(`[PERF:DB] MongoDB connection FAILED after ${lastConnectDurationMs} ms:`, (error as Error)?.message);
    throw error;
  }

  return cached.conn;
}

export default connectMongoDB;
