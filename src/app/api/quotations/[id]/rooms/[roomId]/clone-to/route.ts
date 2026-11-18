import { assertQuotationEditable } from "@/lib/quotationRevisionService";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { normalizeQuotationRoom } from "@/lib/quotationNormalization";
import { redactQuotationRoomForRole } from "@/lib/variantRedaction";
import { canModifyQuotation, tenantQuotationFilter } from "@/lib/quotationAccess";
import { reserveSequenceBlock } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteMany } from "@/lib/softDelete/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; roomId: string }> };

interface CloneToBody {
  targetRoomIds: number[];
  replaceExisting?: boolean;
}

/**
 * POST /api/quotations/[id]/rooms/[roomId]/clone-to
 * Clones all items from the source room to one or more target rooms in the same quotation.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ session, role, userId, permissions, companyId }) => {
      const { id, roomId } = await context.params;
      const quotationId = parseQuotationId(id);
      const sourceRoomId = parseNumericId(roomId, "roomId");

      await connectMongoDB();

      const quotation = await Quotation.findOne(tenantQuotationFilter(quotationId, role, companyId))
        .select("_id status revision dealerId assignedSalesId createdBy companyId")
        .lean();
      if (!quotation) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }
      assertQuotationEditable(quotation);
      if (!canModifyQuotation(role, userId, quotation, permissions, companyId)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
      }

      const effectiveCompanyId = (quotation as any).companyId ?? companyId ?? null;

      const body = (await readJsonBody(req)) as CloneToBody;
      const targetRoomIds = Array.isArray(body?.targetRoomIds)
        ? body.targetRoomIds.map(Number).filter((tid) => tid > 0 && tid !== sourceRoomId)
        : [];

      if (targetRoomIds.length === 0) {
        throw new ApiError("VALIDATION_ERROR", "Please select at least one destination room.");
      }

      // Verify source room belongs to this quotation and company
      const sourceRoom = await QuotationRoom.findOne({
        _id: sourceRoomId,
        quotationId,
        ...(effectiveCompanyId != null ? { companyId: effectiveCompanyId } : {}),
        isDeleted: { $ne: true },
      }).lean();
      if (!sourceRoom) {
        throw new ApiError("NOT_FOUND", "Source room not found.");
      }

      // Verify all target rooms belong to this quotation and company
      const targetRooms = await QuotationRoom.find({
        _id: { $in: targetRoomIds },
        quotationId,
        ...(effectiveCompanyId != null ? { companyId: effectiveCompanyId } : {}),
        isDeleted: { $ne: true },
      }).lean();

      if (targetRooms.length !== targetRoomIds.length) {
        throw new ApiError("NOT_FOUND", "One or more destination rooms were not found.");
      }

      // Find active items in source room
      const sourceItems = await QuotationItem.find({
        quotationRoomId: sourceRoomId,
        isDeleted: { $ne: true },
      }).lean();

      if (sourceItems.length === 0) {
        throw new ApiError("VALIDATION_ERROR", "Source room has no products to copy. Add devices first.");
      }

      const replaceExisting = Boolean(body.replaceExisting);

      // Perform copy for each target room inside a database transaction to guarantee all-or-nothing atomicity
      const now = new Date();
      const createdItemsCount = sourceItems.length * targetRoomIds.length;

      await withTransaction(async (dbSession) => {
        const allocatedIds = await reserveSequenceBlock(
          "quotationItem",
          createdItemsCount,
          QuotationItem,
          dbSession
        );

        let idCursor = 0;
        const allClonedItems = [];

        for (const targetRoom of targetRooms) {
          const targetRoomId = targetRoom._id;

          // If replacing, soft-delete existing items in target room
          if (replaceExisting) {
            const actor = actorFromSession(session);
            await softDeleteMany({
              model: QuotationItem,
              entityType: "quotationItem",
              filter: { quotationRoomId: targetRoomId, quotationId },
              actor,
              reason: `Replaced by cloning from room #${sourceRoomId}`,
              session: dbSession,
            });
          }

          // Prepare cloned item payloads
          for (const item of sourceItems) {
            allClonedItems.push({
              _id: allocatedIds[idCursor++],
              companyId: effectiveCompanyId,
              quotationId,
              quotationRoomId: targetRoomId,
              productId: item.productId,
              productVariantId: item.productVariantId ?? null,
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice,
              originalUnitPrice: item.originalUnitPrice ?? item.unitPrice,
              isCustomPrice: item.isCustomPrice ?? false,
              variantLabel: item.variantLabel ?? null,
              variantConfig: item.variantConfig ?? null,
              taxPercent: item.taxPercent ?? null,
              taxAmount: item.taxAmount ?? null,
              priceWithoutTax: item.priceWithoutTax ?? null,
              preDiscountUnitPrice: item.preDiscountUnitPrice ?? null,
              discountType: item.discountType ?? null,
              discountValue: item.discountValue ?? null,
              sbNumber: item.sbNumber ?? null,
              notes: item.notes ?? null,
              sortOrder: item.sortOrder ?? 0,
            });
          }
        }

        if (allClonedItems.length > 0) {
          await QuotationItem.insertMany(allClonedItems, { session: dbSession });
        }
      });

      // Fetch all updated rooms to return to caller
      const updatedRooms = await QuotationRoom.find({
        _id: { $in: targetRoomIds },
        quotationId,
        isDeleted: { $ne: true },
      })
        .populate({ path: "roomType" })
        .populate({
          path: "items",
          match: { isDeleted: { $ne: true } },
          populate: [
            {
              path: "product",
              select:
                "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes specs",
            },
            {
              path: "productVariant",
              select: "surfaceFinish automationTier",
            },
          ],
        });

      const normalizedRooms = updatedRooms.map((r) => {
        const plain = r.toObject ? r.toObject() : r;
        const norm = normalizeQuotationRoom(plain, quotationId);
        return redactQuotationRoomForRole(norm, role, permissions);
      });

      return apiSuccess({
        clonedItemsCount: createdItemsCount,
        rooms: normalizedRooms,
        message: `Successfully copied ${sourceItems.length} device(s) to ${targetRoomIds.length} room(s).`,
      });
    });
  } catch (error) {
    return handleApiError(error, {
      logPrefix: "POST /api/quotations/[id]/rooms/[roomId]/clone-to",
    });
  }
}

