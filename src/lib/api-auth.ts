import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ApiError, UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";
import { isSessionActorStillValid, getSessionActor } from "@/lib/sessionGuard";
import { hasPermission, type Permission } from "@/lib/permissions";

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
  // account the token claims to be is still real, active and the same role.
  const userId = Number((session.user as { id?: string }).id);
  const stillValid = await isSessionActorStillValid(userId, role);
  if (!stillValid) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

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
 * Returns the verified session, role, user ID, and live database permissions.
 */
export async function getAuthenticatedActor(): Promise<{
  session: Session;
  role: string;
  userId: number;
  permissions: string[];
}> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role || "";
  const userId = Number((session.user as { id?: string }).id);
  const actor = await getSessionActor(userId, role);
  return {
    session,
    role,
    userId,
    permissions: actor?.permissions ?? [],
  };
}


