import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Quotation } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { ApiError, handleApiError } from "@/lib/api-response";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam, parseIntQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/dealers
 * Lists dealers with quotation statistics and accumulated earnings.
 * Super Admin & Admin: see all dealers.
 * Dealer: 403 Forbidden.
 */
export async function GET(req: Request) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();

    const { searchParams } = new URL(req.url);
    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 10, maxPageSize: 100 });
    const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
    const status = parseStringQueryParam(searchParams, "status", { max: 20 });

    const filter: Record<string, unknown> = { role: "dealer" };

    if (status && status !== "all") {
      if (status === "active") filter.isActive = true;
      if (status === "inactive") filter.isActive = false;
    }

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
        { contactNumber: { $regex: searchRegex } },
        { gstNumber: { $regex: searchRegex } },
      ];
    }

    const [total, dealers] = await Promise.all([
      AdminUser.countDocuments(filter),
      AdminUser.find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean(),
    ]);

    const dealerIds = dealers.map((d: any) => d._id);

    // Aggregate quotation counts and accumulated earnings per dealer
    const statsAggregation = await Quotation.aggregate([
      { $match: { dealerId: { $in: dealerIds } } },
      {
        $group: {
          _id: "$dealerId",
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          accumulatedEarnings: {
            $sum: {
              $cond: [
                { $in: ["$status", ["approved", "delivered"]] },
                { $toDouble: "$estimatedEarningAmount" },
                0,
              ],
            },
          },
        },
      },
    ]);

    const statsMap = new Map<number, any>();
    for (const stat of statsAggregation) {
      statsMap.set(stat._id, stat);
    }

    const enrichedDealers = dealers.map((d: any) => {
      const stats = statsMap.get(d._id) ?? {
        total: 0,
        draft: 0,
        sent: 0,
        approved: 0,
        rejected: 0,
        delivered: 0,
        accumulatedEarnings: 0,
      };

      const { passwordHash, ...rest } = d;
      return {
        ...rest,
        id: d._id,
        quotationStats: {
          total: stats.total,
          draft: stats.draft,
          sent: stats.sent,
          approved: stats.approved,
          rejected: stats.rejected,
          delivered: stats.delivered,
        },
        accumulatedEarnings: Math.round(Number(stats.accumulatedEarnings || 0) * 100) / 100,
      };
    });

    return NextResponse.json(
      createPaginatedResponse(enrichedDealers, total, {
        page: pagination.page,
        pageSize: pagination.pageSize,
      })
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/dealers" });
  }
}
