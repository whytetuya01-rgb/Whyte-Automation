import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, HouseTypeRoomTemplate, HouseType } from "@/models";
import { claimLeadForQuotation, finalizeLeadLink, recordCrmActivity, resolveOrCreateCustomer, validateQuotationLinks } from "@/lib/crmService";
import { reserveSequenceBlock } from "@/lib/counter";
import { issueQuotationNumber, withQuotationNumberRetry } from "@/lib/quotationNumber";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { withSession } from "@/lib/api-auth";
import { normalizeQuotation } from "@/lib/quotationNormalization";
import { hasPermission } from "@/lib/permissions";
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
import { dealerVisibilityFilter, salesExecutiveVisibilityFilter } from "@/lib/quotationAccess";
import { redactQuotationForRole } from "@/lib/variantRedaction";
import { dealerSnapshot, recordQuotationEvents } from "@/lib/quotationAudit";
import { isItemUnavailable, isProtectedQuotationStatus, isRoomUnavailable } from "@/lib/quotationAvailability";

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
    // `isDeleted` on roomType/product/productVariant is the ONLY extra field
    // added beyond what this list already needed — just enough for
    // `withDerivedTotals` to apply the same eligibility rule as the
    // quotation detail view (`quotationNormalization.ts`) and the dealer
    // earnings/homepage aggregation (`quotationTotals.ts`), never more.
    populate: [
      { path: "roomType", select: "isDeleted" },
      {
        path: "items",
        select: "quantity unitPrice productId productVariantId",
        populate: [
          { path: "product", select: "isDeleted" },
          { path: "productVariant", select: "isDeleted" },
        ],
      },
    ],
  },
];

interface QuotationListItem {
  roomTypeId?: unknown;
  roomType?: { isDeleted?: boolean | null } | null;
  items?: Array<{
    quantity?: number;
    unitPrice?: unknown;
    productId?: unknown;
    productVariantId?: unknown;
    product?: { isDeleted?: boolean | null } | null;
    productVariant?: { isDeleted?: boolean | null } | null;
  }>;
}

/**
 * Derived totals the quotation list renders — gated by the same
 * Approved/Delivered historical-preservation rule as everywhere else (see
 * `@/lib/quotationAvailability`): those keep every item/room unconditionally,
 * every other status excludes one whose catalog reference is soft-deleted.
 */
function withDerivedTotals(quotation: Record<string, unknown>): Record<string, unknown> {
  const rooms = Array.isArray(quotation.rooms) ? (quotation.rooms as QuotationListItem[]) : [];
  const roomCount = rooms.length;
  const protected_ = isProtectedQuotationStatus(quotation.status as string | null | undefined);

  let hasUnavailableItems = false;
  const eligibleItemsPerRoom = rooms.map((room) => {
    const roomDown = isRoomUnavailable(room);
    if (roomDown) hasUnavailableItems = true;
    const items = Array.isArray(room.items) ? room.items : [];
    return items.filter((item) => {
      const itemDown = isItemUnavailable(item, room);
      if (itemDown) hasUnavailableItems = true;
      return protected_ || (!roomDown && !itemDown);
    });
  });

  const productsCount = eligibleItemsPerRoom.reduce(
    (sum, items) => sum + items.reduce((itemSum, item) => itemSum + (item.quantity || 1), 0),
    0
  );
  const subtotal = eligibleItemsPerRoom.reduce(
    (sum, items) =>
      sum + items.reduce((itemSum, item) => itemSum + (item.quantity || 1) * Number(item.unitPrice || 0), 0),
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
    hasUnavailableItems,
  };
}

export async function GET(req: Request) {
  try {
    return await withSession(({ role, userId, permissions }) => getQuotations(req, role, userId, permissions));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations" });
  }
}

