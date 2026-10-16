import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, Product } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, massUpdateRoomItemsSchema } from "@/lib/validation/quotation";
import { normalizeQuotationRoom } from "@/lib/quotationNormalization";
import { redactQuotationRoomForRole } from "@/lib/variantRedaction";
import { resolveVariantPricing } from "@/lib/pricing";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { withTransaction } from "@/lib/transaction";

type RouteContext = { params: Promise<{ id: string; roomId: string }> };

interface VariantDoc {
  id?: number;
  _id?: number;
  automationTier?: string | null;
  surfaceFinish?: string | null;
  config?: Record<string, string> | null;
  price?: unknown;
  priceWithoutTax?: unknown;
  taxPercent?: unknown;
}

/**
 * PATCH /api/quotations/[id]/rooms/[roomId]/items
 *
 * Atomically updates multiple items assigned to a single room in one operation.
 * Used by the Dealer Quotation Review "Mass Edit" feature.
 *
 * Enforces:
 * - Quotation existence, lock status, and dealer edit authorization.
 * - Room ownership (room must belong to this quotation).
 * - Item ownership (every item must belong to this room and this quotation).
 * - Product & variant validity (must be active and available).
 * - Authoritative server-side pricing & GST calculation (client prices are never trusted).
 * - All changes apply or fail together via transaction.
 * - Other rooms remain strictly untouched.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const { id, roomId } = await context.params;
      const quotationId = parseQuotationId(id);
      const rId = parseNumericId(roomId, "roomId");

      await connectMongoDB();

      const quotation = await Quotation.findById(quotationId).select("_id status dealerId assignedSalesId createdBy").lean();
      if (!quotation) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }
      if (quotation.status === "approved" || quotation.status === "delivered") {
        throw new ApiError(
          "FORBIDDEN",
          `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`
        );
      }
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
      }

      const room = await QuotationRoom.findOne({ _id: rId, quotationId }).select("_id").lean();
      if (!room) {
        throw new ApiError("NOT_FOUND", "Room not found for this quotation.");
      }

      const body = massUpdateRoomItemsSchema.parse(await readJsonBody(req));
      const requestedItems = body.items;

      // 1. Validate that all items exist and belong to this room and quotation
      const itemIds = requestedItems.map((it) => it.itemId);
      const existingItems = await QuotationItem.find({
        _id: { $in: itemIds },
        quotationRoomId: rId,
      }).lean();

      if (existingItems.length !== itemIds.length) {
        const foundIds = new Set(existingItems.map((it) => Number(it._id)));
        const missing = itemIds.filter((id) => !foundIds.has(id));
        throw new ApiError(
          "VALIDATION_ERROR",
          `One or more items do not belong to this space: ${missing.join(", ")}`
        );
      }

      const existingItemsMap = new Map(existingItems.map((it) => [Number(it._id), it]));

      // 2. Pre-validate every replacement product and variant before beginning write
      interface PreparedUpdate {
        itemId: number;
        data: Record<string, unknown>;
      }
      const preparedUpdates: PreparedUpdate[] = [];

      for (const updateReq of requestedItems) {
        const existing = existingItemsMap.get(updateReq.itemId);
        if (!existing) continue;

        const product = await Product.findById(updateReq.productId).populate({
          path: "variants",
          match: { isActive: true },
        });

        if (!product) {
          throw new ApiError("NOT_FOUND", `Product #${updateReq.productId} not found.`, {
            field: "productId",
          });
        }
        if (!product.isActive) {
          throw new ApiError(
            "VALIDATION_ERROR",
            `Product "${product.name}" is no longer available.`,
            { field: "productId" }
          );
        }

        const productJson = (typeof product.toJSON === "function" ? product.toJSON() : product) as {
          variants?: VariantDoc[];
        };
        const activeVariants: VariantDoc[] = Array.isArray(productJson.variants) ? productJson.variants : [];

        let matchedVariant: VariantDoc | undefined;

        if (updateReq.productVariantId != null) {
          matchedVariant = activeVariants.find((v) => (v.id ?? v._id) === updateReq.productVariantId);
          if (!matchedVariant) {
            throw new ApiError(
              "VALIDATION_ERROR",
              `Selected variant is unavailable for "${product.name}".`,
              { field: "productVariantId" }
            );
          }
        } else if (activeVariants.length === 1) {
          matchedVariant = activeVariants[0];
        } else if (updateReq.variantConfig && Object.keys(updateReq.variantConfig).length > 0) {
          // Attempt match from variantConfig
          const cfg = updateReq.variantConfig;
          matchedVariant = activeVariants.find((v) => {
            const vConf = (v.config as Record<string, string>) || {};
            const tierMatches = !cfg.series || (v.automationTier && v.automationTier.toLowerCase() === cfg.series.toLowerCase()) || (vConf.series && vConf.series.toLowerCase() === cfg.series.toLowerCase());
            const finishMatches = !cfg.finish || (v.surfaceFinish && v.surfaceFinish.toLowerCase() === cfg.finish.toLowerCase()) || (vConf.finish && vConf.finish.toLowerCase() === cfg.finish.toLowerCase());
            return tierMatches && finishMatches;
          });
        }

        if (!matchedVariant && activeVariants.length > 0) {
          matchedVariant = activeVariants[0];
        }

        const itemData: Record<string, unknown> = {
          productId: updateReq.productId,
        };

        if (updateReq.quantity !== undefined) {
          itemData.quantity = updateReq.quantity;
        }

        if (updateReq.notes !== undefined) {
          itemData.notes = updateReq.notes;
        }

        if (matchedVariant) {
          itemData.productVariantId = matchedVariant.id ?? matchedVariant._id;

          const variantPricing = resolveVariantPricing(
            matchedVariant.price !== undefined && matchedVariant.price !== null && matchedVariant.price !== ""
              ? { price: matchedVariant.price, taxPercent: matchedVariant.taxPercent }
              : { priceWithoutTax: matchedVariant.priceWithoutTax, taxPercent: matchedVariant.taxPercent }
          );

          itemData.unitPrice = mongoose.Types.Decimal128.fromString(variantPricing.price.toFixed(2));
          itemData.priceWithoutTax = mongoose.Types.Decimal128.fromString(variantPricing.priceWithoutTax.toFixed(2));
          itemData.taxAmount = mongoose.Types.Decimal128.fromString(variantPricing.taxAmount.toFixed(2));
          itemData.taxPercent = mongoose.Types.Decimal128.fromString(variantPricing.taxPercent.toFixed(2));

          const tierLbl = formatTierLabel(matchedVariant.automationTier);
          const finishLbl = formatFinishLabel(matchedVariant.surfaceFinish);
          itemData.variantLabel =
            tierLbl || finishLbl
              ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
              : updateReq.variantLabel ?? (matchedVariant.config ? Object.values(matchedVariant.config).filter(Boolean).join(" + ") : null);

          itemData.variantConfig = updateReq.variantConfig ?? matchedVariant.config ?? null;
        }

        preparedUpdates.push({ itemId: updateReq.itemId, data: itemData });
      }

      // 3. Atomically update items within transaction
      const updatedRoom = await withTransaction(async (session) => {
        for (const update of preparedUpdates) {
          await QuotationItem.findByIdAndUpdate(
            update.itemId,
            { $set: update.data },
            { session }
          );
        }

        return await QuotationRoom.findById(rId, null, { session })
          .populate({ path: "roomType" })
          .populate({
            path: "items",
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
          });
      });

      if (!updatedRoom) {
        throw new ApiError("NOT_FOUND", "Room not found after update.");
      }

      const plainRoom = updatedRoom.toObject ? updatedRoom.toObject() : updatedRoom;
      const normalizedRoom = normalizeQuotationRoom(plainRoom, quotationId);
      const redactedRoom = redactQuotationRoomForRole(normalizedRoom, role, permissions);

      return apiSuccess({
        room: redactedRoom,
        updatedCount: preparedUpdates.length,
      });
    });
  } catch (error) {
    return handleApiError(error, {
      logPrefix: "PATCH /api/quotations/[id]/rooms/[roomId]/items",
    });
  }
}
