import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationItem, QuotationRoom, Product } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationItemSchema } from "@/lib/validation/quotation";
import { normalizeQuotationItem } from "@/lib/quotationNormalization";
import { redactQuotationItemForRole } from "@/lib/variantRedaction";
import { calculateFromTaxInclusivePrice, resolveVariantPricing } from "@/lib/pricing";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

/** Session required: editing and removing items are business operations. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
    const { id, itemId } = await context.params;
    const quotationId = parseQuotationId(id);
    const itId = parseNumericId(itemId, "itemId");

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status dealerId assignedSalesId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError("FORBIDDEN", `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`);
    }
    if (!canModifyQuotation(role, userId, quotation, permissions)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const parsed = updateQuotationItemSchema.parse(await readJsonBody(req));
    const { unitPrice, ...rest } = parsed;

    if (Object.keys(rest).length === 0 && unitPrice === undefined) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    // Ownership check: the item must belong to a room of THIS quotation.
    const existingItem = await QuotationItem.findById(itId)
      .populate({ path: "room", select: "quotationId" })
      .lean();
    const owningQuotationId = (existingItem as unknown as { room?: { quotationId?: string } } | null)
      ?.room?.quotationId;
    if (!existingItem || owningQuotationId !== quotationId) {
      throw new ApiError("NOT_FOUND", "Item not found for this quotation.");
    }

    const data: Record<string, unknown> = { ...rest };

    if (unitPrice !== undefined) {
      const existingTax = (existingItem as any)?.taxPercent;
      const taxPercent = existingTax ? Number(String(existingTax)) : 18;
      const { priceWithoutTax, taxAmount } = calculateFromTaxInclusivePrice(unitPrice, taxPercent);
      data.unitPrice = mongoose.Types.Decimal128.fromString(unitPrice.toFixed(2));
      data.priceWithoutTax = mongoose.Types.Decimal128.fromString(priceWithoutTax.toFixed(2));
      data.taxAmount = mongoose.Types.Decimal128.fromString(taxAmount.toFixed(2));
    }

    // Moving an item to another room is only allowed inside the same quotation.
    if (parsed.quotationRoomId !== undefined) {
      const targetRoom = await QuotationRoom.findOne({
        _id: parsed.quotationRoomId,
        quotationId,
      }).select("_id");
      if (!targetRoom) {
        throw new ApiError("NOT_FOUND", "Target room not found for this quotation.", {
          field: "quotationRoomId",
        });
      }
    }

    if (parsed.productId !== undefined) {
      data.productId = parsed.productId;
    }

    // Reassigning an item to a different product/variant must go through the
    // same live-reference check as creating one — a direct PATCH must not be
    // able to attach a soft-deleted (or inactive) product/variant that the
    // create endpoint would have rejected.
    if (parsed.productId !== undefined || parsed.productVariantId !== undefined) {
      const targetProductId =
        parsed.productId ?? (existingItem as unknown as { productId?: number }).productId;
      const product = await Product.findById(targetProductId).populate({
        path: "variants",
        match: { isActive: true },
      });
      if (!product) {
        throw new ApiError("NOT_FOUND", "Product not found.", { field: "productId" });
      }
      if (!product.isActive) {
        throw new ApiError("VALIDATION_ERROR", "This product is no longer available.", { field: "productId" });
      }

      const productJson = (typeof product.toJSON === "function" ? product.toJSON() : product) as {
        variants?: Array<{
          id?: number;
          _id?: number;
          automationTier?: string | null;
          surfaceFinish?: string | null;
          config?: Record<string, string> | null;
          price?: unknown;
          priceWithoutTax?: unknown;
          taxPercent?: unknown;
        }>;
      };
      const variants = Array.isArray(productJson.variants) ? productJson.variants : [];

      const targetVariantId =
        parsed.productVariantId !== undefined
          ? parsed.productVariantId
          : (existingItem as unknown as { productVariantId?: number | null }).productVariantId;

      let match = targetVariantId != null ? variants.find((v) => (v.id ?? v._id) === targetVariantId) : undefined;

      if (!match && targetVariantId == null && variants.length === 1) {
        match = variants[0];
      }

      if (targetVariantId != null && !match) {
        throw new ApiError("VALIDATION_ERROR", "The selected variant is unavailable.", {
          field: "productVariantId",
        });
      }

      if (match) {
        data.productVariantId = match.id ?? match._id;
        const variantPricing = resolveVariantPricing(
          match.price !== undefined && match.price !== null && match.price !== ""
            ? { price: match.price, taxPercent: match.taxPercent }
            : { priceWithoutTax: match.priceWithoutTax, taxPercent: match.taxPercent }
        );
        data.unitPrice = mongoose.Types.Decimal128.fromString(variantPricing.price.toFixed(2));
        data.priceWithoutTax = mongoose.Types.Decimal128.fromString(variantPricing.priceWithoutTax.toFixed(2));
        data.taxAmount = mongoose.Types.Decimal128.fromString(variantPricing.taxAmount.toFixed(2));
        data.taxPercent = mongoose.Types.Decimal128.fromString(variantPricing.taxPercent.toFixed(2));

        const tierLbl = formatTierLabel(match.automationTier);
        const finishLbl = formatFinishLabel(match.surfaceFinish);
        data.variantLabel =
          tierLbl || finishLbl
            ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
            : parsed.variantLabel ?? (match.config ? Object.values(match.config).filter(Boolean).join(" + ") : null);

        data.variantConfig = parsed.variantConfig ?? match.config ?? null;
      }
    }

    await QuotationItem.findByIdAndUpdate(itId, { $set: data });

    // Response-only populate: just the fields the editor/proposal/PDF render
    // for this item (see `AGENTS.md`/Phase 3 audit and
    // `QuotationItemVariantSummary` in `@/types`) — never the catalog's full
    // variant list.
    const item = await QuotationItem.findById(itId)
      .populate({
        path: "product",
        select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes",
      })
      .populate({ path: "productVariant", select: "surfaceFinish automationTier" });

    // See the matching comment in POST /api/quotations/[id]/items: `.toObject()`
    // must run before `normalizeQuotationItem`, which spreads its input, or the
    // raw Mongoose Document's internal bookkeeping carries an unredacted copy
    // of the populated product/variant straight past the redaction below.
    const plainItem = item?.toObject ? item.toObject() : item;
    return apiSuccess(redactQuotationItemForRole(normalizeQuotationItem(plainItem), role, permissions));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/quotations/[id]/items/[itemId]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ session, role, userId, permissions }) => {
    const actor = actorFromSession(session);

    const { id, itemId } = await context.params;
    const quotationId = parseQuotationId(id);
    const itId = parseNumericId(itemId, "itemId");

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status dealerId assignedSalesId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError("FORBIDDEN", `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`);
    }
    if (!canModifyQuotation(role, userId, quotation, permissions)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const existingItem = await QuotationItem.findById(itId)
      .populate({ path: "room", select: "quotationId" })
      .lean();
    const owningQuotationId = (existingItem as unknown as { room?: { quotationId?: string } } | null)
      ?.room?.quotationId;
    if (!existingItem || owningQuotationId !== quotationId) {
      throw new ApiError("NOT_FOUND", "Item not found for this quotation.");
    }

    // Soft delete — the item keeps every pricing/GST/discount field intact
    // in the record itself, just hidden from the live quotation view.
    await softDeleteOne({
      model: QuotationItem,
      entityType: "quotationItem",
      id: itId,
      actor,
    });

    return apiSuccess({ id: itId, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/quotations/[id]/items/[itemId]" });
  }
}
