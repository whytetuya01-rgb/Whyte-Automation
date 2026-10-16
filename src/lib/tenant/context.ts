import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tenant context, carried via `AsyncLocalStorage`.
 *
 * Mongoose document middleware (the `pre("find")`/`pre("save")` hooks
 * `src/lib/tenant/plugin.ts` registers) runs inside the Mongoose driver, with
 * no access to the HTTP request, the NextAuth session, or anything else
 * request-scoped — it only ever sees the query/document being built. There is
 * no prop-drilling path through Mongoose's own API for "which company is
 * this". `AsyncLocalStorage` is the mechanism that bridges that gap: it is
 * set once, as early as possible in a request's lifecycle (see
 * `runWithTenantContext` call sites in `src/lib/api-auth.ts` and
 * `withTenant()` below for server-rendered pages), and read ambiently by the
 * plugin's hooks for the rest of that request's async call chain — including
 * through `populate()`, which runs as a separate query against the related
 * model and therefore its own, separate pass through the same hooks.
 *
 * Node's `AsyncLocalStorage` context propagates through promise chains and
 * microtasks by design (this is its whole purpose, unlike the deprecated
 * `domains` API), so a hook firing inside `Model.find().exec()` — itself
 * invoked from inside a route handler that called `runWithTenantContext` —
 * sees the same context without anything manually threading it through.
 */

/** Why a query was deliberately run with no company filter. Every use is logged. */
export type UnscopedReason = "platform-admin" | "migration" | "auth-lookup" | "public-registration";

const KNOWN_UNSCOPED_REASONS: ReadonlySet<string> = new Set<UnscopedReason>([
  "platform-admin",
  "migration",
  "auth-lookup",
  "public-registration",
]);

export interface TenantContextValue {
  /**
   * `null` for a platform Super Admin who has not explicitly "acted as" a
   * company — NOT a license to see everything. The plugin treats a `null`
   * `companyId` (with no `bypass` reason) as "scope to nothing", per the
   * client's explicit decision: Super Admin does not see company business
   * data by default.
   */
  companyId: number | null;
  userId: number;
  role: string;
  /** True only while a Super Admin has an active "act as company" session. */
  actingAsCompany: boolean;
  /** Set only inside `runUnscoped()`. Never set by ordinary request handling. */
  bypass?: UnscopedReason;
}

// Cached on `globalThis`, the same defensive pattern `src/lib/mongodb.ts` and
// `src/lib/sessionGuard.ts` already use for their own module-level singletons.
// `AsyncLocalStorage` is created once per Node process in production, but in
// `next dev`'s webpack Fast Refresh, editing a file that (transitively)
// imports this module can cause it to be re-evaluated as a distinct module
// instance while a concurrently in-flight request's closures still hold a
// reference to the OLD instance — splitting "context was set here" from
// "context is read there" and surfacing as a spurious
// `TenantScopeViolationError: no tenant context established` that does NOT
// reproduce in a production build (confirmed in `tests/phase1-admin-pages.test.mjs`,
// which found zero such errors against a real `npm run build` + `npm run start`).
// Caching the instance on `globalThis` makes every module resolution reuse
// the same store across a Fast Refresh, eliminating the split.
declare global {
  var tenantContextStorage: AsyncLocalStorage<TenantContextValue> | undefined;
}

const storage: AsyncLocalStorage<TenantContextValue> =
  global.tenantContextStorage ?? new AsyncLocalStorage<TenantContextValue>();
if (!global.tenantContextStorage) {
  global.tenantContextStorage = storage;
}

/** Thrown when a tenant-scoped model is used with no context, or a scope rule is violated. */
export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeViolationError";
  }
}

/** Establishes the tenant context for the remainder of `fn`'s async call chain. */
export function runWithTenantContext<T>(ctx: TenantContextValue, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Sets the tenant context for the rest of the CURRENT async execution chain,
 * with no callback wrapper needed. This is what `requireSession()` actually
 * calls (see `src/lib/api-auth.ts`): an API route handler is written as
 * `await requireSession(); ...more code in the same function...`, not as a
 * callback passed into a wrapper, so `runWithTenantContext`'s `storage.run()`
 * — which only covers the callback it's given — cannot reach that "more
 * code". `AsyncLocalStorage.enterWith()` is Node's purpose-built mechanism
 * for exactly this: it mutates the active store for the remainder of the
 * current async chain (this one request's execution), without leaking into
 * other concurrent requests, which each get their own independent chain.
 */
export function enterTenantContext(ctx: TenantContextValue): void {
  storage.enterWith(ctx);
}

/** Reads the current tenant context, or `undefined` if none was ever established. */
export function getTenantContext(): TenantContextValue | undefined {
  return storage.getStore();
}

/**
 * Explicit, named, logged escape hatch for the narrow set of operations that
 * legitimately need to run without a company filter: a platform-wide Super
 * Admin view, the one-time migration backfill script, the auth lookup that
 * resolves `companyId` from an email before any context exists, and the
 * public dealer-registration route (which has no session at all).
 *
 * Deliberately NOT a silent fallback — every call is `console.warn`-logged
 * with its reason, the same philosophy `src/lib/softDelete/scope.ts`'s
 * `includeSoftDeleted(query, purpose)` already uses for soft-delete's own
 * escape hatch.
 */
export function runUnscoped<T>(reason: UnscopedReason, fn: () => T): T {
  if (!KNOWN_UNSCOPED_REASONS.has(reason)) {
    throw new TenantScopeViolationError(`Unknown reason to run unscoped: "${String(reason)}".`);
  }
  console.warn(`[tenant] running unscoped — reason: ${reason}`);
  const existing = storage.getStore();
  return storage.run(
    {
      companyId: null,
      userId: existing?.userId ?? 0,
      role: existing?.role ?? "system",
      actingAsCompany: false,
      bypass: reason,
    },
    fn
  );
}

/**
 * Wraps a server-rendered page's data-loading code in a tenant context, for
 * the Server Components / server-side page loaders that query Mongo directly
 * rather than going through an API route handler (which gets its context
 * from `requireSession()`/`requirePermission()` in `src/lib/api-auth.ts`).
 *
 * `resolveActor` is the same shape `getAuthenticatedActor()` already returns,
 * so a page loader can do:
 *
 *   const actor = await getAuthenticatedActor();
 *   return withTenant(actor, async () => { ... Mongoose calls ... });
 */
export async function withTenant<T>(
  actor: { userId: number; role: string; companyId: number | null; actingAsCompany?: boolean },
  fn: () => Promise<T>
): Promise<T> {
  return runWithTenantContext(
    {
      companyId: actor.companyId,
      userId: actor.userId,
      role: actor.role,
      actingAsCompany: actor.actingAsCompany ?? false,
    },
    fn
  );
}
