import { connectMongoDB } from "@/lib/mongodb";
import { CrmActivity } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createCrmActivitySchema } from "@/lib/validation/crm";
import { recordCrmActivity } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/activities — Query chronological activities for a lead or customer.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ companyId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const url = new URL(req.url);
      const leadId = url.searchParams.get("leadId");
      const customerId = url.searchParams.get("customerId");
      const quotationId = url.searchParams.get("quotationId");

      if (!leadId && !customerId && !quotationId) {
        throw new ApiError("VALIDATION_ERROR", "At least one of leadId, customerId, or quotationId is required.");
      }

      await connectMongoDB();
      const query: Record<string, unknown> = { companyId };
      if (leadId) query.leadId = leadId;
      if (customerId) query.customerId = Number(customerId);
      if (quotationId) query.quotationId = quotationId;

      const activities = await CrmActivity.find(query)
        .sort({ performedAt: -1 })
        .limit(100)
        .lean();

      return apiSuccess(activities.map((a) => ({ ...a, id: a._id })));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/activities" });
  }
}

/**
 * POST /api/crm/activities — Log a manual activity (call, WhatsApp, note, site visit, etc.).
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage") && !hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to log activities.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createCrmActivitySchema.parse(body);

      await recordCrmActivity({
        companyId,
        leadId: input.leadId ?? null,
        customerId: input.customerId ?? null,
        quotationId: input.quotationId ?? null,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
        performedBy: userId,
      });

      return apiSuccess({ success: true }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/activities" });
  }
}

