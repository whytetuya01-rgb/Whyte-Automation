/**
 * Minimal in-process rate limiter for public, unauthenticated write endpoints
 * (currently: dealer self-registration).
 *
 * Deliberately simple and explicitly scoped:
 *   - Fixed window, keyed by caller IP + a route-specific prefix.
 *   - In-memory only. On a multi-instance deployment each instance has its
 *     own counters, so the real effective limit is (perInstanceLimit x
 *     instanceCount), not a global guarantee. That is an accepted, documented
 *     trade-off for a first pass — a correct distributed limiter needs a
 *     shared store (e.g. Redis) and is out of scope for this change.
 *   - Never throws. A bug here must not be able to take an endpoint down;
 *     callers get `{ limited: false }` if anything goes wrong.
 */

const WINDOWS = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  options: { max: number; windowMs: number }
): RateLimitResult {
  try {
    const now = Date.now();
    const existing = WINDOWS.get(key);

    if (!existing || existing.resetAt <= now) {
      WINDOWS.set(key, { count: 1, resetAt: now + options.windowMs });
      return { limited: false, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count > options.max) {
      return { limited: true, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
    }
    return { limited: false, retryAfterSeconds: 0 };
  } catch {
    return { limited: false, retryAfterSeconds: 0 };
  }
}

/** Best-effort caller IP from standard proxy headers; "unknown" when absent (e.g. local dev). */
export function clientIpFromRequest(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
