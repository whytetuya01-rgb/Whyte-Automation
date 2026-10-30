import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { withSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";
import { loadCategorySpecSources } from "@/lib/categorySpecs";
import { normalizeSpecFields, type CategorySpecSource } from "@/lib/productSpecs";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/spec-fields
 *
 * The caller's company's categories with only the specification fields the quotation PDF shows (showOnPdf), so the
 * document can list a quoted product's specifications. Tenant-scoped through the model; platform context gets nothing.
 * Read by everyone who can open a quotation (dealers included).
 */
export async function GET() {
  try {
    return await withSession(async ({ companyId }) => {
      if (companyId === null) return NextResponse.json({ categories: [] });
      await connectMongoDB();
      const categories: CategorySpecSource[] = (await loadCategorySpecSources()).map((row) => ({
        ...row,
        specFields: normalizeSpecFields(row.specFields).filter((field) => field.showOnPdf),
      }));
      return NextResponse.json({ categories });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/spec-fields" });
  }
}
