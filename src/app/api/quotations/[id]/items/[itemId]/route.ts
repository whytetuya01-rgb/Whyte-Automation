import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationItem, QuotationRoom } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationItemSchema } from "@/lib/validation/quotation";
import { normalizeQuotationItem } from "@/lib/quotationNormalization";
import { redactQuotationItemForRole } from "@/lib/variantRedaction";
import { calculateFromTaxInclusivePrice } from "@/lib/pricing";
import { canModifyQuotation } from "@/lib/quotationAccess";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

/** Session required: editing and removing items are business operations. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id, itemId } = await context.params;
    const quotationId = parseQuotationId(id);
    const itId = parseNumericId(itemId, "itemId");

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status dealerId").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError("FORBIDDEN", `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`);
    }
    if (!canModifyQuotation(role, userId, quotation)) {
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
    return apiSuccess(redactQuotationItemForRole(normalizeQuotationItem(plainItem), role));
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/quotations/[id]/items/[itemId]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id, itemId } = await context.params;
    const quotationId = parseQuotationId(id);
    const itId = parseNumericId(itemId, "itemId");

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status dealerId").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError("FORBIDDEN", `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`);
    }
    if (!canModifyQuotation(role, userId, quotation)) {
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

    await QuotationItem.findByIdAndDelete(itId);

    return apiSuccess({ id: itId, deleted: true });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/quotations/[id]/items/[itemId]" });
  }
}
