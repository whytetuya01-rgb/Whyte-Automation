import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, HouseType } from "@/models";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationSchema } from "@/lib/validation/quotation";

import { normalizeQuotation } from "@/lib/quotationNormalization";
import { redactQuotationForRole } from "@/lib/variantRedaction";
import { calculateDealerEarning, customerDiscountError, subtotalFromRooms, toPlainNumber } from "@/lib/dealerEarnings";
import { attachQuotationActors } from "@/lib/quotationActors";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import { canModifyQuotation, canViewQuotation } from "@/lib/quotationAccess";

type RouteContext = { params: Promise<{ id: string }> };

async function fetchPopulatedQuotation(quotationId: string) {
  return Quotation.findById(quotationId)
    .populate({ path: "houseType" })
    .populate({ path: "dealer", select: "id name email firstName lastName contactNumber gstNumber" })
    .populate({
      path: "rooms",
      options: { sort: { sortOrder: 1 } },
      populate: [
        { path: "roomType" },
        {
          path: "items",
          options: { sort: { sortOrder: 1 } },
          // Only the fields the editor/proposal/PDF actually render for a
          // quoted item's product/variant — never the catalog's full variant
          // list (price/cost included), which duplicated the whole catalog
          // into every quotation response. Price itself was never read from
          // here either way: it lives on the item (`unitPrice` etc.), set
          // once when the item was added/changed. See `AGENTS.md`/Phase 3
          // audit and `QuotationItemVariantSummary` in `@/types`.
          populate: [
            {
              path: "product",
              select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes",
            },
            {
              path: "productVariant",
              select: "surfaceFinish automationTier",
            },
          ],
        },
      ],
    })
    .lean({ virtuals: true });
}

