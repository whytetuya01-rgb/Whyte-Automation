import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { revertBatch } from "@/lib/bulkPricingService";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/bulk-pricing/history/[batchId]/revert
 *
 * Puts the prices of a bulk change back. Only variants still at exactly the price that change gave them are restored; one
 * changed since is left alone. The undo is recorded as its own entry, and a change can be undone once.
 */
export async function POST(_req: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const { batchId } = await context.params;
      return apiSuccess(await revertBatch({ batchId, actorId: actor.userId, companyId }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/bulk-pricing/history/[batchId]/revert" });
  }
}
