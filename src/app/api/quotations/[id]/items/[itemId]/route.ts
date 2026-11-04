import { assertQuotationEditable } from "@/lib/quotationRevisionService";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationItem, QuotationRoom, Product, ProductVariant } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationItemSchema } from "@/lib/validation/quotation";
import { normalizeQuotationItem } from "@/lib/quotationNormalization";
import { redactQuotationItemForRole } from "@/lib/variantRedaction";
import { calculateFromTaxInclusivePrice, resolveStoredVariantPricing } from "@/lib/pricing";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";
import { basePriceBeforeDiscount, canGiveItemDiscount, canOverrideItemPrice, netUnitPrice, validateItemDiscount, intactItemDiscount } from "@/lib/itemDiscount";
import { recordQuotationEvent } from "@/lib/quotationAudit";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

/** The stored price fields of an item as plain numbers (a lean document holds Decimal128 values, which Number() cannot read). */
function storedItemPrice(item: unknown) {
  const raw = item as { unitPrice?: unknown; discountType?: unknown; discountValue?: unknown; preDiscountUnitPrice?: unknown };
  const asNumber = (value: unknown) => (value === null || value === undefined ? null : Number(String(value)));
  return {
    unitPrice: asNumber(raw.unitPrice),
    discountType: raw.discountType ?? null,
    discountValue: asNumber(raw.discountValue),
    preDiscountUnitPrice: asNumber(raw.preDiscountUnitPrice),
  };
}

