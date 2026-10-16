import { connectMongoDB } from "@/lib/mongodb";
import { Product } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { getProductDeletionImpact } from "@/lib/deletionImpact";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/deletion-impact
 *
 * Read-only preview of what DELETE /api/products/[id] would find, so the
 * confirm dialog can show real counts before the user commits — never a
 * client-guessed number. Same dependency logic the DELETE route re-checks
 * inside its transaction; this is a snapshot, not a reservation.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withPermission("catalog:delete", async () => {
      await connectMongoDB();
      const productId = parseNumericId((await context.params).id, "product id");

      const product = await Product.findById(productId).select("_id").lean();
      if (!product) {
        throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
      }

      return apiSuccess(await getProductDeletionImpact(productId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]/deletion-impact" });
  }
}