async function getQuotations(req: Request, role: string, userId: number, permissions: string[]) {
  {
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

    const normRole = (role || "").trim().toLowerCase();

    // Role-based visibility enforcement (applied in the query, never after the fact).
    if (normRole === "dealer") {
      // Dealers see quotations assigned to them or created by them. Any creator /
      // dealer filters in the URL are ignored so they cannot widen this scope.
      filter.$or = dealerVisibilityFilter(userId).$or;
    } else if (normRole === "sales_executive") {
      // Sales Executives may access only quotations assigned to their authenticated user.
      filter.assignedSalesId = userId;
    } else if (normRole === "configurable_admin") {
      if (hasPermission("configurable_admin", permissions, "quotations:read_all")) {
        const dealerIdParam = parseIntQueryParam(searchParams, "dealerId");
        if (dealerIdParam !== undefined) filter.dealerId = dealerIdParam;

        const createdByParam = parseIntQueryParam(searchParams, "createdBy", { min: 1 });
        if (createdByParam !== undefined) filter.createdBy = String(createdByParam);

        if (searchParams.get("mine") === "true") filter.createdBy = String(userId);
      } else {
        // Without quotations:read_all, configurable admin may only see quotations they created
        filter.createdBy = String(userId);
      }
    } else if (hasPermission(role, permissions, "quotations:read_all")) {
      // Super Admin, company_owner, and any admin actually holding
      // quotations:read_all (the default for "admin", but — like every other
      // role except super_admin — removable per company via Roles & Permissions,
      // so this must be checked explicitly rather than assumed from the role name).
      const dealerIdParam = parseIntQueryParam(searchParams, "dealerId");
      if (dealerIdParam !== undefined) filter.dealerId = dealerIdParam;

      const createdByParam = parseIntQueryParam(searchParams, "createdBy", { min: 1 });
      if (createdByParam !== undefined) filter.createdBy = String(createdByParam);

      // `mine=true`: quotations the caller created themselves.
      if (searchParams.get("mine") === "true") filter.createdBy = String(userId);
    } else {
      // Without quotations:read_all, an admin-type account may only see quotations they created.
      filter.createdBy = String(userId);
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
      const redactedResult = result.map((q) =>
        redactQuotationForRole(q as any, role, permissions)
      );
      return NextResponse.json(createPaginatedResponse(redactedResult, total, paginationParams));
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

    const redactedResult = result.map((q) =>
      redactQuotationForRole(q as any, role, permissions)
    );
    return NextResponse.json(redactedResult);
  }
}

export async function POST(req: Request) {
  try {
    return await withSession(({ role, userId, permissions, companyId }) =>
      createQuotation(req, role, userId, permissions, companyId)
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations" });
  }
}

async function createQuotation(
  req: Request,
  role: string,
  userId: number,
  permissions: string[],
  companyId?: number | null
) {
  {
    // Checked for every role, not just configurable_admin: quotations:create
    // is part of the default permission set for admin/dealer/company_owner,
    // but — like every permission except super_admin's — removable per
    // company via Roles & Permissions, so it must be verified explicitly
    // rather than assumed from the role name alone.
    if (!hasPermission(role, permissions, "quotations:create")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to create quotations.");
    }

    await connectMongoDB();
    const input = createQuotationSchema.parse(await readJsonBody(req));
    const { houseTypeId, discountValue, customerDiscountPercent, dealerId, assignedSalesId, ...rest } = input;

    // Parallel execution of pre-transaction validations:
    // 1. Resolve ownership (dealer / sales executive assignment)
    // 2. Validate CRM links (customerId, leadId)
    // 3. Verify houseTypeId and pre-fetch room templates in a single parallel round-trip
    const [ownership, links, houseType, houseTypeTemplates] = await Promise.all([
      resolveNewQuotationOwnership({
        role,
        userId,
        requestedDealerId: dealerId,
        requestedSalesId: assignedSalesId,
        callerPermissions: permissions,
        companyId,
      }),
      validateQuotationLinks(
        { role, userId, permissions, companyId },
        { customerId: rest.customerId, leadId: rest.leadId }
      ),
      houseTypeId
        ? HouseType.findById(houseTypeId).select("_id").lean()
        : Promise.resolve(null),
      houseTypeId
        ? HouseTypeRoomTemplate.find({ houseTypeId })
            .sort({ sortOrder: 1 })
            .populate({ path: "roomType" })
            .lean()
        : Promise.resolve([]),
    ]);

    if (houseTypeId && !houseType) {
      throw new ApiError("NOT_FOUND", "House type not found.", { field: "houseTypeId" });
    }

    const targetDealerId = ownership.dealerId;
    const targetSalesId = ownership.assignedSalesId;
    const allocatedPercent = ownership.allocatedPercent;

    rest.customerId = links.customerId ?? null;
    rest.leadId = links.leadId ?? null;

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

    // Auto customer resolution outside the quotation transaction:
    // Speeds up the transaction, prevents transaction locks on customer sequences,
    // and avoids re-querying or duplicate customer creation during transaction retries.
    let resolvedCustomerId = rest.customerId ?? null;
    if (companyId && !resolvedCustomerId && rest.clientName?.trim() && (rest.clientPhone?.trim() || rest.clientEmail?.trim())) {
      try {
        resolvedCustomerId = await resolveOrCreateCustomer({
          companyId: (companyId as number),
          name: rest.clientName,
          phone: rest.clientPhone,
          email: rest.clientEmail,
          siteAddress: rest.clientAddress,
          gstNumber: rest.clientGstNumber,
          assignedSalesId: targetSalesId,
          dealerId: targetDealerId,
          userId,
        });
      } catch (err) {
        console.error("Auto customer resolution error:", err);
      }
    }

    const createdOn = new Date();
    const year = createdOn.getFullYear();

    // One numbering service for every way of creating a quotation. If a simultaneous request took the number, the
    // whole transaction is tried again (a bounded number of times) with a fresh one.
    const createdQuotation = await withQuotationNumberRetry(() => withTransaction(async (dbSession) => {
      const { quotationNumber } = await issueQuotationNumber(year, dbSession);
      const quotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

      const finalDiscountType = requestedCustomerDiscount > 0 ? "percentage" : (rest.discountType ?? "none");
      const finalDiscountValue = requestedCustomerDiscount > 0
        ? mongoose.Types.Decimal128.fromString(requestedCustomerDiscount.toFixed(2))
        : (discountValue !== undefined && discountValue !== null ? mongoose.Types.Decimal128.fromString(discountValue.toFixed(2)) : null);

      // Take the lead with one conditional update (inside this transaction when there is one), so it can never end up
      // pointing at two quotations, whatever else is happening to it.
      if (links.leadId && companyId) {
        await claimLeadForQuotation({ companyId, leadId: links.leadId, quotationId, session: dbSession });
      }

      const newQuotation = new Quotation({
        _id: quotationId,
        ...rest,
        customerId: resolvedCustomerId,
        quotationNumber,
        houseTypeId: houseTypeId ?? null,
        // A saved premises type and a custom premises name are alternatives; the saved type wins.
        premisesName: houseTypeId ? null : rest.premisesName ?? null,
        status: "draft",
        discountType: finalDiscountType,
        discountValue: finalDiscountValue,
        allocatedDiscountPercent: allocatedPercent,
        customerDiscountPercent: requestedCustomerDiscount,
        estimatedEarningPercent: earningPercent,
        dealerId: targetDealerId,
        assignedBy: ownership.assignedBy,
        assignedOn: ownership.assignedOn,
        assignedSalesId: targetSalesId,
        createdBy: String(userId),
        createdAt: createdOn,
      });

      if (dbSession) {
        await newQuotation.save({ session: dbSession });
      } else {
        await newQuotation.save();
      }

      // Auto-create rooms from the pre-fetched house type templates inside the same transaction
      if (houseTypeId && houseTypeTemplates.length > 0) {
        const validTemplates = houseTypeTemplates.filter((t: any) => {
          const roomType = t.roomType;
          return Boolean(roomType) && !isBathroomLikeRoomName(roomType?.name);
        });

        const totalRooms = validTemplates.reduce((sum: number, t: any) => sum + (Number(t.defaultCount) || 1), 0);
        if (totalRooms > 0) {
          const roomIds = await reserveSequenceBlock("quotationRoom", totalRooms, QuotationRoom, dbSession);
          let roomIdCursor = 0;

          const roomsToCreate = [];
          for (const t of validTemplates) {
            const defaultCount = Number(t.defaultCount) || 1;
            for (let i = 0; i < defaultCount; i++) {
              const nextRoomId = roomIds[roomIdCursor++];
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
    }));

    // Post-transaction tasks: finalize lead link and record CRM activity concurrently
    const postTransactionTasks: Promise<unknown>[] = [];

    if (links.leadId && companyId) {
      postTransactionTasks.push(
        finalizeLeadLink({
          companyId,
          leadId: links.leadId,
          quotationId: String(createdQuotation._id),
          quotationNumber: createdQuotation.quotationNumber,
          customerId: createdQuotation.customerId ?? null,
          userId,
        })
      );
    }

    if (resolvedCustomerId && companyId) {
      postTransactionTasks.push(
        recordCrmActivity({
          companyId: (companyId as number),
          customerId: resolvedCustomerId,
          leadId: links.leadId ?? null,
          quotationId: String(createdQuotation._id),
          type: "note",
          title: "Quotation Created",
          description: `Quotation ${createdQuotation.quotationNumber} initialized for ${rest.clientName}`,
          performedBy: userId,
        }).catch((err) => {
          console.error("CRM activity error on quotation create:", err);
        })
      );
    }

    if (postTransactionTasks.length > 0) {
      await Promise.all(postTransactionTasks);
    }

    // Populate the newly created quotation document with rooms, houseType, dealer, customer, and lead
    // so the client proposal builder receives the complete record in the POST 201 response directly,
    // eliminating a redundant GET /api/quotations/[id] roundtrip and server-side page reload.
    // For a brand new quotation, rooms have no items yet, so nested item lookups are omitted.
    const populated = await Quotation.findById(createdQuotation._id)
      .populate({ path: "houseType" })
      .populate({ path: "dealer", select: "id name email firstName lastName contactNumber companyName gstNumber businessEmail address" })
      .populate({ path: "customer", select: "id name phone whatsapp email billingAddress siteAddress gstNumber customerType" })
      .populate({ path: "lead", select: "id referenceNumber customerName status priority" })
      .populate({
        path: "rooms",
        options: { sort: { sortOrder: 1 } },
        populate: { path: "roomType" },
      })
      .lean({ virtuals: true });

    if (!populated) {
      const plain = createdQuotation.toJSON ? createdQuotation.toJSON() : createdQuotation;
      return apiSuccess(redactQuotationForRole(plain as any, role, permissions), { status: 201 });
    }

    const rawRooms = Array.isArray((populated as any).rooms) ? (populated as any).rooms : [];
    const filteredRooms = rawRooms.filter(
      (room: any) => !isBathroomLikeRoomName(room.roomType?.name)
    );

    const [withActors] = await attachQuotationActors([populated]);
    const normalized = normalizeQuotation({
      ...withActors,
      rooms: filteredRooms,
    });

    return apiSuccess(redactQuotationForRole(normalized as any, role, permissions), { status: 201 });
  }
}
