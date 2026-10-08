import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ApiError, UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";
import { isSessionActorStillValid } from "@/lib/sessionGuard";

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
const ALL_APP_ROLES = ["super_admin", "admin", "dealer"];

export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }

  const role = (session.user as { role?: string }).role;
  if (!role || !ALL_APP_ROLES.includes(role)) {
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