/**
 * Session required for read, update and delete. Quotations are business data,
 * so the former anonymous proposal flow no longer applies here; `src/proxy.ts`
 * rejects unauthenticated requests before they reach this file.
 */

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();
    const quotation = await fetchPopulatedQuotation(quotationId);

    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    // Role-based access control: Dealers can only access their own quotations
    if (!canViewQuotation(role, userId, quotation)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
    }

    // Filter out bathroom-like rooms per business rule
    const rawRooms = Array.isArray((quotation as any).rooms) ? (quotation as any).rooms : [];
    const filteredRooms = rawRooms.filter(
      (room: any) => !isBathroomLikeRoomName(room.roomType?.name)
    );

    const [withActors] = await attachQuotationActors([quotation]);
    const normalized = normalizeQuotation({
      ...withActors,
      rooms: filteredRooms,
    });

    // GET responses stay unwrapped for existing consumers. Internal margin
    // fields (cost / purchaseTaxPercent) on each item's product/variant are
    // never sent to a non-admin role.
    return NextResponse.json(redactQuotationForRole(normalized, role));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]" });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();

    const existing = await Quotation.findById(quotationId).populate({
      path: "rooms",
      populate: { path: "items" },
    });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    // LOCK: Approved or Delivered quotations cannot be modified through normal edit APIs
    if (existing.status === "approved" || existing.status === "delivered") {
      throw new ApiError(
        "FORBIDDEN",
        `Quotation is ${existing.status} and cannot be edited. Please clone the quotation to make revisions.`
      );
    }

    // Role-based access control: Dealers can only modify their own quotations
    if (!canModifyQuotation(role, userId, existing)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const parsed = updateQuotationSchema.parse(await readJsonBody(req));
    const { houseTypeId, discountValue, customerDiscountPercent, status: nextStatus, ...rest } = parsed;

    // Dealers cannot change status directly or alter allocated discount
    if (role === "dealer" && nextStatus && nextStatus !== existing.status) {
      throw new ApiError("FORBIDDEN", "Dealers cannot manually change quotation status.");
    }

    const data: Record<string, unknown> = { ...rest };

    if (nextStatus) {
      data.status = nextStatus;
    }

    // Approve / reject / deliver change earnings and carry their own audit trail, so
    // they only happen through POST /api/quotations/[id]/transition.
    if (nextStatus && nextStatus !== existing.status && ["approved", "rejected", "delivered"].includes(nextStatus)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Use the approval workflow to approve, reject or deliver a quotation.",
        { field: "status" }
      );
    }

    // Customer discount validation against the quotation's allocation snapshot.
    // A dealer-owned quotation is capped at its snapshot, including 0%.
    const allocated = toPlainNumber(existing.allocatedDiscountPercent);
    const hasDealer = existing.dealerId !== null && existing.dealerId !== undefined;
    const requestedPercent =
      customerDiscountPercent !== undefined && customerDiscountPercent !== null
        ? Number(customerDiscountPercent)
        : parsed.discountType === "percentage" && discountValue !== undefined && discountValue !== null
        ? Number(discountValue)
        : undefined;

    const existingRooms = (existing as unknown as { rooms?: Parameters<typeof subtotalFromRooms>[0] }).rooms;
    const subtotal = subtotalFromRooms(existingRooms);

    if (requestedPercent !== undefined) {
      const nextCust = Number(requestedPercent);
      const discountError = customerDiscountError({
        hasDealer,
        allocatedPercent: allocated,
        customerPercent: nextCust,
        actorIsDealer: role === "dealer",
      });
      if (discountError) {
        throw new ApiError("VALIDATION_ERROR", discountError, { field: "customerDiscountPercent" });
      }
      const { earningPercent, earningAmount } = calculateDealerEarning({
        subtotal,
        allocatedPercent: allocated,
        customerPercent: nextCust,
      });
      data.customerDiscountPercent = nextCust;
      data.estimatedEarningPercent = earningPercent;
      data.discountType = nextCust > 0 ? "percentage" : "none";
      data.discountValue = nextCust > 0 ? mongoose.Types.Decimal128.fromString(nextCust.toFixed(2)) : null;
      data.estimatedEarningAmount = mongoose.Types.Decimal128.fromString(earningAmount.toFixed(2));
    } else if (parsed.discountType === "fixed" && discountValue !== undefined) {
      const fixedVal = discountValue === null ? 0 : Number(discountValue);
      if (hasDealer && fixedVal > 0) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Dealer quotations only support a percentage customer discount within the allocated discount.",
          { field: "discountType" }
        );
      }
      const { earningPercent, earningAmount } = calculateDealerEarning({
        subtotal,
        allocatedPercent: allocated,
        customerPercent: 0,
      });
      data.discountType = fixedVal > 0 ? "fixed" : "none";
      data.discountValue = fixedVal > 0 ? mongoose.Types.Decimal128.fromString(fixedVal.toFixed(2)) : null;
      data.customerDiscountPercent = 0;
      data.estimatedEarningPercent = earningPercent;
      data.estimatedEarningAmount = mongoose.Types.Decimal128.fromString(earningAmount.toFixed(2));
    } else if (discountValue !== undefined) {
      data.discountValue =
        discountValue === null
          ? null
          : mongoose.Types.Decimal128.fromString(discountValue.toFixed(2));
    }

    if (houseTypeId !== undefined) {
      if (houseTypeId !== null) {
        const houseType = await HouseType.findById(houseTypeId).select("_id").lean();
        if (!houseType) {
          throw new ApiError("NOT_FOUND", "House type not found.", { field: "houseTypeId" });
        }
      }
      data.houseTypeId = houseTypeId;
    }

    data.updatedAt = new Date();

    const quotation = await Quotation.findByIdAndUpdate(quotationId, { $set: data }, { new: true });
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (nextStatus && nextStatus !== existing.status) {
      await recordQuotationEvent({
        quotationId,
        action: "status_changed",
        performedBy: userId,
        previousValue: { status: existing.status },
        newValue: { status: nextStatus },
      });
    }

    const populated = await fetchPopulatedQuotation(quotationId);
    const rawRooms = Array.isArray((populated as any)?.rooms) ? (populated as any).rooms : [];
    const filteredRooms = rawRooms.filter(
      (room: any) => !isBathroomLikeRoomName(room.roomType?.name)
    );

    const [populatedWithActors] = await attachQuotationActors([populated ?? {}]);
    const normalized = normalizeQuotation({
      ...populatedWithActors,
      rooms: filteredRooms,
    });

    return apiSuccess(redactQuotationForRole(normalized, role));
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/quotations/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const quotationId = parseQuotationId(id);
    await connectMongoDB();

    const target = await Quotation.findById(quotationId);
    if (!target) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (target.status === "approved" || target.status === "delivered") {
      throw new ApiError(
        "FORBIDDEN",
        `Quotation is ${target.status} and cannot be deleted. Approved records must be preserved for earnings and audit history.`
      );
    }

    if (!canModifyQuotation(role, userId, target)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to delete this quotation.");
    }

    const deleted = await withTransaction(async (dbSession) => {
      const roomsQuery = QuotationRoom.find({ quotationId }, { _id: 1 });
      if (dbSession) roomsQuery.session(dbSession);
      const rooms = await roomsQuery;
      const roomIds = rooms.map((room) => room._id);

      // Quotation rooms and items have no meaning without their parent quotation,
      // so they are always removed with it. The counts are reported back.
      let deletedItems = 0;
      if (roomIds.length > 0) {
        const itemQuery = QuotationItem.deleteMany(
          { quotationRoomId: { $in: roomIds } },
          dbSession ? { session: dbSession } : undefined
        );
        const itemResult = await itemQuery;
        deletedItems = itemResult.deletedCount ?? 0;
      }

      if (dbSession) {
        await QuotationRoom.deleteMany({ quotationId }, { session: dbSession });
      } else {
        await QuotationRoom.deleteMany({ quotationId });
      }

      const deleteQuotationQuery = Quotation.findByIdAndDelete(quotationId);
      if (dbSession) deleteQuotationQuery.session(dbSession);
      const removed = await deleteQuotationQuery;

      if (!removed) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }

      return { rooms: roomIds.length, items: deletedItems };
    });

    return apiSuccess({ id: quotationId, deleted: true, ...deleted });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/quotations/[id]" });
  }
}
