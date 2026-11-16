import { connectMongoDB } from "@/lib/mongodb";
import { RoomType } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { updateRoomTypeSchema } from "@/lib/validation/catalog";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withPermission("spaces:manage", async () => {
    const { id } = await context.params;
    const roomTypeId = parseNumericId(id, "id");

    await connectMongoDB();

    const data = updateRoomTypeSchema.parse(await readJsonBody(req));
    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    // Duplicate check excludes the record being updated (case-insensitive)
    if (data.name) {
      const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const duplicate = await RoomType.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(data.name.trim())}$`, "i") },
        _id: { $ne: roomTypeId },
        isDeleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        throw new ApiError(
          "DUPLICATE_RECORD",
          `A room type named '${data.name}' already exists.`,
          { field: "name" }
        );
      }
    }

    const roomType = await RoomType.findByIdAndUpdate(roomTypeId, { $set: data }, { new: true });
    if (!roomType) {
      throw new ApiError("NOT_FOUND", "Room type not found.");
    }

    return apiSuccess(roomType);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/room-types/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withPermission("spaces:hard_delete", async ({ session }) => {
      const actor = actorFromSession(session);
      const { id } = await context.params;
      const roomTypeId = parseNumericId(id, "id");

      await connectMongoDB();

      const roomType = await RoomType.findById(roomTypeId).select("name").lean();
      if (!roomType) {
        throw new ApiError("NOT_FOUND", "Room type not found.");
      }

      // Soft delete always succeeds: existing house-type templates and
      // quotation rooms keep resolving it through historical-reference
      // lookups. It only stops being offered for NEW templates/quotation
      // rooms, enforced at those creation points.
      await softDeleteOne({
        model: RoomType,
        entityType: "roomType",
        id: roomTypeId,
        actor,
        label: roomType.name,
      });

      return apiSuccess({ id: roomTypeId, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/room-types/[id]" });
  }
}
