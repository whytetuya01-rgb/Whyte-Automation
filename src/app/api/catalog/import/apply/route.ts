import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { applyImport } from "@/lib/catalogImportService";
import { readXlsxUpload } from "@/lib/catalogUpload";
import { AdminUser } from "@/models";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/catalog/import/apply (multipart: file, planHash)
 *
 * Imports the same file that was previewed. Refused (409) if the file or the catalogue changed since the preview. A product with
 * any problem row is skipped entirely and reported; every other product is saved together or not at all. Nothing is ever deleted
 * and quotations already issued are untouched. Price changes are recorded in the price history and can be undone there.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const { buffer, fields } = await readXlsxUpload(req);
      const planHash = fields.get("planHash") ?? "";
      if (!/^[0-9a-f]{64}$/.test(planHash)) throw new ApiError("VALIDATION_ERROR", "Preview the file first, then import it.", { field: "planHash" });
      const user = await AdminUser.findById(actor.userId).select("name email").lean<{ name?: string; email?: string }>();
      return apiSuccess(await applyImport({ buffer, planHash, actorId: actor.userId, companyId, actorName: user?.name || user?.email || null }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/import/apply" });
  }
}
