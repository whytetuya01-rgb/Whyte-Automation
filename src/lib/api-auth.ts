import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ApiError, UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";
import { getSessionActor } from "@/lib/sessionGuard";
import { hasPermission, type Permission } from "@/lib/permissions";
import { enterTenantContext, runWithTenantContext, type TenantContextValue } from "@/lib/tenant/context";
import { resolveActAsCompanyId } from "@/lib/tenant/actAs";

/**
 * IMPORTANT, found empirically (see tests/phase1-tenant-auth.test.mjs's debug
 * trail): `AsyncLocalStorage.enterWith()`, called inside `requireSession()`,
 * reliably sets the store at that exact point (confirmed by logging
 * immediately after the call) — but does NOT survive into the calling route
 * handler's next line in this Next.js/webpack-bundled runtime. The store is
 * back to `undefined` by the time the handler's own code resumes, even
 * though nothing in between does anything unusual. This looks like a bundled
 * webpack/SWC async-transform interaction with `enterWith`'s continuation
 * tracking, not a logic bug in `./tenant/context.ts` itself (its own
 * `runWithTenantContext`/`storage.run()` — tested directly in
 * tests/tenant-scope-plugin.test.ts outside of Next's bundler — works fine).
 *
 * The fix is the standard, universally-reliable AsyncLocalStorage pattern:
 * wrap the REST OF THE HANDLER in an explicit `storage.run()` callback
 * (`runWithTenantContext`) instead of relying on an ambient `enterWith()`
 * mutation to survive an opaque await boundary. `withSession`/`withPermission`/
 * `withAnyPermission` below are that pattern — new routes (and every route
 * migrated so far) use these, not the older `requireSession()`/
 * `requirePermission()` + enterWith combination, which is kept only for
 * routes not yet migrated and must NOT be trusted to carry tenant context
 * into a handler body that touches a tenant-scoped model.
 */

/**
 * Single authentication entry point for API route handlers.
 *
 * Throwing instead of returning lets every handler keep the same shape:
 *
 *   try {
 *     await requireSession();
 *     ...
 *   } catch (error) {
 *     return handleApiError(error, { logPrefix: "POST /api/thing" });
 *   }
 *
 * Every business endpoint calls this. The only routes that legitimately skip it
 * are the NextAuth framework endpoints in `src/app/api/auth/[...nextauth]`,
 * which are excluded centrally in `src/proxy.ts`.
 */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  const role = (session.user as { role?: string }).role;
  if (!role || role === "sales") {
    throw new ApiError("FORBIDDEN", "You do not have permission to access this resource.");
  }

  // The JWT is trusted for its whole lifetime by default; this closes that gap
  // by rechecking (with a short TTL cache, see sessionGuard.ts) that the
  // account the token claims to be is still real, active, the same role, and
  // — now that companies exist — that its company is still `active` (a
  // suspended company forces every one of its users' sessions invalid here).
  const userId = Number((session.user as { id?: string }).id);
  const actor = await getSessionActor(userId, role);
  if (!actor || !actor.valid) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  // Establishes the tenant context for the REST of this request's execution
  // (every Mongoose call any handler makes after `await requireSession()`
  // returns) — see the doc comment on `enterTenantContext` in
  // `src/lib/tenant/context.ts` for why this needs `enterWith`, not `run`.
  // Super Admin has no company of its own: it sees nothing from tenant
  // models unless it has an active "act as company" grant for this request.
  const companyId = role === "super_admin" ? await resolveActAsCompanyId(userId) : actor.companyId ?? null;
  enterTenantContext({
    companyId,
    userId,
    role,
    actingAsCompany: role === "super_admin" && companyId !== null,
  });

  return session;
}

/**
 * Session-plus-role guard for endpoints that need specific role rules.
 *
 * Role values come only from the server-verified session, never from a
 * client-supplied value.
 */
export async function requireRole(...allowedRoles: string[]): Promise<Session> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (!role || !allowedRoles.includes(role)) {
    throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return session;
}

/**
 * Granular capability guard for API route handlers.
 *
 * Evaluates whether the authenticated session possesses the required permission.
 * - `super_admin`: Granted all standard and super-admin operations.
 * - `admin`: Granted the full legacy admin capability set, excluding super-admin exclusives.
 * - `configurable_admin`: Granted only explicitly assigned permissions (verified DB-side, never trusting client input).
 * - `dealer` / unauthorized: Denied with 403 Forbidden.
 */
export async function requirePermission(permission: Permission): Promise<Session & { permissions: string[] }> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  const userId = Number((session.user as { id?: string }).id);

  const actor = await getSessionActor(userId, role!);
  if (!actor || !actor.valid) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  const allowed = hasPermission(role, actor.permissions, permission);
  if (!allowed) {
    throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
  }

  return Object.assign(session, { permissions: actor.permissions });
}

/**
 * Granular capability guard requiring at least one of the specified permissions.
 */
export async function requireAnyPermission(...permissions: Permission[]): Promise<Session & { permissions: string[] }> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  const userId = Number((session.user as { id?: string }).id);

  const actor = await getSessionActor(userId, role!);
  if (!actor || !actor.valid) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  const allowed = permissions.some((permission) => hasPermission(role, actor.permissions, permission));
  if (!allowed) {
    throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
  }

  return Object.assign(session, { permissions: actor.permissions });
}

