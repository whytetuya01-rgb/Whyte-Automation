import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, HouseTypeRoomTemplate, HouseType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createQuotationSchema } from "@/lib/validation/quotation";
import {
  parseIntQueryParam,
  parseSearchQueryParam,
  parseStringQueryParam,
} from "@/lib/validation/common";
import { calculateQuotationGst } from "@/lib/pricing";
import { calculateDealerEarning, customerDiscountError } from "@/lib/dealerEarnings";
import { attachQuotationActors } from "@/lib/quotationActors";
import { resolveNewQuotationOwnership } from "@/lib/quotationOwnership";
import { dealerVisibilityFilter } from "@/lib/quotationAccess";
import { dealerSnapshot, recordQuotationEvents } from "@/lib/quotationAudit";

export const dynamic = "force-dynamic";

/**
 * Session required: quotations are business data, so listing and creating them
 * is no longer part of the anonymous proposal flow. `src/proxy.ts` blocks
 * unauthenticated requests up front; this call is the defence-in-depth check
 * that keeps the handler correct if the route is ever called directly.
 */

const SORT_OPTIONS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  number_asc: { quotationNumber: 1 },
  number_desc: { quotationNumber: -1 },
};

const STATUS_VALUES = ["draft", "sent", "approved", "rejected", "delivered"] as const;

const POPULATE_OPTIONS = [
  { path: "houseType", select: "id name" },
  {
    path: "dealer",
    select: "id name email firstName lastName contactNumber gstNumber",
  },
  {
    path: "rooms",
    populate: { path: "items", select: "quantity unitPrice" },
  },
];

interface QuotationListItem {
  rooms: Array<{ items?: Array<{ quantity?: number; unitPrice?: unknown }> }>;
  discountType?: string | null;
  discountValue?: unknown;
  allocatedDiscountPercent?: number;
  customerDiscountPercent?: number;
  estimatedEarningPercent?: number;
  estimatedEarningAmount?: unknown;
}

