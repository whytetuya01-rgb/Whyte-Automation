import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { calculateDealerEarning, resolveCustomerDiscountPercent, toPlainNumber } from "@/lib/dealerEarnings";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import { parseQuotationId, transitionQuotationSchema } from "@/lib/validation/quotation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/transition
 * Enforces the strict quotation lifecycle:
 *   - approve: Sent -> Approved (Super Admin or Admin)
 *   - reject:  Sent -> Rejected (Super Admin or Admin)
 *   - deliver: Approved -> Delivered (Super Admin or Admin)
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await requireRole("super_admin", "admin");
    const userId = Number((session.user as any).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    const body = transitionQuotationSchema.parse(await readJsonBody(req));
    const { action } = body;

    await connectMongoDB();
    const quotation = await Quotation.findById(quotationId);
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    const currentStatus = quotation.status;

    if (action === "approve") {
      if (currentStatus !== "sent") {
        throw new ApiError("CONFLICT", `Cannot approve quotation in "${currentStatus}" status. Only "sent" quotations can be approved.`);
      }
      quotation.status = "approved";
      quotation.approvedAt = new Date();
      quotation.approvedBy = userId;

      // Freeze estimated earning amount from canonical room items
      const quotationRooms = await QuotationRoom.find({ quotationId }).select("_id").lean();
      const roomIds = quotationRooms.map((r) => r._id);
      const quotationItems = await QuotationItem.find({ quotationRoomId: { $in: roomIds } }).select("quantity unitPrice").lean();
      const subtotal = quotationItems.reduce((acc, it) => acc + (it.quantity || 1) * Number(it.unitPrice || 0), 0);
      // Earning is derived from the allocation snapshot and customer discount (not
      // from a previously cached percentage) and frozen exactly once, here.
      const { earningPercent, earningAmount } = calculateDealerEarning({
        subtotal,
        allocatedPercent: toPlainNumber(quotation.allocatedDiscountPercent),
        customerPercent: resolveCustomerDiscountPercent(quotation),
      });
      quotation.estimatedEarningPercent = earningPercent;
      quotation.estimatedEarningAmount = mongoose.Types.Decimal128.fromString(earningAmount.toFixed(2));
    } else if (action === "reject") {
      if (currentStatus !== "sent") {
        throw new ApiError("CONFLICT", `Cannot reject quotation in "${currentStatus}" status. Only "sent" quotations can be rejected.`);
      }
      quotation.status = "rejected";
      quotation.rejectedAt = new Date();
      quotation.rejectedBy = userId;
    } else if (action === "deliver") {
      if (currentStatus !== "approved") {
        throw new ApiError("CONFLICT", `Cannot mark as delivered in "${currentStatus}" status. Only "approved" quotations can be delivered.`);
      }
      quotation.status = "delivered";
      quotation.deliveredAt = new Date();
      quotation.deliveredBy = userId;
    }

    await quotation.save();

    await recordQuotationEvent({
      quotationId,
      action: action === "approve" ? "quotation_approved" : action === "reject" ? "quotation_rejected" : "quotation_delivered",
      performedBy: userId,
      previousValue: { status: currentStatus },
      newValue: { status: quotation.status },
    });

    return apiSuccess({
      id: quotation._id,
      quotationNumber: quotation.quotationNumber,
      status: quotation.status,
      approvedAt: quotation.approvedAt,
      approvedBy: quotation.approvedBy,
      rejectedAt: quotation.rejectedAt,
      rejectedBy: quotation.rejectedBy,
      deliveredAt: quotation.deliveredAt,
      deliveredBy: quotation.deliveredBy,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/transition" });
  }
}
