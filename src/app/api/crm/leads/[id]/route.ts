import { connectMongoDB } from "@/lib/mongodb";
import { Lead, Customer, CrmActivity, Quotation, AdminUser } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateLeadSchema } from "@/lib/validation/crm";
import { assertValidLeadAssignees, crmVisibilityFilter, recordCrmActivity, resolveLeadReferences } from "@/lib/crmService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/crm/leads/[id] — Single lead details with populated relations and timeline.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view leads.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const lead = await Lead.findOne({ _id: id, companyId, ...visibility })
        .populate({ path: "assignedSales", select: "name firstName lastName email contactNumber" })
        .populate({ path: "dealer", select: "name firstName lastName companyName contactNumber" })
        .populate({ path: "customer" })
        .populate({ path: "convertedQuotation", select: "quotationNumber status discountType discountValue" })
        .lean();

      if (!lead) {
        throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      }

      // Fetch chronological activity timeline for this lead
      const activities = await CrmActivity.find({ leadId: id, companyId })
        .sort({ performedAt: -1 })
        .limit(100)
        .lean();

      return apiSuccess({
        ...lead,
        id: lead._id,
        activities: activities.map((a) => ({ ...a, id: a._id })),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/leads/[id]" });
  }
}

/**
 * PATCH /api/crm/leads/[id] — Update lead fields.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to update leads.");
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
      const input = updateLeadSchema.parse(body);

      await assertValidLeadAssignees({
        companyId,
        dealerId: role !== "dealer" && input.dealerId !== lead.dealerId ? input.dealerId : null,
        assignedSalesId: input.assignedSalesId !== lead.assignedSalesId ? input.assignedSalesId : null,
      });

      const newSource = input.sourceId && input.sourceId !== lead.sourceId
        ? await resolveLeadReferences({ companyId, role, userId, sourceId: input.sourceId })
        : null;

      const changes: string[] = [];
      if (input.customerName && input.customerName !== lead.customerName) {
        changes.push(`Name changed to "${input.customerName}"`);
        lead.customerName = input.customerName;
      }
      if (input.phone !== undefined && input.phone !== lead.phone) {
        lead.phone = input.phone;
      }
      if (input.whatsapp !== undefined && input.whatsapp !== lead.whatsapp) {
        lead.whatsapp = input.whatsapp;
      }
      if (input.email !== undefined && input.email !== lead.email) {
        lead.email = input.email;
      }
      if (input.siteAddress !== undefined && input.siteAddress !== lead.siteAddress) {
        lead.siteAddress = input.siteAddress;
      }
      if (input.location !== undefined && input.location !== lead.location) {
        lead.location = input.location;
      }
      if (input.projectType !== undefined && input.projectType !== lead.projectType) {
        lead.projectType = input.projectType;
      }
      if (input.estimatedBudget !== undefined && input.estimatedBudget !== lead.estimatedBudget) {
        lead.estimatedBudget = input.estimatedBudget;
      }
      if (input.expectedClosingDate !== undefined) {
        lead.expectedClosingDate = input.expectedClosingDate;
      }
      if (input.sourceId !== undefined) {
        lead.sourceId = input.sourceId;
        if (input.sourceId === null) lead.sourceName = input.sourceName ?? null;
      }
      if (newSource) {
        lead.sourceName = newSource.sourceName;
      } else if (input.sourceName !== undefined && input.sourceId === undefined && !lead.sourceId) {
        lead.sourceName = input.sourceName;
      }
      if (input.assignedSalesId !== undefined && input.assignedSalesId !== lead.assignedSalesId) {
        changes.push(`Sales representative reassigned`);
        lead.assignedSalesId = input.assignedSalesId;
      }
      if (input.dealerId !== undefined && input.dealerId !== lead.dealerId && role !== "dealer") {
        changes.push(`Dealer reassigned`);
        lead.dealerId = input.dealerId;
      }
      if (input.description !== undefined) {
        lead.description = input.description;
      }
      if (input.priority !== undefined && input.priority !== lead.priority) {
        changes.push(`Priority changed to ${input.priority}`);
        lead.priority = input.priority;
      }
      if (input.notes !== undefined) {
        lead.notes = input.notes;
      }
      if (input.nextFollowUpAt !== undefined) {
        lead.nextFollowUpAt = input.nextFollowUpAt;
      }
      if (input.lostReason !== undefined) {
        lead.lostReason = input.lostReason;
      }

      lead.updatedAt = new Date();
      await lead.save();

      if (changes.length > 0) {
        await recordCrmActivity({
          companyId,
          leadId: lead._id,
          customerId: lead.customerId,
          type: "note",
          title: "Lead Updated",
          description: changes.join("; "),
          performedBy: userId,
        });
      }

      return apiSuccess({ id: lead._id, updated: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/crm/leads/[id]" });
  }
}

/**
 * DELETE /api/crm/leads/[id] — Soft-delete lead safely.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to delete leads.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const lead = await Lead.findOne({ _id: id, companyId, ...visibility });
      if (!lead) {
        throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      }

      await Lead.collection.updateOne(
        { _id: lead._id } as never,
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: userId,
            deletionReason: "Archived from CRM Leads",
          },
        }
      );

      await recordCrmActivity({
        companyId,
        leadId: lead._id,
        customerId: lead.customerId,
        type: "status_change",
        title: "Lead Archived",
        description: `Lead ${lead.referenceNumber} was archived.`,
        performedBy: userId,
      });

      return apiSuccess({ id: lead._id, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/crm/leads/[id]" });
  }
}
