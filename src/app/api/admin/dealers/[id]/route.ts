import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Quotation } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchDealerSchema = z.object({
  discountAllocationPercent: z.number().min(0, "Discount allocation cannot be negative.").max(100, "Discount allocation cannot exceed 100%.").optional(),
  isActive: z.boolean().optional(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  contactNumber: z.string().trim().max(30).optional(),
  gstNumber: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(500).optional(),
}).strict();

export async function GET(_req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    const { id: rawId } = await context.params;
    const dealerId = parseNumericId(rawId);

    await connectMongoDB();
    const dealer = await AdminUser.findOne({ _id: dealerId, role: "dealer" }).lean();

    if (!dealer) {
      throw new ApiError("NOT_FOUND", "Dealer not found.");
    }

    // Aggregate quotation stats and earnings
    const statsAggregation = await Quotation.aggregate([
      { $match: { dealerId } },
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

    const stats = statsAggregation[0] ?? {
      total: 0,
      draft: 0,
      sent: 0,
      approved: 0,
      rejected: 0,
      delivered: 0,
      accumulatedEarnings: 0,
    };

    const { passwordHash, ...rest } = dealer as any;

    return NextResponse.json({
      ...rest,
      id: dealer._id,
      quotationStats: stats,
      accumulatedEarnings: Math.round(Number(stats.accumulatedEarnings || 0) * 100) / 100,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/dealers/[id]" });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireRole("super_admin", "admin");
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);
    const callerName = session.user?.name ?? session.user?.email ?? "User";

    const { id: rawId } = await context.params;
    const dealerId = parseNumericId(rawId);

    await connectMongoDB();
    const dealer = await AdminUser.findOne({ _id: dealerId, role: "dealer" });
    if (!dealer) {
      throw new ApiError("NOT_FOUND", "Dealer not found.");
    }

    const body = patchDealerSchema.parse(await readJsonBody(req));

    // Update discount allocation if provided (Super Admin and Admin)
    if (body.discountAllocationPercent !== undefined) {
      const prev = dealer.discountAllocationPercent || 0;
      const next = body.discountAllocationPercent;
      if (prev !== next) {
        dealer.discountAllocationPercent = next;
        dealer.discountAllocationHistory.push({
          allocatedPercent: next,
          previousPercent: prev,
          changedBy: userId,
          changedByName: callerName,
          changedAt: new Date(),
        });
      }
    }

    // Only Super Admin can activate or deactivate dealer accounts
    if (body.isActive !== undefined) {
      if (role !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin can activate or deactivate dealer accounts.");
      }
      dealer.isActive = body.isActive;
    }

    if (body.firstName !== undefined) dealer.firstName = body.firstName;
    if (body.lastName !== undefined) dealer.lastName = body.lastName;
    if (body.firstName !== undefined || body.lastName !== undefined) {
      const f = body.firstName ?? dealer.firstName ?? "";
      const l = body.lastName ?? dealer.lastName ?? "";
      dealer.name = `${f} ${l}`.trim() || null;
    }
    if (body.contactNumber !== undefined) dealer.contactNumber = body.contactNumber;
    if (body.gstNumber !== undefined) dealer.gstNumber = body.gstNumber ? body.gstNumber.toUpperCase() : null;
    if (body.address !== undefined) dealer.address = body.address;

    await dealer.save();

    const userObj = typeof dealer.toJSON === "function" ? dealer.toJSON() : dealer;
    delete (userObj as any).passwordHash;

    return apiSuccess(userObj);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/admin/dealers/[id]" });
  }
}
