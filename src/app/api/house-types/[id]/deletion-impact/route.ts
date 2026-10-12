import { connectMongoDB } from "@/lib/mongodb";
import { HouseType } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { getHouseTypeDeletionImpact } from "@/lib/deletionImpact";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/house-types/[id]/deletion-impact — read-only preview, see products/[id]/deletion-impact. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    // Matches DELETE /api/house-types/[id], which is super_admin-only.
    await requireRole("super_admin");
    await connectMongoDB();
    const houseTypeId = parseNumericId((await context.params).id, "house type id");

    const houseType = await HouseType.findById(houseTypeId).select("_id").lean();
    if (!houseType) {
      throw new ApiError("NOT_FOUND", "House type not found.", { field: "id" });
    }

    return apiSuccess(await getHouseTypeDeletionImpact(houseTypeId));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/house-types/[id]/deletion-impact" });
  }
}
