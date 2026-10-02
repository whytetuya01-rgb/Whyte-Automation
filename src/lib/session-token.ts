import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

/**
 * Request-scoped session check for `src/proxy.ts`.
 *
 * `src/lib/api-auth.ts` is deliberately not used here: it pulls in
 * `getServerSession` and therefore the full `authOptions` graph (mongoose,
 * bcryptjs). Proxy runs on every request, so it uses `getToken` instead, which
 * verifies the session JWT signature with `NEXTAUTH_SECRET` and nothing else.
 *
 * The answer is always "no" on any failure. A missing secret, a malformed
 * cookie, an expired token or a bad signature must all be treated as signed out
 * rather than as an error to work around.
 */
export async function getVerifiedSessionRole(request: NextRequest): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[proxy] NEXTAUTH_SECRET is not set; treating request as unauthenticated.");
    return null;
  }

  try {
    const token = await getToken({ req: request, secret });
    return token?.id && typeof token.role === "string" ? token.role : null;
  } catch (error) {
    console.error("[proxy] Session verification failed:", error);
    return null;
  }
}
