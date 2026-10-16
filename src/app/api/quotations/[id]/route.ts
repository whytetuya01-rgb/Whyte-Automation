import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, HouseType } from "@/models";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationSchema } from "@/lib/validation/quotation";

import { normalizeQuotation } from "@/lib/quotationNormalization";
import { redactQuotationForRole } from "@/lib/variantRedaction";
import { calculateDealerEarning, customerDiscountError, toPlainNumber } from "@/lib/dealerEarnings";
import { eligibleSubtotalFromRooms } from "@/lib/quotationTotals";
import { attachQuotationActors } from "@/lib/quotationActors";
import { recordQuotationEvent } from "@/lib/quotationAudit";
import { canDeleteQuotation, canModifyQuotation, canViewQuotation, isAdminRole } from "@/lib/quotationAccess";
import { hasPermission } from "@/lib/permissions";
import { requireActiveDealer, requireActiveSalesExecutive } from "@/lib/quotationOwnership";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

type RouteContext = { params: Promise<{ id: string }> };

async function fetchPopulatedQuotation(quotationId: string) {
  return Quotation.findById(quotationId)
    .populate({ path: "houseType" })
    .populate({ path: "dealer", select: "id name email firstName lastName contactNumber companyName gstNumber businessEmail address" })
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
              // `isDeleted` added so the response can flag an unavailable
              // product without exposing anything else from the catalog.
              path: "product",
              select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes isDeleted",
            },
            {
              path: "productVariant",
              select: "surfaceFinish automationTier isDeleted",
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
    return await withSession(async ({ role, userId, permissions }) => {
      const { id } = await context.params;
      const quotationId = parseQuotationId(id);

      await connectMongoDB();
      const quotation = await fetchPopulatedQuotation(quotationId);

      if (!quotation) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }

      // Role-based access control: Dealers can only access their own quotations
      if (!canViewQuotation(role, userId, quotation, permissions)) {
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
      // never sent to an unprivileged role.
      return NextResponse.json(redactQuotationForRole(normalized, role, permissions));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]" });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const { id } = await context.params;
      const quotationId = parseQuotationId(id);

      await connectMongoDB();

      // Minimal nested populate (just `isDeleted`) so the eligible-subtotal
      // check below can tell a soft-deleted product/variant/room type apart
      // from a legacy/missing reference — see `eligibleSubtotalFromRooms`.
      const existing = await Quotation.findById(quotationId).populate({
        path: "rooms",
        populate: [
          { path: "roomType", select: "isDeleted" },
          { path: "items", populate: [{ path: "product", select: "isDeleted" }, { path: "productVariant", select: "isDeleted" }] },
        ],
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
      if (!canModifyQuotation(role, userId, existing, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
      }

      const parsed = updateQuotationSchema.parse(await readJsonBody(req));
      const {
        houseTypeId,
        discountValue,
        customerDiscountPercent,
        status: nextStatus,
        dealerId: requestedDealerId,
        assignedSalesId: requestedSalesId,
        ...rest
      } = parsed;

      const normRole = (role || "").trim().toLowerCase();

      // Dealers and Sales Executives cannot change status directly
      if ((normRole === "dealer" || normRole === "sales_executive") && nextStatus && nextStatus !== existing.status) {
        throw new ApiError(
          "FORBIDDEN",
          `${normRole === "dealer" ? "Dealers" : "Sales Executives"} cannot manually change quotation status.`
        );
      }

      // Dealers and Sales Executives cannot reassign quotation ownership or salesperson
      if ((normRole === "dealer" || normRole === "sales_executive") && (requestedDealerId !== undefined || requestedSalesId !== undefined)) {
        throw new ApiError("FORBIDDEN", "Only Administrators can modify quotation assignments.");
      }

      const data: Record<string, unknown> = { ...rest };

      if (requestedDealerId !== undefined) {
        if (!hasPermission(role, permissions, "quotations:assign_dealer")) {
          throw new ApiError("FORBIDDEN", "You do not have permission to assign dealers.");
        }
        if (requestedDealerId === null) {
          data.dealerId = null;
        } else {
          const d = await requireActiveDealer(requestedDealerId, existing.companyId);
          data.dealerId = d._id;
        }
      }

      if (requestedSalesId !== undefined) {
        if (!hasPermission(role, permissions, "quotations:assign_sales")) {
          throw new ApiError("FORBIDDEN", "You do not have permission to assign sales executives.");
        }
        if (requestedSalesId === null) {
          data.assignedSalesId = null;
        } else {
          const s = await requireActiveSalesExecutive(requestedSalesId, existing.companyId);
          data.assignedSalesId = s._id;
        }
      }

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

      const existingRooms = (existing as unknown as { rooms?: Parameters<typeof eligibleSubtotalFromRooms>[0] }).rooms;
      const subtotal = eligibleSubtotalFromRooms(existingRooms, existing.status);

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

      return apiSuccess(redactQuotationForRole(normalized, role, permissions));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/quotations/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    return await withSession(async ({ session, role, userId, permissions }) => {
      const actor = actorFromSession(session);

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

      if (!canDeleteQuotation(role, userId, target, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to delete this quotation.");
      }

      // Soft delete. Quotation rooms and items have no meaning without their
      // parent quotation, so they are cascaded with it — but, like the
      // quotation itself, never physically removed: an approved/delivered
      // quotation can never reach this path anyway (blocked above), and a
      // draft/sent/rejected one that gets deleted keeps its full snapshot
      // (pricing, GST, discounts, room/item detail) intact for audit purposes,
      // just hidden from normal listings. Items are matched through their room
      // BEFORE rooms are cascaded, so the lookup still sees live rooms.
      const result = await softDeleteOne({
        model: Quotation,
        entityType: "quotation",
        id: quotationId,
        actor,
        label: target.quotationNumber,
        cascade: [
          {
            entityType: "quotationItem",
            model: QuotationItem,
            match: async (parentId) => {
              const roomIds = await QuotationRoom.find({ quotationId: String(parentId) }).distinct("_id");
              return { quotationRoomId: { $in: roomIds } };
            },
          },
          { entityType: "quotationRoom", model: QuotationRoom, foreignField: "quotationId" },
        ],
      });

      const rooms = result.cascade.find((c) => c.entityType === "quotationRoom")?.count ?? 0;
      const items = result.cascade.find((c) => c.entityType === "quotationItem")?.count ?? 0;

      return apiSuccess({ id: quotationId, deleted: true, rooms, items });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/quotations/[id]" });
  }
}
