import { connectMongoDB } from "@/lib/mongodb";
import { ProductVariant } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { getVariantDeletionImpact } from "@/lib/deletionImpact";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/product-variants/[id]/deletion-impact — read-only preview, see products/[id]/deletion-impact. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");
    await connectMongoDB();
    const variantId = parseNumericId((await context.params).id, "variant id");

    const variant = await ProductVariant.findById(variantId).select("_id").lean();
    if (!variant) {
      throw new ApiError("NOT_FOUND", "Variant not found.", { field: "id" });
    }

    return apiSuccess(await getVariantDeletionImpact(variantId));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/product-variants/[id]/deletion-impact" });
  }
}
