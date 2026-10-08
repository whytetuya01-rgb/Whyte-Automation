import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { RoomType } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { ensureRoomTypesAndTemplatesSeeded } from "@/lib/seedRoomData";
import { requireRole, requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createRoomTypeSchema } from "@/lib/validation/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();

    await connectMongoDB();
    await ensureRoomTypesAndTemplatesSeeded();
    const roomTypes = await RoomType.find().sort({ sortOrder: 1 });
    const cleaned = roomTypes
      .map((doc) => (typeof doc.toJSON === "function" ? doc.toJSON() : doc))
      .filter((rt: { name?: string }) => !isBathroomLikeRoomName(rt.name));
    // GET responses stay unwrapped: the proposal builder reads this array directly.
    return NextResponse.json(cleaned);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/room-types" });
  }
}

export async function POST(req: Request) {
  try {
    // Catalog master data writes are restricted to Super Admin / Admin.
    await requireRole("super_admin", "admin");
    await connectMongoDB();

    const input = createRoomTypeSchema.parse(await readJsonBody(req));

    // RoomType master data has no unique index, so the same-level duplicate is
    // rejected here. Comparison is case-insensitive to match how the admin UI
    // presents room names.
    const existing = await RoomType.findOne({ name: input.name }).select("_id").lean();
    if (existing) {
      throw new ApiError("DUPLICATE_RECORD", `A room type named '${input.name}' already exists.`, {
        field: "name",
      });
    }

    const nextRoomTypeId = await getNextSequence("roomType", RoomType);
    const roomType = await RoomType.create({
      _id: nextRoomTypeId,
      name: input.name,
      icon: input.icon ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });

    return apiSuccess(roomType, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/room-types" });
  }
}
