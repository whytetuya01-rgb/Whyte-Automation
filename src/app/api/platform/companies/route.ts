import { requireRole } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/platform/companies
 * Minimal company list (id, name, slug, status) for the Super Admin's
 * "act as company" selector. Super Admin only; read-only. `Company` is the
 * tenant record itself (not tenant-scoped), and soft-deleted companies are
 * excluded by the model's soft-delete plugin.
 */
export async function GET() {
  try {
    await requireRole("super_admin");
    await connectMongoDB();
    const companies = await Company.find({}).select("name slug status").sort({ _id: 1 }).lean();
    return apiSuccess(
      companies.map((c) => ({ id: c._id, name: c.name, slug: c.slug, status: c.status }))
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/platform/companies" });
  }
}