/** Derived totals the quotation list renders. */
function withDerivedTotals(quotation: Record<string, unknown>): Record<string, unknown> {
  const rooms = Array.isArray(quotation.rooms) ? (quotation.rooms as QuotationListItem["rooms"]) : [];
  const roomCount = rooms.length;
  const productsCount = rooms.reduce(
    (sum, room) =>
      sum +
      (Array.isArray(room.items)
        ? room.items.reduce((itemSum, item) => itemSum + (item.quantity || 1), 0)
        : 0),
    0
  );
  const subtotal = rooms.reduce(
    (sum, room) =>
      sum +
      (Array.isArray(room.items)
        ? room.items.reduce(
            (itemSum, item) => itemSum + (item.quantity || 1) * Number(item.unitPrice || 0),
            0
          )
        : 0),
    0
  );

  let discount = 0;
  if (quotation.discountType === "percentage") {
    discount = (subtotal * Number(quotation.discountValue || 0)) / 100;
  } else if (quotation.discountType === "fixed") {
    discount = Number(quotation.discountValue || 0);
  }

  const allocatedPct = Number(quotation.allocatedDiscountPercent || 0);
  const customerPct = Number(
    quotation.customerDiscountPercent !== undefined && quotation.customerDiscountPercent !== null
      ? quotation.customerDiscountPercent
      : quotation.discountType === "percentage"
      ? quotation.discountValue || 0
      : 0
  );
  const earningPct = Math.max(0, allocatedPct - customerPct);
  const earningAmount = Math.round(((subtotal * earningPct) / 100) * 100) / 100;

  const gst = calculateQuotationGst(subtotal, discount);

  const toNum = (v: any) => { if (v == null) return 0; if (typeof v === 'object' && v && typeof v.toString === 'function') return Number(v.toString()); const n = Number(v); return Number.isNaN(n) ? 0 : n; };
  const toStr = (v: any) => { if (v == null) return null; if (typeof v === 'object' && v && typeof v.toString === 'function') return v.toString(); return String(v); };
  return {
    ...quotation,
    discountValue: toStr(quotation.discountValue) ?? (toNum(quotation.discountValue) || null),
    roomsCount: roomCount,
    productsCount,
    subtotal: gst.grossSubtotal,
    discountAmount: gst.discountAmount,
    netSubtotal: gst.netSubtotal,
    cgstPercent: gst.cgstPercent,
    cgstAmount: gst.cgstAmount,
    sgstPercent: gst.sgstPercent,
    sgstAmount: gst.sgstAmount,
    totalGstAmount: gst.totalGstAmount,
    totalAmount: gst.grandTotal,
    grandTotal: gst.grandTotal,
    allocatedDiscountPercent: allocatedPct,
    customerDiscountPercent: customerPct,
    estimatedEarningPercent: earningPct,
    estimatedEarningAmount: earningAmount,
  };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { searchParams } = new URL(req.url);
    const isPaginated = searchParams.has("page") || searchParams.has("pageSize");
    const searchParam = parseSearchQueryParam(searchParams, "search", { max: 100 });
    const statusParam = parseStringQueryParam(searchParams, "status", { max: 20 });
    const sortParam = parseStringQueryParam(searchParams, "sort", { max: 20 });

    if (statusParam && statusParam !== "all" && !STATUS_VALUES.includes(statusParam as never)) {
      throw new ApiError("INVALID_FIELD", `Status must be one of: ${STATUS_VALUES.join(", ")}.`, {
        field: "status",
      });
    }
    if (sortParam && !SORT_OPTIONS[sortParam]) {
      throw new ApiError("INVALID_FIELD", "Sort must be one of: newest, oldest, number_asc, number_desc.", {
        field: "sort",
      });
    }

    await connectMongoDB();
    const filter: Record<string, unknown> = {};

    // Role-based visibility enforcement (applied in the query, never after the fact).
    if (role === "dealer") {
      // Dealers see quotations assigned to them or created by them. Any creator /
      // dealer filters in the URL are ignored so they cannot widen this scope.
      filter.$or = dealerVisibilityFilter(userId).$or;
    } else {
      // Super Admin & Admin can view all, optionally narrowed by assigned dealer or creator.
      const dealerIdParam = parseIntQueryParam(searchParams, "dealerId");
      if (dealerIdParam !== undefined) filter.dealerId = dealerIdParam;

      const createdByParam = parseIntQueryParam(searchParams, "createdBy", { min: 1 });
      if (createdByParam !== undefined) filter.createdBy = String(createdByParam);

      // `mine=true`: quotations the caller created themselves.
      if (searchParams.get("mine") === "true") filter.createdBy = String(userId);
    }

    if (statusParam && statusParam !== "all") {
      filter.status = statusParam;
    }

    if (searchParam) {
      const searchRegex = new RegExp(searchParam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchConditions = [
        { clientName: { $regex: searchRegex } },
        { quotationNumber: { $regex: searchRegex } },
        { clientPhone: { $regex: searchRegex } },
        { clientEmail: { $regex: searchRegex } },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const sortOptions = (sortParam && SORT_OPTIONS[sortParam]) || SORT_OPTIONS.newest;

    if (isPaginated) {
      const paginationParams = parsePaginationParams(searchParams, {
        defaultPageSize: 10,
        maxPageSize: 100,
      });
      // parsePaginationParams silently falls back for garbage input; reject it
      // explicitly so `?page=abc` can never reach Mongo as NaN.
      parseIntQueryParam(searchParams, "page", { min: 1 });
      parseIntQueryParam(searchParams, "pageSize", { min: 1, max: 100 });

      const [total, quotations] = await Promise.all([
        Quotation.countDocuments(filter),
        Quotation.find(filter)
          .sort(sortOptions)
          .skip(paginationParams.skip)
          .limit(paginationParams.take)
          .populate(POPULATE_OPTIONS),
      ]);

    const result = await attachQuotationActors(
      quotations.map((doc) => {
        const json = (typeof doc.toJSON === "function" ? doc.toJSON() : doc) as unknown as Record<
          string,
          unknown
        >;
        return withDerivedTotals(json);
      })
    );

    // GET responses stay unwrapped for existing consumers.
    return NextResponse.json(createPaginatedResponse(result, total, paginationParams));
  }

    const quotations = await Quotation.find(filter).sort(sortOptions).populate(POPULATE_OPTIONS);
    const result = await attachQuotationActors(
      quotations.map((doc) => {
        const json = (typeof doc.toJSON === "function" ? doc.toJSON() : doc) as unknown as Record<
          string,
          unknown
        >;
        return withDerivedTotals(json);
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations" });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    await connectMongoDB();
    const input = createQuotationSchema.parse(await readJsonBody(req));
    const { houseTypeId, discountValue, customerDiscountPercent, dealerId, ...rest } = input;

    // Ownership is derived from the authenticated session. Only the optional
    // `dealerId` (the dealer to assign to) comes from the client, and it is
    // validated against the caller's role.
    const ownership = await resolveNewQuotationOwnership({ role, userId, requestedDealerId: dealerId });
    const targetDealerId = ownership.dealerId;
    const allocatedPercent = ownership.allocatedPercent;

    const requestedCustomerDiscount =
      customerDiscountPercent !== undefined && customerDiscountPercent !== null
        ? Number(customerDiscountPercent)
        : (rest.discountType === "percentage" && discountValue !== undefined && discountValue !== null ? Number(discountValue) : 0);

    const hasDealer = targetDealerId !== null;
    const discountError = customerDiscountError({
      hasDealer,
      allocatedPercent,
      customerPercent: requestedCustomerDiscount,
      actorIsDealer: role === "dealer",
    });
    if (discountError) {
      throw new ApiError("VALIDATION_ERROR", discountError, { field: "customerDiscountPercent" });
    }
    if (hasDealer && rest.discountType === "fixed" && Number(discountValue ?? 0) > 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Dealer quotations only support a percentage customer discount within the allocated discount.",
        { field: "discountType" }
      );
    }

    const { earningPercent } = calculateDealerEarning({
      subtotal: 0,
      allocatedPercent,
      customerPercent: requestedCustomerDiscount,
    });

    if (houseTypeId) {
      const houseType = await HouseType.findById(houseTypeId).select("_id").lean();
      if (!houseType) {
        throw new ApiError("NOT_FOUND", "House type not found.", { field: "houseTypeId" });
      }
    }

    const createdOn = new Date();
    const year = createdOn.getFullYear();

    const createdQuotation = await withTransaction(async (dbSession) => {
      const seq = await getNextSequence(`quotationNumber_${year}`, undefined, dbSession);
      const quotationNumber = `QT-${year}-${String(seq).padStart(3, "0")}`;
      const quotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

      const finalDiscountType = requestedCustomerDiscount > 0 ? "percentage" : (rest.discountType ?? "none");
      const finalDiscountValue = requestedCustomerDiscount > 0
        ? mongoose.Types.Decimal128.fromString(requestedCustomerDiscount.toFixed(2))
        : (discountValue !== undefined && discountValue !== null ? mongoose.Types.Decimal128.fromString(discountValue.toFixed(2)) : null);

      const newQuotation = new Quotation({
        _id: quotationId,
        ...rest,
        quotationNumber,
        houseTypeId: houseTypeId ?? null,
        status: "draft",
        discountType: finalDiscountType,
        discountValue: finalDiscountValue,
        allocatedDiscountPercent: allocatedPercent,
        customerDiscountPercent: requestedCustomerDiscount,
        estimatedEarningPercent: earningPercent,
        dealerId: targetDealerId,
        assignedBy: ownership.assignedBy,
        assignedOn: ownership.assignedOn,
        assignedSalesId: null,
        createdBy: String(userId),
        createdAt: createdOn,
      });

      if (dbSession) {
        await newQuotation.save({ session: dbSession });
      } else {
        await newQuotation.save();
      }

      // Auto-create rooms from the house type template, inside the same
      // transaction so a quotation never exists with a partial room set.
      if (houseTypeId) {
        const template = await HouseTypeRoomTemplate.find({ houseTypeId })
          .sort({ sortOrder: 1 })
          .populate({ path: "roomType" })
          .session(dbSession ?? null);

        // `roomType` is a Mongoose virtual, so it is read from the lean output.
        const validTemplates = template.filter(
          (t) =>
            !isBathroomLikeRoomName(
              (t as unknown as { roomType?: { name?: string } | null }).roomType?.name
            )
        );

        const roomsToCreate = [];
        for (const t of validTemplates) {
          const defaultCount = Number(t.defaultCount) || 1;
          for (let i = 0; i < defaultCount; i++) {
            const nextRoomId = await getNextSequence("quotationRoom", QuotationRoom, dbSession);
            roomsToCreate.push({
              _id: nextRoomId,
              quotationId,
              roomTypeId: t.roomTypeId,
              sortOrder: t.sortOrder * 10 + i,
            });
          }
        }

        if (roomsToCreate.length > 0) {
          if (dbSession) {
            await QuotationRoom.insertMany(roomsToCreate, { session: dbSession });
          } else {
            await QuotationRoom.insertMany(roomsToCreate);
          }
        }
      }

      await recordQuotationEvents(
        [
          {
            quotationId,
            action: "quotation_created",
            performedBy: userId,
            newValue: { quotationNumber },
          },
          ...(ownership.assignedBy !== null
            ? [
                {
                  quotationId,
                  action: "quotation_assigned" as const,
                  performedBy: userId,
                  previousValue: null,
                  newValue: dealerSnapshot(ownership.dealer),
                  metadata: { duringCreation: true },
                },
              ]
            : []),
        ],
        dbSession
      );

      return newQuotation;
    });

    return apiSuccess(createdQuotation, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations" });
  }
}
