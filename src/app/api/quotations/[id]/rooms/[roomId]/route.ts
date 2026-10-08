import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, RoomType } from "@/models";
import { withTransaction } from "@/lib/transaction";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { parseQuotationId, updateQuotationRoomSchema } from "@/lib/validation/quotation";
import { normalizeQuotationRoom } from "@/lib/quotationNormalization";
import { canModifyQuotation } from "@/lib/quotationAccess";

type RouteContext = { params: Promise<{ id: string; roomId: string }> };

/** Session required: editing and removing rooms are business operations. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id, roomId } = await context.params;
    const quotationId = parseQuotationId(id);
    const rId = parseNumericId(roomId, "roomId");

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

    const data = updateQuotationRoomSchema.parse(await readJsonBody(req));
    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    const existingRoom = await QuotationRoom.findOne({ _id: rId, quotationId }).select("_id").lean();
    if (!existingRoom) {
      throw new ApiError("NOT_FOUND", "Room not found for this quotation.");
    }

    if (data.roomTypeId) {
      const roomType = await RoomType.findById(data.roomTypeId, { name: 1 }).lean();
      if (!roomType) {
        throw new ApiError("NOT_FOUND", "Room type not found.", { field: "roomTypeId" });
      }
    }

    await QuotationRoom.findByIdAndUpdate(rId, { $set: data });

    // Response-only populate: just the fields the editor/proposal/PDF render
    // for an item's product (see `AGENTS.md`/Phase 3 audit) — never the
    // catalog's full variant list.
    const room = await QuotationRoom.findById(rId)
      .populate({ path: "roomType" })
      .populate({
        path: "items",
        populate: {
          path: "product",
          select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes",
        },
      });

    // See the matching comment on the items routes: `normalizeQuotationRoom`
    // spreads its input, so a live Mongoose Document must be converted with
    // `.toObject()` first or its internal bookkeeping leaks into the response.
    const plainRoom = room?.toObject ? room.toObject() : room;
    return apiSuccess(normalizeQuotationRoom(plainRoom));
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/quotations/[id]/rooms/[roomId]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id, roomId } = await context.params;
    const quotationId = parseQuotationId(id);
    const rId = parseNumericId(roomId, "roomId");

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

    const removed = await withTransaction(async (dbSession) => {
      const roomQuery = QuotationRoom.findOne({ _id: rId, quotationId });
      if (dbSession) roomQuery.session(dbSession);
      const existing = await roomQuery;

      if (!existing) {
        throw new ApiError("NOT_FOUND", "Room not found for this quotation.");
      }

      // Items cannot exist without their room, so they are removed with it.
      // The counts are reported back so the UI can explain what was dropped.
      const itemQuery = QuotationItem.deleteMany(
        { quotationRoomId: rId },
        dbSession ? { session: dbSession } : undefined
      );
      const itemResult = await itemQuery;

      if (dbSession) {
        await QuotationRoom.findByIdAndDelete(rId, { session: dbSession });
      } else {
        await QuotationRoom.findByIdAndDelete(rId);
      }

      return { items: itemResult.deletedCount ?? 0 };
    });

    return apiSuccess({ id: rId, deleted: true, ...removed });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/quotations/[id]/rooms/[roomId]" });
  }
}
