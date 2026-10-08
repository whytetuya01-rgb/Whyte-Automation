import { connectMongoDB } from "@/lib/mongodb";
import { RoomType } from "@/models";
import { getRoomTypeDependencies } from "@/lib/dependencies";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { updateRoomTypeSchema } from "@/lib/validation/catalog";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");
    const { id } = await context.params;
    const roomTypeId = parseNumericId(id, "id");

    await connectMongoDB();

    const data = updateRoomTypeSchema.parse(await readJsonBody(req));
    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    // Duplicate check excludes the record being updated.
    if (data.name) {
      const duplicate = await RoomType.findOne({ name: data.name, _id: { $ne: roomTypeId } })
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
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/room-types/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");
    const { id } = await context.params;
    const roomTypeId = parseNumericId(id, "id");

    await connectMongoDB();

    const roomType = await RoomType.findById(roomTypeId).select("_id").lean();
    if (!roomType) {
      throw new ApiError("NOT_FOUND", "Room type not found.");
    }

    const dependencies = await getRoomTypeDependencies(roomTypeId);
    const blocking: Array<{ type: string; label: string; count: number }> = [];
    if (dependencies.houseTypeTemplates > 0) {
      blocking.push({
        type: "houseTypeTemplates",
        label: "house type template(s)",
        count: dependencies.houseTypeTemplates,
      });
    }
    if (dependencies.quotationRooms > 0) {
      blocking.push({
        type: "quotationRooms",
        label: "quotation room(s)",
        count: dependencies.quotationRooms,
      });
    }
    if (blocking.length > 0) {
      const summary = blocking
        .map((item) => `${item.count} ${item.label}`)
        .join(" and ");
      throw new ApiError(
        "DEPENDENCY_EXISTS",
        `Cannot delete room type: it is still used in ${summary}. Remove those references first.`,
        { dependencies: blocking }
      );
    }

    await RoomType.findByIdAndDelete(roomTypeId);

    return apiSuccess({ id: roomTypeId, deleted: true });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/room-types/[id]" });
  }
}
