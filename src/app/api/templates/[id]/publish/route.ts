import { connectMongoDB } from "@/lib/mongodb";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { publishTemplateVersion } from "@/lib/templateService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/templates/[id]/publish
 * Creates an immutable version snapshot in QuotationTemplateVersion
 * and increments template.version.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId, role, userId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const isAuthorized = role === "super_admin" || role === "company_owner" || role === "admin";
      if (!isAuthorized) {
        throw new ApiError("FORBIDDEN", "Only company administrators can publish workflow templates.");
      }

      const { id } = await context.params;
      await connectMongoDB();

      const snapshot = await publishTemplateVersion(companyId, id, userId);
      return apiSuccess(snapshot, { status: 201 });
    });
  } catch (error: any) {
    return handleApiError(error, { logPrefix: "POST /api/templates/[id]/publish" });
  }
}
