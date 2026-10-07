import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Quotation, QuotationRoom, QuotationItem } from "@/models";
import type { QuotationAuditAction } from "@/models";
import { withTransaction } from "@/lib/transaction";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { assignQuotationSchema, parseQuotationId } from "@/lib/validation/quotation";
import { requireActiveDealer } from "@/lib/quotationOwnership";
import { dealerSnapshot, recordQuotationEvent } from "@/lib/quotationAudit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/assign   { dealerId: number | null }
 *
 * Assigns, reassigns or (dealerId = null) unassigns a quotation. Super Admin and
 * Admin only; dealers can never move a quotation, including their own.
 *
 * `createdBy` / `createdAt` are never touched. `assignedBy` and `assignedOn` come
 * from the session and the server clock, never from the request body.
 *
 * The discount allocation snapshot follows the dealer, using the same earning
 * formula as quotation creation and edit (earning % = allocated % - customer %).
 * Approved and delivered quotations are locked because their earnings are final.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await requireRole("super_admin", "admin");
    const userId = Number((session.user as { id?: string }).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);
    const { dealerId } = assignQuotationSchema.parse(await readJsonBody(req));

    await connectMongoDB();

    const existing = await Quotation.findById(quotationId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (existing.status === "approved" || existing.status === "delivered") {
      throw new ApiError(
        "FORBIDDEN",
        `Quotation is ${existing.status} and cannot be reassigned. Earnings for approved quotations are final.`
      );
    }

    const previousDealerId = existing.dealerId ?? null;
    const nextDealer = dealerId === null ? null : await requireActiveDealer(dealerId);
    const nextDealerId = nextDealer ? nextDealer._id : null;

    if (previousDealerId === nextDealerId) {
      return apiSuccess({
        id: quotationId,
        dealerId: previousDealerId,
        assignedBy: existing.assignedBy ?? null,
        assignedOn: existing.assignedOn ?? null,
        changed: false,
      });
    }

    const previousDealer =
      previousDealerId === null ? null : await AdminUser.findById(previousDealerId).lean();

    const nextAllocated = Number(nextDealer?.discountAllocationPercent || 0);
    const customerPct = Number(existing.customerDiscountPercent || 0);
    if (nextAllocated > 0 && customerPct > nextAllocated) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `This quotation's customer discount (${customerPct}%) exceeds the new dealer's allocated discount (${nextAllocated}%). Reduce the customer discount first.`,
        { field: "dealerId" }
      );
    }

    const rooms = await QuotationRoom.find({ quotationId }).select("_id").lean();
    const items = await QuotationItem.find({ quotationRoomId: { $in: rooms.map((r) => r._id) } })
      .select("quantity unitPrice")
      .lean();
    const subtotal = items.reduce((sum, it) => sum + (it.quantity || 1) * Number(it.unitPrice || 0), 0);
    const earningPercent = Math.max(0, nextAllocated - customerPct);
    const earningAmount = Math.round(((subtotal * earningPercent) / 100) * 100) / 100;

    const assignedOn = new Date();
    const previousAllocated = Number(existing.allocatedDiscountPercent || 0);

    const action: QuotationAuditAction =
      previousDealerId === null
        ? "quotation_assigned"
        : nextDealerId === null
          ? "quotation_unassigned"
          : "quotation_reassigned";

    const updated = await withTransaction(async (dbSession) => {
      const result = await Quotation.findByIdAndUpdate(
        quotationId,
        {
          $set: {
            dealerId: nextDealerId,
            assignedBy: nextDealerId === null ? null : userId,
            assignedOn: nextDealerId === null ? null : assignedOn,
            allocatedDiscountPercent: nextAllocated,
            estimatedEarningPercent: earningPercent,
            estimatedEarningAmount: mongoose.Types.Decimal128.fromString(earningAmount.toFixed(2)),
            updatedAt: assignedOn,
          },
        },
        { new: true, ...(dbSession ? { session: dbSession } : {}) }
      );
      if (!result) throw new ApiError("NOT_FOUND", "Quotation not found.");

      await recordQuotationEvent(
        {
          quotationId,
          action,
          performedBy: userId,
          previousValue: dealerSnapshot(previousDealer),
          newValue: dealerSnapshot(nextDealer),
          metadata: {
            previousAllocatedDiscountPercent: previousAllocated,
            newAllocatedDiscountPercent: nextAllocated,
          },
        },
        dbSession
      );
      return result;
    });

    return apiSuccess({
      id: quotationId,
      dealerId: updated.dealerId ?? null,
      assignedBy: updated.assignedBy ?? null,
      assignedOn: updated.assignedOn ?? null,
      allocatedDiscountPercent: updated.allocatedDiscountPercent,
      estimatedEarningPercent: updated.estimatedEarningPercent,
      changed: true,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/assign" });
  }
}
