import { NextResponse } from "next/server";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";
import { exportCatalogue } from "@/lib/catalogImportService";
import { XLSX_MIME } from "@/lib/catalogSheetXlsx";

export const dynamic = "force-dynamic";

/** GET /api/catalog/export — the whole catalogue as an Excel file, one row per variant, in the import's own columns. */
export async function GET() {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      requireActiveCompany(actor);
      const file = await exportCatalogue(true);
      const day = new Date().toISOString().slice(0, 10);
      return new NextResponse(new Uint8Array(file), {
        status: 200,
        headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="catalogue-${day}.xlsx"`, "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/export" });
  }
}
