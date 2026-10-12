import { connectMongoDB } from "@/lib/mongodb";
import { HouseType, HouseTypeRoomTemplate, RoomType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { requirePermission, requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { updateHouseTypeSchema } from "@/lib/validation/catalog";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    await requirePermission("spaces:manage");
    const { id } = await context.params;
    const houseTypeId = parseNumericId(id, "id");

    await connectMongoDB();

    const { rooms, ...data } = updateHouseTypeSchema.parse(await readJsonBody(req));

    if (Object.keys(data).length === 0 && rooms === undefined) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    const updatedHouseType = await withTransaction(async (dbSession) => {
      const updateQuery = HouseType.findByIdAndUpdate(houseTypeId, { $set: data }, { new: true });
      if (dbSession) updateQuery.session(dbSession);
      const houseType = await updateQuery;

      if (!houseType) {
        throw new ApiError("NOT_FOUND", "House type not found.");
      }

      if (rooms) {
        const requestedIds = Array.from(new Set(rooms.map((room) => room.roomTypeId)));
        const knownRoomTypes = await RoomType.find({ _id: { $in: requestedIds } }, { _id: 1, name: 1 })
          .session(dbSession ?? null)
          .lean();
        const allowedIds = new Set(
          knownRoomTypes
            .filter((rt) => !isBathroomLikeRoomName(rt.name))
            .map((rt) => rt._id)
        );
        const sanitizedRooms = rooms.filter((room) => allowedIds.has(room.roomTypeId));

        if (sanitizedRooms.length === 0) {
          throw new ApiError("VALIDATION_ERROR", "None of the supplied room types exist.", {
            field: "rooms",
          });
        }

        if (dbSession) {
          await HouseTypeRoomTemplate.deleteMany({ houseTypeId }, { session: dbSession });
        } else {
          await HouseTypeRoomTemplate.deleteMany({ houseTypeId });
        }

        const templateDocs = [];
        for (let i = 0; i < sanitizedRooms.length; i++) {
          const room = sanitizedRooms[i];
          const nextTemplateId = await getNextSequence(
            "houseTypeRoomTemplate",
            HouseTypeRoomTemplate,
            dbSession
          );
          templateDocs.push({
            _id: nextTemplateId,
            houseTypeId,
            roomTypeId: room.roomTypeId,
            defaultCount: room.defaultCount,
            sortOrder: i,
          });
        }

        if (dbSession) {
          await HouseTypeRoomTemplate.insertMany(templateDocs, { session: dbSession });
        } else {
          await HouseTypeRoomTemplate.insertMany(templateDocs);
        }
      }

      return houseType;
    });

    return apiSuccess(updatedHouseType);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/house-types/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await requirePermission("spaces:hard_delete");
    const actor = actorFromSession(session);
    const { id } = await context.params;
    const houseTypeId = parseNumericId(id, "id");

    await connectMongoDB();

    const houseType = await HouseType.findById(houseTypeId).select("name").lean();
    if (!houseType) {
      throw new ApiError("NOT_FOUND", "House type not found.");
    }

    // Soft delete always succeeds: its room templates and any quotation built
    // on it keep resolving through historical-reference lookups. It only
    // stops being offered for a NEW quotation or template, enforced there.
    await softDeleteOne({
      model: HouseType,
      entityType: "houseType",
      id: houseTypeId,
      actor,
      label: houseType.name,
    });

    return apiSuccess({ id: houseTypeId, deleted: true });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/house-types/[id]" });
  }
}
