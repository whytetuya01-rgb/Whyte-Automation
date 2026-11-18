import { connectMongoDB } from "@/lib/mongodb";
import { QuotationTemplateVersion } from "@/models/QuotationTemplateVersion";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/templates/[id]/versions
 * Lists all immutable published versions of a quotation workflow template.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const { id } = await context.params;
      await connectMongoDB();

      const versions = await QuotationTemplateVersion.find({ companyId, templateId: id })
        .sort({ version: -1 })
        .lean({ virtuals: true });

      return apiSuccess(versions);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/templates/[id]/versions" });
  }
}
