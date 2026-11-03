import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { listBatches, productPriceHistory } from "@/lib/bulkPricingService";
import { parseIntQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/bulk-pricing/history            the company's bulk price changes, newest first
 * GET /api/catalog/bulk-pricing/history?productId= the price history of one product's variants
 */
export async function GET(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      requireActiveCompany(actor);
      const params = new URL(req.url).searchParams;
      const productId = parseIntQueryParam(params, "productId", { min: 1 });
      if (productId) return apiSuccess({ entries: await productPriceHistory(productId) });
      return apiSuccess(await listBatches(parseIntQueryParam(params, "limit", { min: 1, max: 100 }) ?? 50, parseIntQueryParam(params, "skip", { min: 0 }) ?? 0));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/bulk-pricing/history" });
  }
}
