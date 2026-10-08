import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, RoomType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createQuotationRoomSchema, parseQuotationId } from "@/lib/validation/quotation";
import { normalizeQuotationRoom } from "@/lib/quotationNormalization";
import { canModifyQuotation } from "@/lib/quotationAccess";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: adding rooms to a quotation is a business operation. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();
    const quotation = await Quotation.findById(quotationId).select("_id status dealerId").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError(
        "FORBIDDEN",
        `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`
      );
    }

    if (!canModifyQuotation(role, userId, quotation)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const body = createQuotationRoomSchema.parse(await readJsonBody(req));

    let roomTypeId: number | null = body.roomTypeId ?? null;
    if (roomTypeId) {
      const roomType = await RoomType.findById(roomTypeId, { name: 1 }).lean();
      if (!roomType) {
        throw new ApiError("NOT_FOUND", "Room type not found.", { field: "roomTypeId" });
      }
      // Bathroom-like rooms are a business rule, not an error: the room is
      // created as a custom (untyped) space instead of being rejected.
      if (isBathroomLikeRoomName(roomType.name)) {
        roomTypeId = null;
      }
    }

    const nextRoomId = await getNextSequence("quotationRoom", QuotationRoom);

    await QuotationRoom.create({
      _id: nextRoomId,
      quotationId,
      roomTypeId,
      customName: body.customName ?? null,
      subArea: body.subArea ?? null,
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 0,
    });

    const populatedRoom = await QuotationRoom.findById(nextRoomId)
      .populate({ path: "roomType" })
      .populate({ path: "items" });

    // See the matching comment on the items routes: `normalizeQuotationRoom`
    // spreads its input, so a live Mongoose Document must be converted with
    // `.toObject()` first or its internal bookkeeping leaks into the response.
    const plainRoom = populatedRoom?.toObject ? populatedRoom.toObject() : populatedRoom;
    return apiSuccess(normalizeQuotationRoom(plainRoom), { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/rooms" });
  }
}