/** Session required: editing and removing items are business operations. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, actingAsCompany }) => {
    const { id, itemId } = await context.params;
    const quotationId = parseQuotationId(id);
    const itId = parseNumericId(itemId, "itemId");

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status revision dealerId assignedSalesId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    assertQuotationEditable(quotation);
    if (!canModifyQuotation(role, userId, quotation, permissions)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const parsed = updateQuotationItemSchema.parse(await readJsonBody(req));
    const { unitPrice: requestedUnitPrice, resetToDefaultPrice, isCustomPrice, discountType, discountValue, ...rest } = parsed;
    let unitPrice = requestedUnitPrice;

    if (Object.keys(rest).length === 0 && unitPrice === undefined && !resetToDefaultPrice && discountType === undefined) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    // A per-product discount is a commercial decision: only an Admin or a Company Owner may give or remove one
    // (a Super Admin only while acting within a selected company).
    if (discountType !== undefined) {
      if (!canGiveItemDiscount(role, actingAsCompany)) {
        throw new ApiError("FORBIDDEN", "Only an Admin or the Company Owner can give a discount on a product.");
      }
      if (unitPrice !== undefined || resetToDefaultPrice) {
        throw new ApiError("VALIDATION_ERROR", "Set a discount or a custom price in separate requests.", { field: "discountType" });
      }
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
    const currentUnitPrice = storedItemPrice(existingItem).unitPrice ?? 0;
    // What the audit trail records for this edit (set below only when the price or discount actually changes).
    let auditAction: "item_price_overridden" | "item_price_reset" | "item_discount_applied" | "item_discount_removed" | null = null;

    // Per-product discount: the line's unit price becomes the price after the discount, worked out from the price before it.
    // The discount is recorded beside it so the grid can show and change it.
    let discountToStore: { type: "percentage" | "fixed"; value: number; pre: number } | null | undefined;
    if (discountType !== undefined) {
      const base = basePriceBeforeDiscount(storedItemPrice(existingItem));
      if (discountType === "none") {
        unitPrice = Math.round(base * 100) / 100;
        discountToStore = null;
      } else {
        const message = validateItemDiscount(base, discountType, Number(discountValue));
        if (message) throw new ApiError("VALIDATION_ERROR", message, { field: "discountValue" });
        unitPrice = netUnitPrice(base, discountType, Number(discountValue));
        discountToStore = { type: discountType, value: Number(discountValue), pre: Math.round(base * 100) / 100 };
      }
    }

    const getCatalogDefaultPricing = async () => {
      const variantId = (existingItem as any).productVariantId;
      if (variantId) {
        const v = await ProductVariant.findById(variantId).lean();
        if (v) {
          return resolveStoredVariantPricing(v);
        }
      }
      return null;
    };

    if (resetToDefaultPrice) {
      const defaultPricing = await getCatalogDefaultPricing();
      if (defaultPricing) {
        data.unitPrice = mongoose.Types.Decimal128.fromString(defaultPricing.price.toFixed(2));
        data.priceWithoutTax = mongoose.Types.Decimal128.fromString(defaultPricing.priceWithoutTax.toFixed(2));
        data.taxAmount = mongoose.Types.Decimal128.fromString(defaultPricing.taxAmount.toFixed(2));
        data.taxPercent = mongoose.Types.Decimal128.fromString(defaultPricing.taxPercent.toFixed(2));
        data.isCustomPrice = false;
        data.originalUnitPrice = null;
      } else {
        const originalPriceNum = (existingItem as any).originalUnitPrice
          ? Number(String((existingItem as any).originalUnitPrice))
          : null;
        if (originalPriceNum !== null) {
          const existingTax = (existingItem as any)?.taxPercent;
          const taxPercent = existingTax ? Number(String(existingTax)) : 18;
          const { priceWithoutTax, taxAmount } = calculateFromTaxInclusivePrice(originalPriceNum, taxPercent);
          data.unitPrice = mongoose.Types.Decimal128.fromString(originalPriceNum.toFixed(2));
          data.priceWithoutTax = mongoose.Types.Decimal128.fromString(priceWithoutTax.toFixed(2));
          data.taxAmount = mongoose.Types.Decimal128.fromString(taxAmount.toFixed(2));
          data.isCustomPrice = false;
          data.originalUnitPrice = null;
        }
      }
    } else if (unitPrice !== undefined && Math.abs(unitPrice - currentUnitPrice) > 0.001) {
      const defaultPricing = await getCatalogDefaultPricing();
      const existingTax = (existingItem as any)?.taxPercent;
      const taxPercent = defaultPricing?.taxPercent ?? (existingTax ? Number(String(existingTax)) : 18);
      const { priceWithoutTax, taxAmount } = calculateFromTaxInclusivePrice(unitPrice, taxPercent);
      data.unitPrice = mongoose.Types.Decimal128.fromString(unitPrice.toFixed(2));
      data.priceWithoutTax = mongoose.Types.Decimal128.fromString(priceWithoutTax.toFixed(2));
      data.taxAmount = mongoose.Types.Decimal128.fromString(taxAmount.toFixed(2));

      const catalogPrice =
        defaultPricing?.price ??
        ((existingItem as any).originalUnitPrice
          ? Number(String((existingItem as any).originalUnitPrice))
          : Number(String((existingItem as any).unitPrice || 0)));

      if (Math.abs(unitPrice - catalogPrice) > 0.001) {
        // A custom unit price overrides the catalogue price: Company Owner and Admin only. Putting the catalogue price
        // back is not an override, so anyone who may edit the quotation can do that.
        if (discountType === undefined && !canOverrideItemPrice(role)) {
          throw new ApiError("FORBIDDEN", "Only the Company Owner or an Admin can set a custom unit price.");
        }
        if (discountType === undefined) auditAction = "item_price_overridden";
        data.isCustomPrice = true;
        data.originalUnitPrice = mongoose.Types.Decimal128.fromString(catalogPrice.toFixed(2));
      } else {
        if (discountType === undefined && (existingItem as any).isCustomPrice) auditAction = "item_price_reset";
        data.isCustomPrice = false;
        data.originalUnitPrice = null;
      }
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
        const variantPricing = resolveStoredVariantPricing(match);
        data.unitPrice = mongoose.Types.Decimal128.fromString(variantPricing.price.toFixed(2));
        data.priceWithoutTax = mongoose.Types.Decimal128.fromString(variantPricing.priceWithoutTax.toFixed(2));
        data.taxAmount = mongoose.Types.Decimal128.fromString(variantPricing.taxAmount.toFixed(2));
        data.taxPercent = mongoose.Types.Decimal128.fromString(variantPricing.taxPercent.toFixed(2));
        data.isCustomPrice = false;
        data.originalUnitPrice = null;

        const tierLbl = formatTierLabel(match.automationTier);
        const finishLbl = formatFinishLabel(match.surfaceFinish);
        data.variantLabel =
          tierLbl || finishLbl
            ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
            : parsed.variantLabel ?? (match.config ? Object.values(match.config).filter(Boolean).join(" + ") : null);

        data.variantConfig = parsed.variantConfig ?? match.config ?? null;
      }
    }

    // Any other way of changing the price (a custom price, back to the catalogue price, another product or variant)
    // ends a per-product discount: it no longer explains the price.
    if (discountToStore !== undefined) {
      data.discountType = discountToStore?.type ?? null;
      data.discountValue = discountToStore?.value ?? null;
      data.preDiscountUnitPrice = discountToStore ? mongoose.Types.Decimal128.fromString(discountToStore.pre.toFixed(2)) : null;
    } else if (
      intactItemDiscount(storedItemPrice(existingItem)) &&
      (requestedUnitPrice !== undefined || resetToDefaultPrice || parsed.productId !== undefined || parsed.productVariantId !== undefined)
    ) {
      data.discountType = null;
      data.discountValue = null;
      data.preDiscountUnitPrice = null;
    }

    if (discountToStore !== undefined) {
      auditAction = discountToStore ? "item_discount_applied" : (intactItemDiscount(storedItemPrice(existingItem)) ? "item_discount_removed" : null);
    } else if (resetToDefaultPrice && (existingItem as any).isCustomPrice) {
      auditAction = "item_price_reset";
    }

    await QuotationItem.findByIdAndUpdate(itId, { $set: data });

    if (auditAction) {
      const before = storedItemPrice(existingItem);
      const after = Number(String(data.unitPrice ?? before.unitPrice));
      const product = await Product.findById((existingItem as unknown as { productId: number }).productId).select("name code").lean<{ name?: string; code?: string | null }>();
      await recordQuotationEvent({
        quotationId,
        action: auditAction,
        performedBy: userId,
        previousValue: { itemId: itId, unitPrice: before.unitPrice, discountType: intactItemDiscount(before)?.type ?? null, discountValue: intactItemDiscount(before)?.value ?? null },
        newValue: {
          itemId: itId,
          unitPrice: after,
          discountType: discountToStore === undefined ? null : discountToStore?.type ?? null,
          discountValue: discountToStore === undefined ? null : discountToStore?.value ?? null,
        },
        metadata: { productName: product?.name ?? null, productCode: product?.code ?? null, quantity: (existingItem as unknown as { quantity?: number }).quantity ?? null, role, actingAsCompany },
      });
    }

    // Response-only populate: just the fields the editor/proposal/PDF render
    // for this item (see `AGENTS.md`/Phase 3 audit and
    // `QuotationItemVariantSummary` in `@/types`) — never the catalog's full
    // variant list.
    const item = await QuotationItem.findById(itId)
      .populate({
        path: "product",
        select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes specs",
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

    const quotation = await Quotation.findById(quotationId).select("_id status revision dealerId assignedSalesId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    assertQuotationEditable(quotation);
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