/**
 * Returns the verified session, role, user ID, live database permissions,
 * and the tenant context this request is now running under (the same values
 * `requireSession()` already passed to `enterTenantContext()` — convenient
 * for a handler or page loader that wants to pass `companyId`/`actingAsCompany`
 * on to `withTenant()` for its own nested server-loader calls, or to a
 * client payload, without needing to import `getTenantContext()` separately).
 */
export async function getAuthenticatedActor(): Promise<{
  session: Session;
  role: string;
  userId: number;
  companyId: number | null;
  actingAsCompany: boolean;
  permissions: string[];
}> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role || "";
  const userId = Number((session.user as { id?: string }).id);
  const actor = await getSessionActor(userId, role);
  const companyId = role === "super_admin" ? await resolveActAsCompanyId(userId) : actor?.companyId ?? null;
  return {
    session,
    companyId,
    actingAsCompany: role === "super_admin" && companyId !== null,
    role,
    userId,
    permissions: actor?.permissions ?? [],
  };
}

export interface TenantSessionActor {
  session: Session;
  role: string;
  userId: number;
  companyId: number | null;
  actingAsCompany: boolean;
  permissions: string[];
  _timings?: {
    sessionResolutionMs: number;
    sessionGuardMs: number;
    tenantContextMs: number;
  };
}

/** Shared by withSession/withPermission/withAnyPermission below. */
async function resolveTenantActor(): Promise<TenantSessionActor> {
  const t0 = performance.now();
  const session = await getServerSession(authOptions);
  const sessionResolutionMs = Number((performance.now() - t0).toFixed(2));

  if (!session?.user) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }
  const role = (session.user as { role?: string }).role;
  if (!role || role === "sales") {
    throw new ApiError("FORBIDDEN", "You do not have permission to access this resource.");
  }
  const userId = Number((session.user as { id?: string }).id);

  const t1 = performance.now();
  const actor = await getSessionActor(userId, role);
  const sessionGuardMs = Number((performance.now() - t1).toFixed(2));

  if (!actor || !actor.valid) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  const t2 = performance.now();
  const companyId = role === "super_admin" ? await resolveActAsCompanyId(userId) : actor.companyId ?? null;
  const tenantContextMs = Number((performance.now() - t2).toFixed(2));

  return {
    session,
    role,
    userId,
    companyId,
    actingAsCompany: role === "super_admin" && companyId !== null,
    permissions: actor.permissions,
    _timings: {
      sessionResolutionMs,
      sessionGuardMs,
      tenantContextMs,
    },
  };
}

function tenantContextOf(actor: TenantSessionActor): TenantContextValue {
  return {
    companyId: actor.companyId,
    userId: actor.userId,
    role: actor.role,
    actingAsCompany: actor.actingAsCompany,
  };
}

/**
 * The reliable replacement for `await requireSession(); ...rest of handler...`.
 * Wraps the ENTIRE rest of the handler (everything that touches a
 * tenant-scoped model) inside `runWithTenantContext`'s `storage.run()`, which
 * — unlike `enterWith()` inside `requireSession()` — is proven (by this same
 * test suite) to actually carry the tenant context into the callback's own
 * `await`s. Every API route that reads/writes a tenant-scoped model should
 * use this (or `withPermission`/`withAnyPermission`) going forward.
 *
 *   export async function GET() {
 *     try {
 *       return await withSession(async (actor) => {
 *         await connectMongoDB();
 *         const rows = await Product.find({});
 *         return NextResponse.json(rows);
 *       });
 *     } catch (error) {
 *       return handleApiError(error, { logPrefix: "GET /api/products" });
 *     }
 *   }
 */
export async function withSession<T>(fn: (actor: TenantSessionActor) => Promise<T>): Promise<T> {
  const actor = await resolveTenantActor();
  return runWithTenantContext(tenantContextOf(actor), () => fn(actor));
}

/**
 * For endpoints that read (or lazily initialise) a COMPANY's own data: a Super Admin who has not selected "Act as
 * Company" has no active company, and tenant isolation deliberately scopes such a session to nothing. Instead of
 * letting a model call blow up (or, worse, creating records), answer with a controlled, explanatory 403. Never
 * bypasses tenant scoping and never assigns the caller to any company.
 */
export function requireActiveCompany(actor: Pick<TenantSessionActor, "companyId">): number {
  if (actor.companyId === null || actor.companyId === undefined) {
    throw new ApiError("FORBIDDEN", 'No company is selected. Choose a company with "Act as Company" to view this data.', {
      details: { reason: "COMPANY_CONTEXT_REQUIRED" },
    });
  }
  return actor.companyId;
}

/** Same as `withSession`, but also requires one specific permission first (checked inside the same tenant context). */
export async function withPermission<T>(permission: Permission, fn: (actor: TenantSessionActor) => Promise<T>): Promise<T> {
  return withSession(async (actor) => {
    if (!hasPermission(actor.role, actor.permissions, permission)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
    }
    return fn(actor);
  });
}

/** Same as `withSession`, but requires at least one of several permissions first. */
export async function withAnyPermission<T>(permissions: Permission[], fn: (actor: TenantSessionActor) => Promise<T>): Promise<T> {
  return withSession(async (actor) => {
    const allowed = permissions.some((p) => hasPermission(actor.role, actor.permissions, p));
    if (!allowed) {
      throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
    }
    return fn(actor);
  });
}


