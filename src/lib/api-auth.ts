import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ApiError, UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";

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
