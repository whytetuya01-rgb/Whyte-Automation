import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { HouseType, RoomType } from "@/models";
import { resolveRoomPresets } from "@/lib/roomPresetsFallback";
import { ensureRoomTypesAndTemplatesSeeded } from "@/lib/seedRoomData";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { parseIntQueryParam } from "@/lib/validation/common";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";
import type { HouseType as HouseTypeDto, HouseTypeRoomTemplate } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Guarded before the main try block on purpose: the catch below deliberately
  // answers with HTTP 200 fallback presets so the estimator keeps rendering when
  // Mongo is unavailable. A session check inside that try would be swallowed and
  // returned as a successful 200, which would be an authentication bypass.
  try {
    await requireSession();
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/room-presets" });
  }

  try {
    const url = new URL(req.url);
    // A malformed houseTypeId used to become NaN and was silently ignored.
    const houseTypeId = parseIntQueryParam(url.searchParams, "houseTypeId", { min: 1 }) ?? null;

    await connectMongoDB();

    // Ensure database has default room types & templates if empty
    try {
      await ensureRoomTypesAndTemplatesSeeded();
    } catch (seedErr) {
      console.warn("[room-presets] Seeding notice:", seedErr);
    }

    // Query active room types from DB
    const roomTypeDocs = await RoomType.find({ isActive: true }).sort({ sortOrder: 1 });
    const allRoomTypes = roomTypeDocs
      .map((doc) => {
        const rt = typeof doc.toJSON === "function" ? doc.toJSON() : doc;
        return {
          id: rt.id ?? rt._id,
          name: rt.name,
          icon: rt.icon ?? null,
          isActive: rt.isActive,
          sortOrder: rt.sortOrder ?? 0,
        };
      })
      .filter((rt) => !isBathroomLikeRoomName(rt.name));

    // If houseTypeId is provided, find that house type with populated room templates
    let selectedHouseType: HouseTypeDto | null = null;
    if (houseTypeId) {
      const htDoc = await HouseType.findOne({ _id: houseTypeId, isActive: true }).populate({
        path: "roomTemplate",
        options: { sort: { sortOrder: 1 } },
        populate: { path: "roomType" },
      });
      if (htDoc) {
        // `roomTemplate` is a Mongoose virtual, so it only exists on the JSON output.
        const ht = (
          typeof htDoc.toJSON === "function" ? htDoc.toJSON() : htDoc
        ) as unknown as Record<string, unknown>;
        const templates = Array.isArray(ht.roomTemplate) ? ht.roomTemplate : [];
        selectedHouseType = {
          ...(ht as unknown as Omit<HouseTypeDto, "id" | "roomTemplate">),
          id: (ht.id as number | undefined) ?? (ht._id as number),
          roomTemplate: templates.filter(
            (t: { roomType?: { name?: string } | null }) => !isBathroomLikeRoomName(t.roomType?.name)
          ) as HouseTypeRoomTemplate[],
        };
      }
    }

    // Resolve room presets using DB data + fallback layer
    const resolved = resolveRoomPresets({
      houseType: selectedHouseType,
      allRoomTypes,
    });

    return NextResponse.json({
      houseType: selectedHouseType
        ? { id: selectedHouseType.id, name: selectedHouseType.name }
        : null,      recommendedPresets: resolved.recommendedPresets,
      otherPresets: resolved.otherPresets,
      allPresets: resolved.allPresets,
    });
  } catch (error) {
    // Deliberate resilience: an infrastructure failure still returns usable
    // preset data. This is a data response, not an error response, so it is the
    // one place in the API that intentionally does not use the error envelope.
    // Authentication is handled above, outside this block.
    console.error("GET /api/room-presets error:", error);
    const fallbackResolved = resolveRoomPresets({});
    return NextResponse.json({
      houseType: null,
      recommendedPresets: [],
      otherPresets: fallbackResolved.allPresets,
      allPresets: fallbackResolved.allPresets,
    });
  }
}
