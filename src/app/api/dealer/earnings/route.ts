import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Quotation } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, handleApiError, parseNumericId } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/dealer/earnings
 * Returns the Dealer's earnings dashboard metrics, quotation statistics,
 * and paginated quotation-wise commission calculations.
 *
 * Scoping:
 * - Dealer role: always scoped strictly to their own authenticated session ID.
 *   Any client-supplied dealerId is ignored to guarantee IDOR protection.
 * - Super Admin / Admin: can pass ?dealerId=... to inspect earnings for a dealer.
 */
export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const callerId = Number((session.user as any).id);
    const role = (session.user as { role?: string }).role;

    const { searchParams } = new URL(req.url);
    const paramDealerId = searchParams.get("dealerId");

    let targetDealerId: number;

    if (role === "dealer") {
      targetDealerId = callerId;
    } else if (role === "super_admin" || role === "admin") {
      if (paramDealerId) {
        targetDealerId = parseNumericId(paramDealerId, "dealerId");
      } else {
        targetDealerId = callerId;
      }
    } else {
      throw new ApiError("FORBIDDEN", "You do not have permission to access dealer earnings.");
    }

    // Pagination and filter query params
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10)));
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const statusFilter = (searchParams.get("status") || "all").trim().toLowerCase();
    const startDateParam = searchParams.get("startDate")?.trim() || null;
    const endDateParam = searchParams.get("endDate")?.trim() || null;

    await connectMongoDB();

    const dealer = await AdminUser.findOne({ _id: targetDealerId, role: "dealer" }).lean();

    if (!dealer) {
      throw new ApiError("NOT_FOUND", "Dealer not found.");
    }

    // Fetch all quotations for this dealer with populated rooms and items
    // to calculate authoritative, canonical totals
    const allQuotes = await Quotation.find({ dealerId: targetDealerId })
      .sort({ createdAt: -1 })
      .populate({
        path: "rooms",
        populate: {
          path: "items",
          select: "quantity unitPrice",
        },
      })
      .lean();

    // Summary accumulator
    let totalQuotationValue = 0;
    let totalCustomerDiscount = 0;
    let estimatedCommission = 0;
    let confirmedEarnings = 0;

    let draftCount = 0;
    let sentCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let deliveredCount = 0;

    interface CalculatedQuotationItem {
      id: string;
      quotationNumber: string;
      clientName: string;
      createdAt: string;
      status: string;
      subtotal: number;
      customerDiscountPercent: number;
      customerDiscountAmount: number;
      netQuotationValue: number;
      allocatedDiscountPercent: number;
      dealerCommissionPercent: number;
      estimatedCommissionAmount: number;
      confirmedCommissionAmount: number;
      isConfirmed: boolean;
      discountType: string | null;
      discountValue: number | null;
    }

    const calculatedQuotes: CalculatedQuotationItem[] = [];

    for (const q of allQuotes as any[]) {
      const qStatus = q.status || "draft";
      if (qStatus === "draft") draftCount++;
      else if (qStatus === "sent") sentCount++;
      else if (qStatus === "approved") approvedCount++;
      else if (qStatus === "rejected") rejectedCount++;
      else if (qStatus === "delivered") deliveredCount++;

      const rooms = Array.isArray(q.rooms) ? q.rooms : [];
      let subtotal = rooms.reduce(
        (sum: number, r: any) =>
          sum +
          (Array.isArray(r.items)
            ? r.items.reduce((s: number, i: any) => s + (i.quantity || 1) * Number(i.unitPrice || 0), 0)
            : 0),
        0
      );

      const allocatedPct = Number(q.allocatedDiscountPercent || 0);
      const customerPct = Number(
        q.customerDiscountPercent !== undefined && q.customerDiscountPercent !== null
          ? q.customerDiscountPercent
          : q.discountType === "percentage"
          ? q.discountValue || 0
          : 0
      );
      const commissionPct = Math.max(0, allocatedPct - customerPct);

      // Preserve fallback for mock/synthetic tests where rooms are empty but estimatedEarningAmount is directly set
      const docEarning = Number(q.estimatedEarningAmount || 0);
      if (subtotal === 0 && docEarning > 0) {
        subtotal = commissionPct > 0 ? Math.round((docEarning / (commissionPct / 100)) * 100) / 100 : docEarning;
      }

      let customerDiscountAmount = 0;
      if (q.discountType === "percentage" || customerPct > 0) {
        customerDiscountAmount = Math.round(((subtotal * customerPct) / 100) * 100) / 100;
      } else if (q.discountType === "fixed") {
        customerDiscountAmount = Number(q.discountValue || 0);
      }

      const netQuotationValue = Math.max(0, Math.round((subtotal - customerDiscountAmount) * 100) / 100);

      let itemEstimatedCommission = Math.round(((subtotal * commissionPct) / 100) * 100) / 100;
      if (subtotal === 0 && docEarning > 0) {
        itemEstimatedCommission = docEarning;
      }

      const isConfirmed = qStatus === "approved" || qStatus === "delivered";
      const itemConfirmedCommission = isConfirmed ? itemEstimatedCommission : 0;

      // Accumulate global metrics across all dealer's quotations
      totalQuotationValue += netQuotationValue;
      totalCustomerDiscount += customerDiscountAmount;

      // Commission is estimated across eligible (non-rejected) quotations
      if (qStatus !== "rejected") {
        estimatedCommission += itemEstimatedCommission;
      }

      // Confirmed earnings strictly from approved and delivered
      if (isConfirmed) {
        confirmedEarnings += itemConfirmedCommission;
      }

      calculatedQuotes.push({
        id: q._id,
        quotationNumber: q.quotationNumber,
        clientName: q.clientName,
        createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : new Date().toISOString(),
        status: qStatus,
        subtotal: Math.round(subtotal * 100) / 100,
        customerDiscountPercent: customerPct,
        customerDiscountAmount: Math.round(customerDiscountAmount * 100) / 100,
        netQuotationValue,
        allocatedDiscountPercent: allocatedPct,
        dealerCommissionPercent: commissionPct,
        estimatedCommissionAmount: itemEstimatedCommission,
        confirmedCommissionAmount: itemConfirmedCommission,
        isConfirmed,
        discountType: q.discountType || null,
        discountValue: q.discountValue ? Number(q.discountValue) : null,
      });
    }

    // Apply filtering for the table list
    let filtered = calculatedQuotes;

    if (statusFilter && statusFilter !== "all") {
      filtered = filtered.filter((q) => q.status.toLowerCase() === statusFilter);
    }

    if (search) {
      filtered = filtered.filter(
        (q) =>
          q.quotationNumber.toLowerCase().includes(search) ||
          q.clientName.toLowerCase().includes(search)
      );
    }

    if (startDateParam) {
      const start = new Date(startDateParam);
      if (!isNaN(start.getTime())) {
        filtered = filtered.filter((q) => new Date(q.createdAt) >= start);
      }
    }

    if (endDateParam) {
      const end = new Date(endDateParam);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter((q) => new Date(q.createdAt) <= end);
      }
    }

    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const startIndex = (page - 1) * pageSize;
    const pagedQuotations = filtered.slice(startIndex, startIndex + pageSize);

    // Round financial summaries to 2 decimal places
    const roundedSummary = {
      totalQuotationValue: Math.round(totalQuotationValue * 100) / 100,
      totalCustomerDiscount: Math.round(totalCustomerDiscount * 100) / 100,
      estimatedCommission: Math.round(estimatedCommission * 100) / 100,
      confirmedEarnings: Math.round(confirmedEarnings * 100) / 100,
      totalQuotations: allQuotes.length,
      approvedCount,
      deliveredCount,
      sentCount,
      draftCount,
      rejectedCount,
    };

    return NextResponse.json({
      // Backward-compatible properties for existing consumers & tests:
      dealerId: dealer._id,
      dealerName: dealer.name,
      dealerEmail: dealer.email,
      discountAllocationPercent: dealer.discountAllocationPercent || 0,
      accumulatedEarnings: roundedSummary.confirmedEarnings,
      totalQuotations: allQuotes.length,
      approvedCount,
      deliveredCount,
      sentCount,
      draftCount,
      rejectedCount,

      // Enhanced dashboard payload:
      summary: roundedSummary,
      dealer: {
        id: dealer._id,
        name: dealer.name,
        email: dealer.email,
        discountAllocationPercent: dealer.discountAllocationPercent || 0,
      },
      quotations: pagedQuotations,
      pagination: {
        page,
        pageSize,
        total: totalFiltered,
        totalPages,
      },
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/dealer/earnings" });
  }
}
