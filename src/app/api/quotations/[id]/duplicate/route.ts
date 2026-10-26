import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, ProductVariant } from "@/models";
import { resolveVariantPricing } from "@/lib/pricing";
import { getNextQuotationSequence, reserveSequenceBlock } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canViewQuotation } from "@/lib/quotationAccess";
import { resolveNewQuotationOwnership } from "@/lib/quotationOwnership";
import { dealerSnapshot, recordQuotationEvents } from "@/lib/quotationAudit";
import { duplicateQuotationSchema, parseQuotationId } from "@/lib/validation/quotation";
import type { DuplicateQuotationInput } from "@/lib/validation/quotation";
import { redactQuotationForRole } from "@/lib/variantRedaction";
import {
  isItemUnavailable,
  isRoomUnavailable,
  type UnavailabilityCheckItem,
  type UnavailabilityCheckRoom,
} from "@/lib/quotationAvailability";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: duplicating a quotation is a business operation. */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
    if (!hasPermission(role, permissions, "quotations:create")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to create quotations.");
    }

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();

    // The body is optional: an empty body duplicates the quotation verbatim.
    // A malformed body is still a hard 400 rather than a silent "copy as-is".
    let overrides: Partial<DuplicateQuotationInput> = {};
    const rawBody = await req.text();
    if (rawBody.trim() !== "") {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Invalid JSON request body.");
      }
      overrides = duplicateQuotationSchema.parse(parsedJson);
    }

    // `isDeleted` (plus `name`, just for the skipped-items warning labels
    // below) is the only addition to this populate — enough to apply the
    // same shared availability rule (`@/lib/quotationAvailability`) a clone
    // must never copy an unavailable item from, without duplicating that
    // logic or querying anything this route didn't already need.
    const original = await Quotation.findById(quotationId).populate({
      path: "rooms",
      populate: [
        { path: "roomType", select: "name isDeleted" },
        {
          path: "items",
          populate: [
            { path: "product", select: "name isDeleted" },
            { path: "productVariant", select: "isDeleted price priceWithoutTax taxPercent isActive" },
          ],
        },
      ],
    });

    if (!original) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (!canViewQuotation(role, userId, original, permissions)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to duplicate this quotation.");
    }

    // A clone is a brand-new quotation: the cloning user is its creator, the audit
    // history is NOT copied, and ownership is re-derived from the session.
    //  - dealer: owns the clone; naming another dealer is rejected.
    //  - sales_executive: clone is strictly assigned to themselves.
    //  - admin / super admin: `dealerId` (a dealer id, or null for "keep for myself")
    //    chooses the owner; when omitted the original dealer is kept (previous behaviour).
    const normRole = (role || "").trim().toLowerCase();
    const ownership = await (async () => {
      if (normRole === "sales_executive") {
        return resolveNewQuotationOwnership({ role, userId, requestedDealerId: null });
      }
      if (normRole === "dealer" || overrides.dealerId !== undefined) {
        return resolveNewQuotationOwnership({ role, userId, requestedDealerId: overrides.dealerId });
      }
      const inheritedDealerId = original.dealerId ?? null;
      try {
        return await resolveNewQuotationOwnership({
          role,
          userId,
          requestedDealerId: inheritedDealerId,
          requestedSalesId: original.assignedSalesId ?? null,
        });
      } catch (error) {
        // The original dealer may have been deactivated since; the clone then
        // simply stays with the admin instead of failing.
        if (error instanceof ApiError) {
          return resolveNewQuotationOwnership({ role, userId, requestedDealerId: null });
        }
        throw error;
      }
    })();

    const createdOn = new Date();
    const year = createdOn.getFullYear();

    const duplicatedQuotation = await withTransaction(async (dbSession) => {
      // The sequence and every cloned row share one transaction, so a duplicate
      // can never consume a quotation number and then fail halfway through.
      const seq = await getNextQuotationSequence(year, dbSession);
      const quotationNumber = `QT-${year}-${String(seq).padStart(3, "0")}`;
      const newQuotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

      const origDoc = (
        typeof original.toJSON === "function" ? original.toJSON() : original
      ) as unknown as Record<string, unknown> & {
        rooms?: Array<Record<string, unknown> & { items?: Array<Record<string, unknown>> }>;
      };

      const targetDealerId = ownership.dealerId;
      const targetSalesId = ownership.assignedSalesId;
      const currentAllocated = ownership.allocatedPercent;

      const newQuotation = new Quotation({
        _id: newQuotationId,
        quotationNumber,
        clientName: overrides.clientName ?? `${String(origDoc.clientName)} (Revision)`,
        clientGstNumber: origDoc.clientGstNumber ?? null,
        clientPhone: origDoc.clientPhone ?? null,
        clientEmail: origDoc.clientEmail ?? null,
        clientAddress: origDoc.clientAddress ?? null,
        houseTypeId: origDoc.houseTypeId ?? null,
        status: "draft",
        clonedFromQuotationId: quotationId,
        notes: overrides.notes ?? origDoc.notes ?? null,
        discountType: "none",
        discountValue: null,
        allocatedDiscountPercent: currentAllocated,
        customerDiscountPercent: 0,
        estimatedEarningPercent: currentAllocated,
        dealerId: targetDealerId,
        assignedBy: ownership.assignedBy,
        assignedOn: ownership.assignedOn,
        assignedSalesId: targetSalesId,
        terms: origDoc.terms ?? null,
        validUntil: origDoc.validUntil ?? null,
        defaultTier: origDoc.defaultTier ?? null,
        defaultFinish: origDoc.defaultFinish ?? null,
        createdBy: String(userId),
        createdAt: createdOn,
      });

      if (dbSession) {
        await newQuotation.save({ session: dbSession });
      } else {
        await newQuotation.save();
      }

      await recordQuotationEvents(
        [
          {
            quotationId: newQuotationId,
            action: "quotation_cloned",
            performedBy: userId,
            newValue: { quotationNumber },
            metadata: { clonedFromQuotationId: quotationId, clonedFromQuotationNumber: original.quotationNumber },
          },
          ...(ownership.assignedBy !== null
            ? [
                {
                  quotationId: newQuotationId,
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

      // Clone rooms and items. set includeRooms=false to copy the header only.
      if (overrides.includeRooms === false) {
        return { newQuotation, skippedItems: [] as Array<{ label: string; reason: "product" | "variant" | "roomType" }> };
      }

      const rooms = Array.isArray(origDoc.rooms) ? origDoc.rooms : [];

      // A clone is always a brand-new draft, so the "exclude an unavailable
      // item" rule always applies here — regardless of the SOURCE
      // quotation's own status (an Approved/Delivered source keeps its own
      // historical items exactly as they are; this only decides what gets
      // copied INTO the new draft). A room whose own room type is deleted
      // is still cloned (so the floor/space layout is preserved) — only its
      // items, now all unavailable by that same rule, are skipped.
      type CloneRoom = UnavailabilityCheckRoom & { items?: unknown[] };
      type CloneItem = UnavailabilityCheckItem &
        Record<string, unknown> & { product?: { name?: string; isDeleted?: boolean } | null; variantLabel?: string | null };

      const eligibleItemsByRoom = (rooms as CloneRoom[]).map((room) => {
        const roomDown = isRoomUnavailable(room);
        const items = (Array.isArray(room.items) ? room.items : []) as CloneItem[];
        return items.filter((item) => !roomDown && !isItemUnavailable(item, room));
      });
      const skippedItems: Array<{ label: string; reason: "product" | "variant" | "roomType" }> = [];
      (rooms as CloneRoom[]).forEach((room, roomIdx) => {
        const roomDown = isRoomUnavailable(room);
        const items = (Array.isArray(room.items) ? room.items : []) as CloneItem[];
        const eligible = eligibleItemsByRoom[roomIdx];
        for (const item of items) {
          if (eligible.includes(item)) continue;
          skippedItems.push({
            label: item.product?.name ?? item.variantLabel ?? "Unknown product",
            reason: roomDown ? "roomType" : item.product?.isDeleted ? "product" : "variant",
          });
        }
      });

      const totalEligibleItems = eligibleItemsByRoom.reduce((sum, items) => sum + items.length, 0);
      const roomIds = await reserveSequenceBlock("quotationRoom", rooms.length, QuotationRoom, dbSession);
      const itemIds = await reserveSequenceBlock("quotationItem", totalEligibleItems, QuotationItem, dbSession);
      let itemIdCursor = 0;

      for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
        const room = rooms[roomIdx];
        const nextRoomId = roomIds[roomIdx];
        const newRoom = new QuotationRoom({
          _id: nextRoomId,
          quotationId: newQuotationId,
          roomTypeId: room.roomTypeId ?? null,
          customName: room.customName ?? null,
          subArea: room.subArea ?? null,
          notes: room.notes ?? null,
          sortOrder: room.sortOrder ?? 0,
        });

        if (dbSession) {
          await newRoom.save({ session: dbSession });
        } else {
          await newRoom.save();
        }

        const items = eligibleItemsByRoom[roomIdx];
        const itemsToCreate = [];
        for (const item of items) {
          const nextItemId = itemIds[itemIdCursor++];

          // Resolve current default selling price from Product Master / selected variant
          let defaultPrice = 0;
          let defaultPriceWithoutTax = 0;
          let defaultTaxPercent = 18;
          let defaultTaxAmount = 0;

          const variant = item.productVariant as {
            price?: unknown;
            priceWithoutTax?: unknown;
            taxPercent?: unknown;
            isActive?: boolean;
            isDeleted?: boolean;
          } | null | undefined;

          if (variant && (variant.price !== undefined || variant.priceWithoutTax !== undefined)) {
            const pricing = resolveVariantPricing({
              price: variant.price,
              priceWithoutTax: variant.priceWithoutTax,
              taxPercent: variant.taxPercent,
            });
            defaultPrice = pricing.price;
            defaultPriceWithoutTax = pricing.priceWithoutTax;
            defaultTaxPercent = pricing.taxPercent;
            defaultTaxAmount = pricing.taxAmount;
          } else if (item.productVariantId) {
            const liveVariant = await ProductVariant.findById(item.productVariantId).lean();
            if (liveVariant) {
              const pricing = resolveVariantPricing({
                price: liveVariant.price,
                priceWithoutTax: liveVariant.priceWithoutTax,
                taxPercent: liveVariant.taxPercent,
              });
              defaultPrice = pricing.price;
              defaultPriceWithoutTax = pricing.priceWithoutTax;
              defaultTaxPercent = pricing.taxPercent;
              defaultTaxAmount = pricing.taxAmount;
            }
          }

          if (defaultPrice === 0) {
            const fallbackPrice = item.originalUnitPrice
              ? Number(String(item.originalUnitPrice))
              : Number(String(item.unitPrice || 0));
            if (fallbackPrice > 0) {
              const pricing = resolveVariantPricing({
                price: fallbackPrice,
                taxPercent: item.taxPercent ? Number(String(item.taxPercent)) : 18,
              });
              defaultPrice = pricing.price;
              defaultPriceWithoutTax = pricing.priceWithoutTax;
              defaultTaxPercent = pricing.taxPercent;
              defaultTaxAmount = pricing.taxAmount;
            }
          }

          itemsToCreate.push({
            _id: nextItemId,
            quotationRoomId: nextRoomId,
            productId: item.productId,
            productVariantId: item.productVariantId ?? null,
            variantLabel: item.variantLabel ?? null,
            variantConfig: item.variantConfig ?? null,
            sbNumber: item.sbNumber ?? null,
            quantity: item.quantity ?? 1,
            unitPrice: mongoose.Types.Decimal128.fromString(defaultPrice.toFixed(2)),
            priceWithoutTax: mongoose.Types.Decimal128.fromString(defaultPriceWithoutTax.toFixed(2)),
            taxPercent: mongoose.Types.Decimal128.fromString(defaultTaxPercent.toFixed(2)),
            taxAmount: mongoose.Types.Decimal128.fromString(defaultTaxAmount.toFixed(2)),
            isCustomPrice: false,
            originalUnitPrice: null,
            notes: item.notes ?? null,
            sortOrder: item.sortOrder ?? 0,
          });
        }

        if (itemsToCreate.length > 0) {
          if (dbSession) {
            await QuotationItem.insertMany(itemsToCreate, { session: dbSession });
          } else {
            await QuotationItem.insertMany(itemsToCreate);
          }
        }
      }

      return { newQuotation, skippedItems };
    });

    const { newQuotation, skippedItems } = duplicatedQuotation;
    const quotationJson = typeof newQuotation.toJSON === "function" ? newQuotation.toJSON() : newQuotation;
    const redactedQuotation = redactQuotationForRole(quotationJson as any, role, permissions);
    return apiSuccess({ ...redactedQuotation, skippedItems }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/duplicate" });
  }
}
