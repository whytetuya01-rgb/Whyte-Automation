import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Category } from "@/models";
import { withSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";
import { buildCategoryRootMap, normalizeSeries, type CompanySeriesCatalog } from "@/lib/productSeries";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/series
 *
 * The caller's company's product series that the quotation document may show (enabled and "show on PDF"), plus a map
 * from every category to its top-level category so a quoted product can be matched to its series. Tenant-scoped
 * through the model: only the session's own company (or the company a Super Admin acts as). Platform context gets an
 * empty catalog. Read by everyone who can open a quotation (dealers included).
 */
export async function GET() {
  try {
    return await withSession(async ({ companyId }) => {
      const empty: CompanySeriesCatalog = { series: [], rootOf: {} };
      if (companyId === null) return NextResponse.json(empty);
      await connectMongoDB();
      const rows = await Category.find({}).select("name level parentId series sortOrder").sort({ sortOrder: 1 }).lean();
      const catalog: CompanySeriesCatalog = {
        series: rows
          .filter((row) => row.level === 1 && row.parentId === null)
          .map((row) => ({ id: Number(row._id), name: row.name, series: normalizeSeries(row.series) }))
          .filter((row) => row.series.enabled && row.series.showOnPdf)
          .map((row) => ({ id: row.id, name: row.name, description: row.series.description, imageUrl: row.series.imageUrl })),
        rootOf: buildCategoryRootMap(rows.map((row) => ({ id: Number(row._id), parentId: row.parentId ?? null }))),
      };
      return NextResponse.json(catalog);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/series" });
  }
}
