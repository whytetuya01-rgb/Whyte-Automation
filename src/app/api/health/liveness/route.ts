import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/liveness
 *
 * Lightweight, unauthenticated liveness probe for external uptime monitors
 * (Pingdom, UptimeRobot, Datadog Synthetic Monitoring, AWS Route53).
 *
 * Requirements:
 * - No authentication required.
 * - No database queries or external network requests.
 * - No sensitive infrastructure or driver details leaked.
 * - Cache-Control: no-store, no-cache, must-revalidate.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

