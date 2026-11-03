import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { previewImport } from "@/lib/catalogImportService";
import { readXlsxUpload } from "@/lib/catalogUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/catalog/import/preview (multipart: file)
 *
 * Reads an Excel file and says what importing it would do: products and variants to create or update, price changes, and every
 * row that cannot be used (with its row and column). Changes nothing.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const { buffer } = await readXlsxUpload(req);
      return apiSuccess(await previewImport(buffer, companyId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/import/preview" });
  }
}
