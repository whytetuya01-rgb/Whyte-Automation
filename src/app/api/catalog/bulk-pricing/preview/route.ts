import { connectMongoDB } from "@/lib/mongodb";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { previewBulkPrice } from "@/lib/bulkPricingService";
import { bulkPreviewSchema } from "@/lib/validation/bulkPricing";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/bulk-pricing/preview { scope, rule }
 *
 * Shows what a bulk price change would do (first 300 rows, totals, what would be skipped and why) and a checksum of the
 * prices it was worked out from. Changes nothing.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      requireActiveCompany(actor);
      const input = bulkPreviewSchema.parse(await readJsonBody(req));
      await connectMongoDB();
      return apiSuccess(await previewBulkPrice(input.scope, input.rule));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/bulk-pricing/preview" });
  }
}
