import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVerifiedSessionRole } from "@/lib/session-token";
import { UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";

/**
 * Central authentication gate (Next 16 `proxy`, formerly `middleware`).
 *
 * Every application page and every API route requires a valid session except
 * for the narrowly scoped public paths below:
 *   - `/login`, `/register`, and `/admin/login` — public auth screens.
 *   - `/api/auth/*` — NextAuth framework endpoints (session, csrf, callback,
 *     providers, signout) required to establish a session in the first place.
 *   - `POST /api/admin/register` — creates only a restricted Dealer account.
 *
 * Dealer sessions are routed only to `/dealer/access` and receive 403 for
 * protected APIs. Business API handlers also deny Dealer roles independently.
 *
 * Static assets and Next internals are excluded via `config.matcher` so CSS,
 * JS and images still load on the login screen.
 *
 * API requests never redirect: they receive the documented 401 JSON envelope.
 * Page requests redirect to the login screen and carry the original destination
 * so the user resumes where they intended to go.
 */

/** Public auth screens. Matched exactly, or as a parent path segment. */
const PUBLIC_PAGES = ["/login", "/register", "/admin/login", "/admin/register"];

/** NextAuth framework endpoints that must stay reachable to sign in. */
const PUBLIC_API_PREFIX = "/api/auth";
const PUBLIC_REGISTRATION_API = "/api/admin/register";
const DEALER_LANDING_PAGE = "/dealer/access";
const ADMIN_ROLES = new Set(["super_admin", "admin"]);

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isFrameworkApi(pathname: string): boolean {
  return pathname === PUBLIC_API_PREFIX || pathname.startsWith(`${PUBLIC_API_PREFIX}/`);
}

function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isAdminPage(pathname: string): boolean {
  return pathname === "/admin" || (pathname.startsWith("/admin/") && !isPublicPage(pathname));
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPage(pathname) || isFrameworkApi(pathname)) {
    return NextResponse.next();
  }

  if (pathname === PUBLIC_REGISTRATION_API && request.method === "POST") {
    return NextResponse.next();
  }

  const role = await getVerifiedSessionRole(request);
  if (role === "dealer") {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "You do not have permission to access this resource." } },
        { status: 403 }
      );
    }
    if (!isApiRequest(pathname)) {
      if (
        isAdminPage(pathname) ||
        pathname === "/dealers" ||
        pathname.startsWith("/dealers/") ||
        pathname === "/dealer/access"
      ) {
        return redirectTo(request, "/");
      }
    }
    return NextResponse.next();
  }

  if (role === "sales") {
    if (isApiRequest(pathname)) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "This role is no longer supported." } },
        { status: 403 }
      );
    }
    return redirectTo(request, "/login");
  }

  if (role && ADMIN_ROLES.has(role)) {
    if (!isApiRequest(pathname) && !isAdminPage(pathname) && !isPublicPage(pathname) && !pathname.startsWith("/quotation/")) {
      return redirectTo(request, "/admin/dashboard");
    }
    return NextResponse.next();
  }

  if (isApiRequest(pathname)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: UNAUTHENTICATED_MESSAGE } },
      { status: role ? 403 : 401 }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = isAdminPage(pathname) ? "/admin/login" : "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals and static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|avif|gif|ico|woff|woff2|ttf|css|js|map|txt|xml|json)$).*)",
  ],
};
