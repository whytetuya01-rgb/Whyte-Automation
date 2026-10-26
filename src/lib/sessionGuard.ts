import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company } from "@/models";
import { getRolePermissions } from "@/lib/roleService";
import { SUPER_ADMIN_PERMISSIONS } from "@/lib/permissions";
import { runUnscoped } from "@/lib/tenant/context";
import { reviewBlockFor } from "@/lib/companyReviewStatus";
import { resolveAccountCompany } from "@/lib/tenant/accountCompany";

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

export interface SessionActorData {
  valid: boolean;
  role?: string;
  isActive?: boolean;
  /** `null` for the platform super_admin; every other role's company. */
  companyId?: number | null;
  permissions: string[];
  expiresAt: number;
}

declare global {
  var sessionActorCache: Map<string, SessionActorData> | undefined;
}

function getCache(): Map<string, SessionActorData> {
  if (!global.sessionActorCache) {
    global.sessionActorCache = new Map();
  }
  return global.sessionActorCache;
}

function cacheKey(userId: number, role: string): string {
  return `${userId}:${role}`;
}

/**
 * Retrieves verified, cached session actor details including fresh permissions.
 *
 * Ensures revoked permissions or deactivations are enforced within the TTL window
 * without trusting stale client-supplied values.
 */
export async function getSessionActor(userId: number, tokenRole: string): Promise<SessionActorData | null> {
  if (!Number.isInteger(userId) || userId <= 0 || !tokenRole) return null;

  const cache = getCache();
  const key = cacheKey(userId, tokenRole);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  let data: SessionActorData;
  try {
    await connectMongoDB();
    // Runs before any tenant context exists for this request (this IS the
    // step that resolves it) — same "auth-lookup" reason as src/lib/auth.ts.
    // Must `await` INSIDE the callback (not just return the query): Mongoose
    // queries are lazy thenables that only actually execute once something
    // calls `.then()` on them, and that has to happen while this callback is
    // still synchronously running for the tenant-scope plugin's hooks to see
    // the context `runUnscoped` just established.
    const user = await runUnscoped("auth-lookup", async () =>
      await AdminUser.findById(userId).select("isActive role permissions companyId").lean()
    );
    const userRole = user?.role ? user.role.trim().toLowerCase() : "";
    const normTokenRole = tokenRole ? tokenRole.trim().toLowerCase() : "";
    let valid = Boolean(user) && user!.isActive !== false && userRole === normTokenRole;
    // No default company: a non-super account without an explicit, existing company is invalid.
    const account = resolveAccountCompany(userRole, (user as { companyId?: unknown } | null)?.companyId);
    const companyId = account.ok ? account.companyId : null;
    if (valid && !account.ok) valid = false;

    // Invalidate the session if the company is missing or suspended
    if (valid && companyId !== null) {
      const company = await Company.findById(companyId).select("status registrationStatus").lean();
      if (!company || company.status === "suspended" || reviewBlockFor(company.registrationStatus)) valid = false;
    }

    let permissions: string[] = [];
    if (valid && userRole) {
      if (userRole === "super_admin") {
        permissions = Array.from(SUPER_ADMIN_PERMISSIONS);
      } else if (userRole === "configurable_admin") {
        permissions = Array.isArray(user?.permissions) ? (user.permissions as string[]) : [];
      } else {
        permissions = await getRolePermissions(userRole, companyId);
      }
    }

    data = {
      valid,
      role: user?.role,
      isActive: user?.isActive,
      companyId,
      permissions,
      expiresAt: now + resolveCacheTtlMs(),
    };
  } catch (error) {
    // Fail-open: a DB hiccup must not lock out active users.
    console.error("[sessionGuard] getSessionActor DB check failed; failing open:", error);
    data = {
      valid: true,
      role: tokenRole,
      isActive: true,
      permissions: [],
      expiresAt: now + resolveCacheTtlMs(),
    };
  }

  cache.set(key, data);
  return data;
}

/**
 * Returns true when `userId` is a real AdminUser document, `isActive` is not
 * `false`, and its stored `role` equals `tokenRole`. Cached for `CACHE_TTL_MS`.
 */
export async function isSessionActorStillValid(userId: number, tokenRole: string): Promise<boolean> {
  const actor = await getSessionActor(userId, tokenRole);
  return actor ? actor.valid : false;
}

/** Invalidates in-memory cache for a user whose permissions or role just changed. */
export function invalidateSessionActor(userId: number): void {
  const cache = getCache();
  const prefix = `${userId}:`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/** Invalidates the entire in-memory session actor cache for all users (e.g. after role permissions change). */
export function invalidateAllSessionActors(): void {
  getCache().clear();
}

/** Test-only escape hatch: clears the in-process cache between test cases. */
export function clearSessionActorCacheForTests(): void {
  getCache().clear();
}

