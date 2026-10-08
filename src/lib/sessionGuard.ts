import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";

/**
 * Revalidates that the JWT's claimed identity is still a real, active,
 * same-role account.
 *
 * The NextAuth JWT session carries `role` and `isActive` (implicitly, via
 * "the account existed and was active at sign-in") baked in at login time and
 * never rechecked for the life of the token (default 30 days). That means
 * deactivating a dealer, or changing their role, previously had no effect on
 * an already-issued session.
 *
 * This module adds a short-TTL, DB-backed recheck. It is deliberately NOT
 * wired into `src/proxy.ts` (which must stay a lightweight, edge-friendly JWT
 * check per its own docstring) — it runs in `requireSession()` and in the
 * handful of page-level `getServerSession` call sites instead, both of which
 * already touch mongoose.
 *
 * Fail-open / fail-closed policy:
 *   - A definite "the account is inactive" or "the account no longer exists"
 *     or "the role no longer matches" answer is FAIL-CLOSED (treated as an
 *     invalid session).
 *   - A DB error while checking (timeout, transient network issue) is
 *     FAIL-OPEN: the session is treated as still valid. A full DB outage must
 *     not become a full authentication outage on top of itself; the regular
 *     per-request `connectMongoDB()` calls elsewhere already surface a DB
 *     outage as 500s on every data-touching request.
 */

/**
 * Overridable only so the test suite can set it to 0 and observe a
 * deactivation take effect on the very next request instead of waiting out
 * the real-world cache window. Production code never sets this env var.
 */
function resolveCacheTtlMs(): number {
  const raw = process.env.SESSION_ACTOR_CACHE_TTL_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
}

interface CacheEntry {
  valid: boolean;
  expiresAt: number;
}

declare global {
  var sessionActorCache: Map<string, CacheEntry> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  if (!global.sessionActorCache) {
    global.sessionActorCache = new Map();
  }
  return global.sessionActorCache;
}

function cacheKey(userId: number, role: string): string {
  return `${userId}:${role}`;
}

/**
 * Returns true when `userId` is a real AdminUser document, `isActive` is not
 * `false`, and its stored `role` equals `tokenRole`. Cached for `CACHE_TTL_MS`
 * per (userId, tokenRole) pair so a deactivation or role change is honoured
 * within that window, without adding a DB round trip to every request.
 */
export async function isSessionActorStillValid(userId: number, tokenRole: string): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0 || !tokenRole) return false;

  const cache = getCache();
  const key = cacheKey(userId, tokenRole);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.valid;
  }

  let valid: boolean;
  try {
    await connectMongoDB();
    const user = await AdminUser.findById(userId).select("isActive role").lean();
    valid = Boolean(user) && user!.isActive !== false && user!.role === tokenRole;
  } catch (error) {
    // Fail-open: a DB hiccup must not look identical to "deactivated".
    console.error("[sessionGuard] isSessionActorStillValid DB check failed; failing open:", error);
    valid = true;
  }

  cache.set(key, { valid, expiresAt: now + resolveCacheTtlMs() });
  return valid;
}

/** Test-only escape hatch: clears the in-process cache between test cases. */
export function clearSessionActorCacheForTests(): void {
  getCache().clear();
}
