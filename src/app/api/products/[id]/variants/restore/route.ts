import { connectMongoDB } from "@/lib/mongodb";
import { requireRole } from "@/lib/api-auth";
import {
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { restoreVariantSchema } from "@/lib/validation/product";
import { serializeVariant } from "@/lib/productVariantService";
import { restoreVariantToProduct } from "@/lib/variantMatrix";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/products/[id]/variants/restore
 *
 * Restores a combination that was hard-deleted from this product and is
 * recorded in ProductVariantHistory.
 *
 *  - the automationTier / surfaceFinish combination is taken from the HISTORY
 *    row, never from the request body, and is re-validated against the
 *    product's CURRENT category matrix (so a combination that has since been
 *    removed from the category cannot come back)
 *  - the recreated ProductVariant gets a BRAND NEW numeric `_id`; the old id is
 *    never reused, so historical QuotationItems stay unambiguous
 *  - `variantCode` and `price` come from the request so the admin can adjust the
 *    prefilled history values before committing; both are validated and the code
 *    must be unique within the product
 *  - the history row is kept: the audit trail stays append-only
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const parsed = restoreVariantSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) throw parsed.error;

    const { historyId, variantCode, price } = parsed.data;

    const created = await restoreVariantToProduct({
      productId,
      historyId,
      variantCode,
      price,
    });

    return apiSuccess(
      {
        message: `Variant "${variantCode}" restored.`,
        variant: serializeVariant(created.toObject()),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/products/[id]/variants/restore" });
  }
}
