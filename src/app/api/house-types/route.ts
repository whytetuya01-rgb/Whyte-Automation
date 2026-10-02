import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { HouseType, HouseTypeRoomTemplate, RoomType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { ensureRoomTypesAndTemplatesSeeded } from "@/lib/seedRoomData";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createHouseTypeSchema } from "@/lib/validation/catalog";
import type { CreateHouseTypeInput } from "@/lib/validation/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();

    await connectMongoDB();
    await ensureRoomTypesAndTemplatesSeeded();
    const houseTypes = await HouseType.find()
      .sort({ sortOrder: 1 })
      .populate({
        path: "roomTemplate",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "roomType",
        },
      });

    const cleaned = houseTypes.map((htDoc) => {
      // `roomTemplate` is a Mongoose virtual, so it only exists on the JSON output.
      const ht = (
        typeof htDoc.toJSON === "function" ? htDoc.toJSON() : htDoc
      ) as unknown as Record<string, unknown>;
      const templates = Array.isArray(ht.roomTemplate) ? ht.roomTemplate : [];
      return {
        ...ht,
        // Bathroom-like rooms are intentionally hidden from the proposal builder.
        roomTemplate: templates.filter(
          (t: { roomType?: { name?: string } | null }) => !isBathroomLikeRoomName(t.roomType?.name)
        ),
      };
    });

    // GET responses stay unwrapped: the proposal builder reads this array directly.
    return NextResponse.json(cleaned);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/house-types" });
  }
}

/**
 * Resolves the requested room type ids against real RoomType rows and drops
 * bathroom-like rooms, so a client can never create a template for a room type
 * that does not exist.
 */
async function resolveRoomTemplateIds(
  rooms: Array<{ roomTypeId: number; defaultCount: number }>
): Promise<Array<{ roomTypeId: number; defaultCount: number }>> {
  const requestedIds = Array.from(new Set(rooms.map((room) => room.roomTypeId)));
  const roomTypes = await RoomType.find({ _id: { $in: requestedIds } }, { _id: 1, name: 1 }).lean();
  const allowedIds = new Set(
    roomTypes
      .filter((rt) => !isBathroomLikeRoomName(rt.name))
      .map((rt) => rt._id)
  );
  return rooms.filter((room) => allowedIds.has(room.roomTypeId));
}

export async function POST(req: Request) {
  try {
    await requireSession();
    await connectMongoDB();

    const input: CreateHouseTypeInput = createHouseTypeSchema.parse(await readJsonBody(req));
    const { rooms, ...houseTypeFields } = input;

    if (rooms && rooms.length > 0) {
      const knownCount = await RoomType.countDocuments({
        _id: { $in: Array.from(new Set(rooms.map((room) => room.roomTypeId))) },
      }).lean();
      if (knownCount === 0) {
        throw new ApiError("VALIDATION_ERROR", "None of the supplied room types exist.", {
          field: "rooms",
        });
      }
    }

    const createdHouseType = await withTransaction(async (dbSession) => {
      const nextHouseTypeId = await getNextSequence("houseType", HouseType, dbSession);
      const newHouseType = new HouseType({
        _id: nextHouseTypeId,
        name: houseTypeFields.name,
        description: houseTypeFields.description ?? null,
        isActive: houseTypeFields.isActive ?? true,
        sortOrder: houseTypeFields.sortOrder ?? 0,
      });

      if (dbSession) {
        await newHouseType.save({ session: dbSession });
      } else {
        await newHouseType.save();
      }

      if (rooms && rooms.length > 0) {
        const sanitizedRooms = await resolveRoomTemplateIds(rooms);
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
            houseTypeId: nextHouseTypeId,
            roomTypeId: room.roomTypeId,
            defaultCount: room.defaultCount,
            sortOrder: i,
          });
        }

        if (templateDocs.length > 0) {
          if (dbSession) {
            await HouseTypeRoomTemplate.insertMany(templateDocs, { session: dbSession });
          } else {
            await HouseTypeRoomTemplate.insertMany(templateDocs);
          }
        }
      }

      return newHouseType;
    });

    return apiSuccess(createdHouseType, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/house-types" });
  }
}
