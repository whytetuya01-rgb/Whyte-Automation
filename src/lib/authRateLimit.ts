import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AuthRateLimit } from "@/models/AuthRateLimit";

/**
 * Pre-computed valid bcrypt hash used for constant-time dummy comparisons
 * when a user account does not exist or is inactive.
 * Eliminates user-enumeration timing attacks.
 */
export const DUMMY_PASSWORD_HASH =
  "$2b$10$X0dZAK7LFELeC0yLedFw0uT3uToJ/GEKkr7XNqOCUdwyKeSrbCc1W";

/** Maximum failed attempts per account before progressive throttle (15 minutes). */
export const MAX_ACCOUNT_FAILURES = 5;
export const ACCOUNT_THROTTLE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Maximum failed attempts per IP before IP-wide throttle (15 minutes). */
export const MAX_IP_FAILURES = 25;
export const IP_THROTTLE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** MongoDB TTL retention period (2 hours). MongoDB cleans up expired records automatically. */
const RECORD_TTL_MS = 2 * 60 * 60 * 1000;

export interface RateCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: "ACCOUNT_THROTTLED" | "IP_THROTTLED";
  failures?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Fallback Cache (used when MongoDB is unavailable or in isolated tests)
// ─────────────────────────────────────────────────────────────────────────────
interface MemoryRateRecord {
  failures: number;
  firstFailureAt: number;
  lastFailureAt: number;
  blockedUntil: number | null;
  expiresAt: number;
}

const memoryRateLimitCache = new Map<string, MemoryRateRecord>();
const MAX_MEMORY_CACHE_ENTRIES = 5000;

function cleanMemoryCache(): void {
  const now = Date.now();
  for (const [key, record] of memoryRateLimitCache.entries()) {
    if (record.expiresAt <= now) {
      memoryRateLimitCache.delete(key);
    }
  }

  // Bound memory usage during continuous attacks or database outages
  if (memoryRateLimitCache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const excess = memoryRateLimitCache.size - MAX_MEMORY_CACHE_ENTRIES;
    const iterator = memoryRateLimitCache.keys();
    for (let i = 0; i < excess; i++) {
      const nextKey = iterator.next().value;
      if (nextKey) memoryRateLimitCache.delete(nextKey);
    }
  }
}

/**
 * Extracts client IP from NextAuth internal request or standard HTTP headers.
 */
export function extractClientIpFromAuthRequest(req?: {
  headers?: Record<string, string | string[] | undefined> | Headers | any;
}): string {
  if (!req?.headers) return "127.0.0.1";

  try {
    let forwarded: string | null = null;
    let realIp: string | null = null;

    if (typeof (req.headers as any).get === "function") {
      forwarded = (req.headers as Headers).get("x-forwarded-for");
      realIp = (req.headers as Headers).get("x-real-ip");
    } else {
      const raw = req.headers as Record<string, string | string[] | undefined>;
      const f = raw["x-forwarded-for"] || raw["X-Forwarded-For"];
      forwarded = Array.isArray(f) ? f[0] : f ?? null;
      const r = raw["x-real-ip"] || raw["X-Real-IP"];
      realIp = Array.isArray(r) ? r[0] : r ?? null;
    }

    if (forwarded) {
      const first = String(forwarded).split(",")[0]?.trim();
      if (first) return first;
    }
    if (realIp) {
      return String(realIp).trim();
    }
  } catch {
    // Return loopback on parsing error
  }

  return "127.0.0.1";
}

export function maskEmail(email: string): string {
  if (!email || typeof email !== "string") return "[unknown]";
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return "[malformed-email]";
  const name = parts[0];
  const domain = parts[1];
  const maskedName =
    name.length <= 2
      ? `${name.charAt(0)}*`
      : `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}`;
  return `${maskedName}@${domain}`;
}

