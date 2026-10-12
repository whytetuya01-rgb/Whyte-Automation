import { connectMongoDB } from "@/lib/mongodb";
import { Category } from "@/models";
import { requirePermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { getCategoryDeletionImpact } from "@/lib/deletionImpact";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/categories/[id]/deletion-impact — read-only preview, see products/[id]/deletion-impact. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    await requirePermission("categories:manage");
    await connectMongoDB();
    const categoryId = parseNumericId((await context.params).id, "category id");

    const category = await Category.findById(categoryId).select("_id").lean();
    if (!category) {
      throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
    }

    return apiSuccess(await getCategoryDeletionImpact(categoryId));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/categories/[id]/deletion-impact" });
  }
}
