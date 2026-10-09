import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem } from "@/models";
import { getNextSequence, reserveSequenceBlock } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { canViewQuotation } from "@/lib/quotationAccess";
import { resolveNewQuotationOwnership } from "@/lib/quotationOwnership";
import { dealerSnapshot, recordQuotationEvents } from "@/lib/quotationAudit";
import { duplicateQuotationSchema, parseQuotationId } from "@/lib/validation/quotation";
import type { DuplicateQuotationInput } from "@/lib/validation/quotation";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: duplicating a quotation is a business operation. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

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

    const original = await Quotation.findById(quotationId).populate({
      path: "rooms",
      populate: { path: "items" },
    });

    if (!original) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (!canViewQuotation(role, userId, original)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to duplicate this quotation.");
    }

    // A clone is a brand-new quotation: the cloning user is its creator, the audit
    // history is NOT copied, and ownership is re-derived from the session.
    //  - dealer: owns the clone; naming another dealer is rejected.
    //  - admin / super admin: `dealerId` (a dealer id, or null for "keep for myself")
    //    chooses the owner; when omitted the original dealer is kept (previous behaviour).
    const ownership = await (async () => {
      if (role === "dealer" || overrides.dealerId !== undefined) {
        return resolveNewQuotationOwnership({ role, userId, requestedDealerId: overrides.dealerId });
      }
      const inheritedDealerId = original.dealerId ?? null;
      try {
        return await resolveNewQuotationOwnership({ role, userId, requestedDealerId: inheritedDealerId });
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
      const seq = await getNextSequence(`quotationNumber_${year}`, undefined, dbSession);
      const quotationNumber = `QT-${year}-${String(seq).padStart(3, "0")}`;
      const newQuotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

      const origDoc = (
        typeof original.toJSON === "function" ? original.toJSON() : original
      ) as unknown as Record<string, unknown> & {
        rooms?: Array<Record<string, unknown> & { items?: Array<Record<string, unknown>> }>;
      };

      const targetDealerId = ownership.dealerId;
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
        assignedSalesId: null,
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
        return newQuotation;
      }

      const rooms = Array.isArray(origDoc.rooms) ? origDoc.rooms : [];
      const totalItems = rooms.reduce(
        (sum: number, room: { items?: unknown[] }) => sum + (Array.isArray(room.items) ? room.items.length : 0),
        0
      );
      const roomIds = await reserveSequenceBlock("quotationRoom", rooms.length, QuotationRoom, dbSession);
      const itemIds = await reserveSequenceBlock("quotationItem", totalItems, QuotationItem, dbSession);
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

        const items = Array.isArray(room.items) ? room.items : [];
        const itemsToCreate = [];
        for (const item of items) {
          const nextItemId = itemIds[itemIdCursor++];
          itemsToCreate.push({
            _id: nextItemId,
            quotationRoomId: nextRoomId,
            productId: item.productId,
            productVariantId: item.productVariantId ?? null,
            variantLabel: item.variantLabel ?? null,
            variantConfig: item.variantConfig ?? null,
            sbNumber: item.sbNumber ?? null,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice,
            priceWithoutTax: item.priceWithoutTax ?? null,
            taxPercent: item.taxPercent ?? null,
            taxAmount: item.taxAmount ?? null,
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

      return newQuotation;
    });

    return apiSuccess(duplicatedQuotation, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/duplicate" });
  }
}