export function maskIp(ip: string): string {
  if (!ip || typeof ip !== "string") return "[unknown-ip]";
  const trimmed = ip.trim();
  // IPv4 masking: 192.168.1.50 -> 192.168.***.***
  if (trimmed.includes(".")) {
    const octets = trimmed.split(".");
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.***.***`;
    }
  }
  // IPv6 masking: 2001:db8::1 -> 2001:db8:****
  if (trimmed.includes(":")) {
    const segments = trimmed.split(":");
    return segments.slice(0, 2).join(":") + ":****";
  }
  return "[ip-hidden]";
}

export function logSecurityEvent(
  event: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGIN_RATE_LIMITED",
  details: {
    email?: string;
    ip?: string;
    portal?: string;
    reason?: string;
    retryAfterSeconds?: number;
    userId?: string | number;
    role?: string;
  }
): void {
  const timestamp = new Date().toISOString();
  const emailMasked = details.email ? maskEmail(details.email) : "n/a";
  const ipMasked = details.ip ? maskIp(details.ip) : "n/a";
  const portal = details.portal || "auth";
  const reason = details.reason ? ` reason=${details.reason}` : "";
  const retry = details.retryAfterSeconds !== undefined ? ` retryAfter=${details.retryAfterSeconds}s` : "";
  const actor = details.userId ? ` user=${details.userId} role=${details.role || "unknown"}` : "";

  console.warn(
    `[SECURITY_AUDIT] [${timestamp}] event=${event} portal=${portal} email=${emailMasked} ip=${ipMasked}${reason}${retry}${actor}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limit Engine (MongoDB Primary + Memory Fallback)
// ─────────────────────────────────────────────────────────────────────────────

function accountKey(email: string): string {
  return `account:${email.trim().toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `ip:${ip.trim().toLowerCase()}`;
}

/**
 * Checks whether an account or IP is currently throttled due to repeated failed login attempts.
 */
export async function checkLoginRateLimit(params: {
  email?: string;
  ip?: string;
}): Promise<RateCheckResult> {
  const now = Date.now();
  const keysToCheck: Array<{ key: string; type: "account" | "ip"; max: number }> = [];

  if (params.email) {
    keysToCheck.push({ key: accountKey(params.email), type: "account", max: MAX_ACCOUNT_FAILURES });
  }
  if (params.ip) {
    keysToCheck.push({ key: ipKey(params.ip), type: "ip", max: MAX_IP_FAILURES });
  }

  // Attempt database check first
  try {
    await connectMongoDB();
    const queryKeys = keysToCheck.map((k) => k.key);
    const records = await AuthRateLimit.find({ key: { $in: queryKeys } }).lean();
    const recordMap = new Map(records.map((r) => [r.key, r]));

    for (const item of keysToCheck) {
      const record = recordMap.get(item.key);
      if (!record) continue;

      // Check if explicitly blocked until a timestamp
      if (record.blockedUntil) {
        const blockedUntilMs = new Date(record.blockedUntil).getTime();
        if (blockedUntilMs > now) {
          const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntilMs - now) / 1000));
          return {
            allowed: false,
            retryAfterSeconds,
            reason: item.type === "account" ? "ACCOUNT_THROTTLED" : "IP_THROTTLED",
            failures: record.failures,
          };
        }
      }

      // Check if threshold reached
      if (record.failures >= item.max) {
        const lockoutDuration = item.type === "account" ? ACCOUNT_THROTTLE_WINDOW_MS : IP_THROTTLE_WINDOW_MS;
        const lastFailMs = new Date(record.lastFailureAt).getTime();
        const expiresMs = lastFailMs + lockoutDuration;
        if (expiresMs > now) {
          const retryAfterSeconds = Math.max(1, Math.ceil((expiresMs - now) / 1000));
          return {
            allowed: false,
            retryAfterSeconds,
            reason: item.type === "account" ? "ACCOUNT_THROTTLED" : "IP_THROTTLED",
            failures: record.failures,
          };
        }
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    // Database unavailable: use in-memory fallback
    cleanMemoryCache();
    for (const item of keysToCheck) {
      const record = memoryRateLimitCache.get(item.key);
      if (!record) continue;

      if (record.blockedUntil && record.blockedUntil > now) {
        const retryAfterSeconds = Math.max(1, Math.ceil((record.blockedUntil - now) / 1000));
        return {
          allowed: false,
          retryAfterSeconds,
          reason: item.type === "account" ? "ACCOUNT_THROTTLED" : "IP_THROTTLED",
          failures: record.failures,
        };
      }

      if (record.failures >= item.max) {
        const lockoutDuration = item.type === "account" ? ACCOUNT_THROTTLE_WINDOW_MS : IP_THROTTLE_WINDOW_MS;
        const expiresMs = record.lastFailureAt + lockoutDuration;
        if (expiresMs > now) {
          const retryAfterSeconds = Math.max(1, Math.ceil((expiresMs - now) / 1000));
          return {
            allowed: false,
            retryAfterSeconds,
            reason: item.type === "account" ? "ACCOUNT_THROTTLED" : "IP_THROTTLED",
            failures: record.failures,
          };
        }
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Atomically records a failed login attempt for the specified email and/or IP.
 * Enforces sliding window throttles when thresholds are reached.
 */
export async function recordFailedLoginAttempt(params: {
  email?: string;
  ip?: string;
}): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();
  const operations: Array<{
    key: string;
    type: "account" | "ip";
    identifier: string;
    max: number;
    throttleMs: number;
  }> = [];

  if (params.email) {
    const emailNorm = params.email.trim().toLowerCase();
    operations.push({
      key: accountKey(emailNorm),
      type: "account",
      identifier: emailNorm,
      max: MAX_ACCOUNT_FAILURES,
      throttleMs: ACCOUNT_THROTTLE_WINDOW_MS,
    });
  }
  if (params.ip) {
    const ipNorm = params.ip.trim().toLowerCase();
    operations.push({
      key: ipKey(ipNorm),
      type: "ip",
      identifier: ipNorm,
      max: MAX_IP_FAILURES,
      throttleMs: IP_THROTTLE_WINDOW_MS,
    });
  }

  // 1. Update in-memory fallback cache
  for (const op of operations) {
    const existing = memoryRateLimitCache.get(op.key);
    if (!existing || existing.expiresAt <= nowMs) {
      memoryRateLimitCache.set(op.key, {
        failures: 1,
        firstFailureAt: nowMs,
        lastFailureAt: nowMs,
        blockedUntil: null,
        expiresAt: nowMs + RECORD_TTL_MS,
      });
    } else {
      existing.failures += 1;
      existing.lastFailureAt = nowMs;
      existing.expiresAt = nowMs + RECORD_TTL_MS;
      if (existing.failures >= op.max) {
        existing.blockedUntil = nowMs + op.throttleMs;
      }
    }
  }

  // 2. Persist to MongoDB for shared state across all Vercel serverless microVMs
  try {
    await connectMongoDB();
    for (const op of operations) {
      const expiresAt = new Date(nowMs + RECORD_TTL_MS);

      // Read existing to check if failure exceeds max
      const existing = await AuthRateLimit.findOne({ key: op.key }).lean();
      const currentFailures = (existing?.failures || 0) + 1;
      const blockedUntil =
        currentFailures >= op.max ? new Date(nowMs + op.throttleMs) : null;

      await AuthRateLimit.collection.updateOne(
        { key: op.key },
        {
          $inc: { failures: 1 },
          $set: {
            lastFailureAt: now,
            expiresAt,
            ...(blockedUntil ? { blockedUntil } : {}),
          },
          $setOnInsert: {
            type: op.type,
            identifier: op.identifier,
            firstFailureAt: now,
          },
        },
        { upsert: true }
      );
    }
  } catch (err) {
    // If DB has an issue, memory cache already recorded the attempt
    console.warn("[AuthRateLimit] Database update warning (falling back to memory):", (err as Error)?.message);
  }
}

/**
 * Resets the failed attempt counter upon a successful login.
 * Ensures legitimate users who made typos are never penalized once authenticated.
 */
export async function recordSuccessfulLogin(params: {
  email?: string;
  ip?: string;
}): Promise<void> {
  const keysToReset: string[] = [];
  if (params.email) keysToReset.push(accountKey(params.email));
  if (params.ip) keysToReset.push(ipKey(params.ip));

  // Reset in memory cache
  for (const key of keysToReset) {
    memoryRateLimitCache.delete(key);
  }

  // Reset in MongoDB
  try {
    await connectMongoDB();
    await AuthRateLimit.deleteMany({ key: { $in: keysToReset } });
  } catch (err) {
    console.warn("[AuthRateLimit] Failed to clear rate limit record on login success:", (err as Error)?.message);
  }
}

/**
 * Performs a constant-time dummy bcrypt comparison.
 * Ensures timing attacks cannot distinguish between non-existent and existing accounts.
 */
export async function constantTimeDummyCompare(password: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password || "", DUMMY_PASSWORD_HASH);
  } catch {
    return false;
  }
}

/**
 * Resets all rate limit records. Used in automated test suites.
 */
export async function resetAuthRateLimitForTesting(): Promise<void> {
  memoryRateLimitCache.clear();
  try {
    await connectMongoDB();
    await AuthRateLimit.deleteMany({});
  } catch {
    // Ignore in tests where MongoDB is offline
  }
}
