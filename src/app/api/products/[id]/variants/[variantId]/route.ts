import { connectMongoDB } from "@/lib/mongodb";
import { requirePermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { softDeleteVariant, syncProductPriceFromVariants } from "@/lib/variantDeletion";
import { actorFromSession } from "@/lib/softDelete/actor";

type RouteContext = { params: Promise<{ id: string; variantId: string }> };

/**
 * DELETE /api/products/[id]/variants/[variantId]
 *
 * Canonical product-scoped hard delete. Delegates to the shared flow in
 * `@/lib/variantDeletion` so the guarantees are identical to
 * DELETE /api/product-variants/[id]:
 *
 *   400 INVALID_ID         → the ids are not valid numbers
 *   401 UNAUTHORIZED       → no admin session
 *   404 NOT_FOUND          → the variant does not exist (checked first)
 *   409 DEPENDENCY_EXISTS  → a quotation item references the variant
 *   409 MINIMUM_VARIANT    → it is the product's last remaining variant
 *   200 { success: true, data: {...} }
 *
 * The parent Product is never modified and the Edit Variants modal stays
 * usable; only Product.price is re-derived.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    // Variant deletion is guarded by catalog:delete capability.
    const authSession = await requirePermission("catalog:delete");
    const actor = actorFromSession(authSession);
    await connectMongoDB();

    const { id, variantId } = await context.params;
    const productId = parseNumericId(id, "product id");
    const varId = parseNumericId(variantId, "variant id");

    const result = await softDeleteVariant({
      variantId: varId,
      productId,
      actor,
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
