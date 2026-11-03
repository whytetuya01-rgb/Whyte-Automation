import { NextResponse } from "next/server";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";
import { importTemplate } from "@/lib/catalogImportService";
import { XLSX_MIME } from "@/lib/catalogSheetXlsx";

export const dynamic = "force-dynamic";

/** GET /api/catalog/import/template — an empty sheet with the import's columns, one example row and a help sheet. */
export async function GET() {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      requireActiveCompany(actor);
      return new NextResponse(new Uint8Array(await importTemplate()), {
        status: 200,
        headers: { "Content-Type": XLSX_MIME, "Content-Disposition": 'attachment; filename="catalogue-import-template.xlsx"', "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/import/template" });
  }
}
