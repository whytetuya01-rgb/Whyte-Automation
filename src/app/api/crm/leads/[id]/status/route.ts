import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateLeadStatusSchema } from "@/lib/validation/crm";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/crm/leads/[id]/status — Updates a lead's pipeline status.
 * Used for drag-and-drop stage updates and drawer status dropdowns.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to update lead status.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const lead = await Lead.findOne({ _id: id, companyId, ...visibility });
      if (!lead) {
        throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      }

      const body = await readJsonBody(req);
      const input = updateLeadStatusSchema.parse(body);

      const oldStatus = lead.status;
      const newStatus = input.status;

      if (oldStatus === newStatus && !input.lostReason && !input.notes) {
        return apiSuccess({ id: lead._id, status: newStatus, unchanged: true });
      }

      lead.status = newStatus;
      if (newStatus === "won") {
        lead.wonAt = new Date();
        lead.lostAt = null;
        lead.lostReason = null;
      } else if (newStatus === "lost") {
        lead.lostAt = new Date();
        lead.wonAt = null;
        if (input.lostReason) lead.lostReason = input.lostReason;
      } else {
        lead.wonAt = null;
        lead.lostAt = null;
      }

      if (input.notes) {
        lead.notes = input.notes;
      }

      lead.updatedAt = new Date();
      await lead.save();

      // Log status transition to CRM activity timeline
      const statusTitle =
        newStatus === "won"
          ? "Deal Won 🎉"
          : newStatus === "lost"
          ? `Deal Lost (${input.lostReason || "No reason given"})`
          : `Status Changed to ${newStatus.toUpperCase()}`;

      await recordCrmActivity({
        companyId,
        leadId: lead._id,
        customerId: lead.customerId,
        type: "status_change",
        title: statusTitle,
        description: `Stage moved from "${oldStatus}" to "${newStatus}".`,
        performedBy: userId,
      });

      return apiSuccess({
        id: lead._id,
        status: lead.status,
        updatedAt: lead.updatedAt,
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/crm/leads/[id]/status" });
  }
}

