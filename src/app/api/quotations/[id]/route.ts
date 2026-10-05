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
          populate: [
            {
              path: "product",
              populate: {
                path: "variants",
                match: { isActive: true },
                options: { sort: { sortOrder: 1 } },
              },
            },
            {
              path: "productVariant",
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
    if (role === "dealer" && quotation.dealerId !== userId) {
      throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
    }

    // Filter out bathroom-like rooms per business rule
    const rawRooms = Array.isArray((quotation as any).rooms) ? (quotation as any).rooms : [];
    const filteredRooms = rawRooms.filter(
      (room: any) => !isBathroomLikeRoomName(room.roomType?.name)
    );

    const normalized = normalizeQuotation({
      ...quotation,
      rooms: filteredRooms,
    });

    // GET responses stay unwrapped for existing consumers.
    return NextResponse.json(normalized);
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
    if (role === "dealer" && existing.dealerId !== userId) {
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

    // Customer discount validation against allocated snapshot
    const allocated = existing.allocatedDiscountPercent || 0;
    const requestedPercent =
      customerDiscountPercent !== undefined && customerDiscountPercent !== null
        ? Number(customerDiscountPercent)
        : parsed.discountType === "percentage" && discountValue !== undefined && discountValue !== null
        ? Number(discountValue)
        : undefined;

    if (requestedPercent !== undefined) {
      const nextCust = Number(requestedPercent);
      if (allocated > 0 && nextCust > allocated) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Customer discount of ${nextCust}% cannot exceed the allocated discount of ${allocated}%.`,
          { field: "customerDiscountPercent" }
        );
      }
      data.customerDiscountPercent = nextCust;
      data.estimatedEarningPercent = Math.max(0, allocated - nextCust);
      data.discountType = nextCust > 0 ? "percentage" : "none";
      data.discountValue = nextCust > 0 ? mongoose.Types.Decimal128.fromString(nextCust.toFixed(2)) : null;

      // Recalculate estimated earning amount based on current subtotal
      const rooms = Array.isArray((existing as any).rooms) ? (existing as any).rooms : [];
      const subtotal = rooms.reduce(
        (sum: number, r: any) =>
          sum +
          (Array.isArray(r.items)
            ? r.items.reduce((s: number, i: any) => s + (i.quantity || 1) * Number(i.unitPrice || 0), 0)
            : 0),
        0
      );
      const earningAmount = ((subtotal * Number(data.estimatedEarningPercent)) / 100).toFixed(2);
      data.estimatedEarningAmount = mongoose.Types.Decimal128.fromString(earningAmount);
    } else if (parsed.discountType === "fixed" && discountValue !== undefined) {
      const fixedVal = discountValue === null ? 0 : Number(discountValue);
      data.discountType = fixedVal > 0 ? "fixed" : "none";
      data.discountValue = fixedVal > 0 ? mongoose.Types.Decimal128.fromString(fixedVal.toFixed(2)) : null;
      data.customerDiscountPercent = 0;
      data.estimatedEarningPercent = allocated;
      const rooms = Array.isArray((existing as any).rooms) ? (existing as any).rooms : [];
      const subtotal = rooms.reduce(
        (sum: number, r: any) =>
          sum +
          (Array.isArray(r.items)
            ? r.items.reduce((s: number, i: any) => s + (i.quantity || 1) * Number(i.unitPrice || 0), 0)
            : 0),
        0
      );
      const earningAmount = ((subtotal * allocated) / 100).toFixed(2);
      data.estimatedEarningAmount = mongoose.Types.Decimal128.fromString(earningAmount);
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

    const populated = await fetchPopulatedQuotation(quotationId);
    const rawRooms = Array.isArray((populated as any)?.rooms) ? (populated as any).rooms : [];
    const filteredRooms = rawRooms.filter(
      (room: any) => !isBathroomLikeRoomName(room.roomType?.name)
    );

    const normalized = normalizeQuotation({
      ...populated,
      rooms: filteredRooms,
    });

    return apiSuccess(normalized);
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

    if (role === "dealer" && target.dealerId !== userId) {
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
