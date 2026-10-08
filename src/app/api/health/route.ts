import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";

/**
 * Database health check.
 *
 * Requires a session: this endpoint used to be public and echoed the masked
 * connection string plus the database name, which is reconnaissance for anyone
 * who can reach the deployment. The response is minimal — a fixed "ok" status
 * and a timestamp — with no host, URI, env var value or driver detail of any
 * kind.
 */
export async function GET() {
  try {
    await requireSession();
    await connectMongoDB();

    return NextResponse.json({
      status: "ok",
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    // The failure path deliberately does not echo the driver message: a health
    // endpoint must not become a way to read server internals.
    return handleApiError(error, { logPrefix: "GET /api/health" });
  }
}
