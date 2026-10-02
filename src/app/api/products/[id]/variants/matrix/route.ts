import { connectMongoDB } from "@/lib/mongodb";
import { requireSession } from "@/lib/api-auth";
import { apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { loadProductVariantMatrix } from "@/lib/variantMatrix";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/variants/matrix
 *
 * The authoritative "Possible Variants" view used by the Edit Variants screen.
 * Returns EVERY valid combination from the product's category matrix, each
 * classified as:
 *
 *   active    -> a live ProductVariant exists (edit / delete)
 *   removed   -> hard-deleted, recorded in ProductVariantHistory (restore)
 *   not_added -> never added to this product (add)
 *
 * Nothing is created or modified by this read.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    await requireSession();

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const matrix = await loadProductVariantMatrix(productId);

    return apiSuccess({
      productId: matrix.productId,
      productName: matrix.productName,
      productCode: matrix.productCode,
      categoryId: matrix.categoryId,
      categoryName: matrix.categoryName,
      hasMatrix: matrix.hasMatrix,
      summary: matrix.snapshot.summary,
      rows: matrix.snapshot.rows,
      unsupportedVariants: matrix.snapshot.unsupportedVariants,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]/variants/matrix" });
  }
}
