import { NextRequest, NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { withSession } from "@/lib/api-auth";
import { withTenant, runUnscoped } from "@/lib/tenant/context";
import { hasPermission } from "@/lib/permissions";
import { getAdminDashboardData, type DateRangeKey } from "@/lib/adminDashboardData";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";

const VALID_RANGES: Set<DateRangeKey> = new Set(["7d", "30d", "90d", "1y", "all"]);

export async function GET(req: NextRequest) {
  try {
    return await withSession(async (actor) => {
      // Dealers cannot access the full admin dashboard API
      if (actor.role === "dealer" || actor.role === "sales") {
        throw new ApiError("FORBIDDEN", "You do not have permission to access admin analytics.");
      }

      await connectMongoDB();

      const searchParams = req.nextUrl.searchParams;
      const rawRange = searchParams.get("range") as DateRangeKey | null;
      const dateRange: DateRangeKey = rawRange && VALID_RANGES.has(rawRange) ? rawRange : "30d";
      const includeDemo = searchParams.get("demo") === "1" || searchParams.get("demo") === "true";

      // Super Admin without active company context must not query company data
      if (actor.role === "super_admin" && !actor.companyId) {
        return apiSuccess({
          platformContextOnly: true,
          message: "Select a company to view company analytics.",
          dateRange: { key: dateRange, label: "Last 30 days", start: null, end: new Date().toISOString() },
        });
      }

      // Tenant-scoped execution
      const data = await withTenant(actor, () =>
        getAdminDashboardData({ dateRange, includeDemo })
      );

      return apiSuccess(data);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/dashboard" });
  }
}

