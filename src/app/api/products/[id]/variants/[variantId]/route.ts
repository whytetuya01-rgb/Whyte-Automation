import { connectMongoDB } from "@/lib/mongodb";
import { requireSession } from "@/lib/api-auth";
import { apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { hardDeleteVariant, syncProductPriceFromVariants } from "@/lib/variantDeletion";

type RouteContext = { params: Promise<{ id: string; variantId: string }> };

/**
 * DELETE /api/products/[id]/variants/[variantId]
 *
 * Canonical product-scoped hard delete. Delegates to the shared flow in
 * `@/lib/variantDeletion` so the guarantees are identical to
 * DELETE /api/product-variants/[id]:
 *
 *   400 INVALID_ID         â†’ the ids are not valid numbers
 *   401 UNAUTHORIZED       â†’ no admin session
 *   404 NOT_FOUND          â†’ the variant does not exist (checked first)
 *   409 DEPENDENCY_EXISTS  â†’ a quotation item references the variant
 *   409 MINIMUM_VARIANT    â†’ it is the product's last remaining variant
 *   200 { success: true, data: {...} }
 *
 * The parent Product is never modified and the Edit Variants modal stays
 * usable; only Product.price is re-derived.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    // The session is kept so the delete audit field records the actor.
    const authSession = await requireSession();
    await connectMongoDB();

    const { id, variantId } = await context.params;
    const productId = parseNumericId(id, "product id");
    const varId = parseNumericId(variantId, "variant id");

    const result = await hardDeleteVariant({
      variantId: varId,
      productId,
      deletedBy: authSession.user?.email ?? null,
    });

    await syncProductPriceFromVariants(result.productId);

    return apiSuccess({
      message: `Variant '${result.variantLabel}' deleted successfully.`,
      variantId: result.variantId,
      productId: result.productId,
      remainingVariants: result.remainingVariants,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/products/[id]/variants/[variantId]" });
  }
}
