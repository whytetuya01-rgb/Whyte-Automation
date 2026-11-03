import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { batchEntries } from "@/lib/bulkPricingService";
import { parseIntQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/** GET /api/catalog/bulk-pricing/history/[batchId]?page= — one change and the before/after of each variant it moved. */
export async function GET(req: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      requireActiveCompany(actor);
      const { batchId } = await context.params;
      const page = parseIntQueryParam(new URL(req.url).searchParams, "page", { min: 1 }) ?? 1;
      return apiSuccess(await batchEntries(batchId, page));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/bulk-pricing/history/[batchId]" });
  }
}
