import { connectMongoDB } from "@/lib/mongodb";
import { requirePermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { loadProductVariantMatrix } from "@/lib/variantMatrix";
import { isPrivilegedRole } from "@/lib/variantRedaction";

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
    const session = await requirePermission("catalog:read");
    const role = (session.user as { role?: string }).role;
    const canViewCost = isPrivilegedRole(role, session.permissions);

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const matrix = await loadProductVariantMatrix(productId);

    const rows = canViewCost
      ? matrix.snapshot.rows
      : matrix.snapshot.rows.map((r: any) => {
          const sanitized = { ...r };
          delete sanitized.cost;
          delete sanitized.purchaseTaxPercent;
          return sanitized;
        });

    return apiSuccess({
      productId: matrix.productId,
      productName: matrix.productName,
      productCode: matrix.productCode,
      categoryId: matrix.categoryId,
      categoryName: matrix.categoryName,
      hasMatrix: matrix.hasMatrix,
      summary: matrix.snapshot.summary,
      rows,
      unsupportedVariants: matrix.snapshot.unsupportedVariants,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]/variants/matrix" });
  }
}
