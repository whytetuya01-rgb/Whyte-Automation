import { assertQuotationEditable } from "@/lib/quotationRevisionService";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, RoomType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createQuotationRoomSchema, parseQuotationId } from "@/lib/validation/quotation";
import { normalizeQuotationRoom } from "@/lib/quotationNormalization";
import { canModifyQuotation } from "@/lib/quotationAccess";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: adding rooms to a quotation is a business operation. */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();
    const quotation = await Quotation.findById(quotationId).select("_id status revision dealerId assignedSalesId createdBy").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }

    assertQuotationEditable(quotation);

    if (!canModifyQuotation(role, userId, quotation, permissions)) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const body = createQuotationRoomSchema.parse(await readJsonBody(req));

    let roomTypeId: number | null = body.roomTypeId ?? null;
    let roomTypeDoc: any = null;
    if (roomTypeId) {
      roomTypeDoc = await RoomType.findById(roomTypeId).lean();
      if (!roomTypeDoc) {
        throw new ApiError("NOT_FOUND", "Room type not found.", { field: "roomTypeId" });
      }
      // Bathroom-like rooms are a business rule, not an error: the room is
      // created as a custom (untyped) space instead of being rejected.
      if (isBathroomLikeRoomName(roomTypeDoc.name)) {
        roomTypeId = null;
        roomTypeDoc = null;
      }
    }

    const nextRoomId = await getNextSequence("quotationRoom", QuotationRoom);

    const createdRoom = await QuotationRoom.create({
      _id: nextRoomId,
      quotationId,
      roomTypeId,
      customName: body.customName ?? null,
      subArea: body.subArea ?? null,
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 0,
    });

    // In-memory response construction with pre-fetched roomType and empty items array
    // eliminates redundant findById and empty items population queries.
    const plainRoom = {
      ...(createdRoom?.toObject ? createdRoom.toObject() : createdRoom),
      roomType: roomTypeDoc,
      items: [],
    };
    return apiSuccess(normalizeQuotationRoom(plainRoom), { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/rooms" });
  }
}
