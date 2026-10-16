import { connectMongoDB } from "@/lib/mongodb";
import { RoomType } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { getRoomTypeDeletionImpact } from "@/lib/deletionImpact";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/room-types/[id]/deletion-impact — read-only preview, see products/[id]/deletion-impact. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    // Matches DELETE /api/room-types/[id], which is super_admin-only.
    return await withPermission("spaces:hard_delete", async () => {
      await connectMongoDB();
      const roomTypeId = parseNumericId((await context.params).id, "room type id");

      const roomType = await RoomType.findById(roomTypeId).select("_id").lean();
      if (!roomType) {
        throw new ApiError("NOT_FOUND", "Room type not found.", { field: "id" });
      }

      return apiSuccess(await getRoomTypeDeletionImpact(roomTypeId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/room-types/[id]/deletion-impact" });
  }
}
