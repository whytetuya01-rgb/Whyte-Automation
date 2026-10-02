import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationItem, QuotationRoom } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationItemSchema } from "@/lib/validation/quotation";

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
    if (role === "dealer" && quotation.dealerId !== userId) {
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
      data.unitPrice = mongoose.Types.Decimal128.fromString(unitPrice.toFixed(2));
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

    const item = await QuotationItem.findById(itId)
      .populate({
        path: "product",
        populate: { path: "variants", match: { isActive: true } },
      })
      .populate({ path: "productVariant" });

    return apiSuccess(item);
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
    if (role === "dealer" && quotation.dealerId !== userId) {
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
