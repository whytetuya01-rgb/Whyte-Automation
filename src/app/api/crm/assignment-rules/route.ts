import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, LeadSource } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateLeadAssignmentRuleSchema } from "@/lib/validation/crm";
import {
  getLeadAssignmentRule,
  updateLeadAssignmentRule,
} from "@/lib/leadAssignmentService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/assignment-rules
 * Fetches the company's lead assignment rules alongside active sales representatives and lead sources.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:read") && !hasPermission(role, permissions, "crm:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view CRM assignment rules.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      await connectMongoDB();

      const [rule, salesReps, sources] = await Promise.all([
        getLeadAssignmentRule(companyId),
        AdminUser.find({
          companyId,
          role: "sales_executive",
          isActive: { $ne: false },
        })
          .select("_id name firstName lastName email contactNumber")
          .sort({ name: 1 })
          .lean(),
        LeadSource.find({
          companyId,
          isActive: true,
        })
          .select("_id name sortOrder")
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
      ]);

      const formattedSalesReps = salesReps.map((u) => ({
        id: u._id,
        name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
        email: u.email,
        contactNumber: u.contactNumber,
      }));

      const formattedSources = sources.map((s) => ({
        id: s._id,
        name: s.name,
      }));

      return apiSuccess({
        rule,
        salesRepresentatives: formattedSalesReps,
        leadSources: formattedSources,
        canManage: hasPermission(role, permissions, "crm:manage"),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/assignment-rules" });
  }
}

/**
 * PUT /api/crm/assignment-rules
 * Updates the company's automatic lead assignment rule settings.
 */
export async function PUT(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to configure lead assignment rules.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      const body = await readJsonBody(req);
      const input = updateLeadAssignmentRuleSchema.parse(body);

      const updated = await updateLeadAssignmentRule({
        companyId,
        mode: input.mode,
        enabled: input.enabled,
        eligibleSalesIds: input.eligibleSalesIds,
        fallbackSalesId: input.fallbackSalesId ?? null,
        sourceMappings: input.sourceMappings,
        updatedBy: userId,
      });

      return apiSuccess({ rule: updated });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PUT /api/crm/assignment-rules" });
  }
}

