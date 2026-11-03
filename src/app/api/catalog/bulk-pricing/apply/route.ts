import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { applyBulkPrice } from "@/lib/bulkPricingService";
import { bulkApplySchema } from "@/lib/validation/bulkPricing";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/bulk-pricing/apply { scope, rule, checksum, note? }
 *
 * Applies a previewed price change. Refused with 409 if any price moved since the preview. Saves the new prices and their
 * history together or not at all. Only catalogue prices change: existing quotations keep the prices they were issued at.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const input = bulkApplySchema.parse(await readJsonBody(req));
      return apiSuccess(await applyBulkPrice({ scope: input.scope, rule: input.rule, checksum: input.checksum, note: input.note, actorId: actor.userId, companyId }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/bulk-pricing/apply" });
  }
}
