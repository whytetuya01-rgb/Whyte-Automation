import { connectMongoDB } from "@/lib/mongodb";
import { Lead, Customer, CrmActivity, Quotation, AdminUser } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateLeadSchema } from "@/lib/validation/crm";
import { assertValidLeadAssignees, assertValidReferrer, crmVisibilityFilter, recordCrmActivity, resolveLeadReferences } from "@/lib/crmService";
import { withRequiredTransaction } from "@/lib/transaction";
import { kickCalendarSync } from "@/lib/googleCalendar/kick";
import { applyLeadFormFollowUp } from "@/lib/followUpService";
import { notifyLeadAssigned } from "@/lib/leadAssignmentService";

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
        .populate({ path: "referrer", select: "name customerType companyName phone" })
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
 *
 * The follow-up (`nextFollowUpAt`, `followUpOwnerId`) is changed together with the lead, its task and its timeline entry
 * in one transaction. A request that does not mention `nextFollowUpAt` leaves the follow-up alone; `null` removes it.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId, timeZone }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to update leads.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const current = await Lead.findOne({ _id: id, companyId, ...visibility });
      if (!current) {
        throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      }

      const body = await readJsonBody(req);
      const input = updateLeadSchema.parse(body);
      // The date schema turns a missing field into null, so whether the request mentioned it is read from the request itself.
      const mentionsFollowUpDate = typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, "nextFollowUpAt");

      await assertValidLeadAssignees({
        companyId,
        dealerId: role !== "dealer" && input.dealerId !== current.dealerId ? input.dealerId : null,
        assignedSalesId: input.assignedSalesId !== current.assignedSalesId ? input.assignedSalesId : null,
      });

      const newSource = input.sourceId && input.sourceId !== current.sourceId
        ? await resolveLeadReferences({ companyId, role, userId, sourceId: input.sourceId })
        : null;

      await withRequiredTransaction(async (session) => {
        const lead = await Lead.findOne({ _id: id, companyId, ...visibility }).session(session ?? null);
        if (!lead) {
          throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
        }

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
        const salesReassigned = input.assignedSalesId !== undefined && input.assignedSalesId !== lead.assignedSalesId;
        if (salesReassigned) {
          changes.push(`Sales representative reassigned`);
          lead.assignedSalesId = input.assignedSalesId ?? null;
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
        if (input.probability !== undefined && input.probability !== (lead.probability ?? null)) {
          lead.probability = input.probability;
          changes.push(input.probability === null ? "Win probability reset to the stage default" : `Win probability set to ${input.probability}%`);
        }
        if (input.referrerId !== undefined && input.referrerId !== (lead.referrerId ?? null)) {
          if (input.referrerId !== null) {
            await assertValidReferrer({ companyId, role, userId, referrerId: input.referrerId, customerId: lead.customerId });
          }
          lead.referrerId = input.referrerId;
          changes.push(input.referrerId === null ? "Referring contact removed" : "Referring contact changed");
        }
        if (input.tags !== undefined && input.tags.join("\u0000") !== (lead.tags ?? []).join("\u0000")) {
          lead.tags = input.tags;
          changes.push(input.tags.length ? `Tags set to ${input.tags.join(", ")}` : "Tags cleared");
        }
        if (input.lostReason !== undefined) {
          lead.lostReason = input.lostReason;
        }

        await applyLeadFormFollowUp({ actor: { userId, role, permissions, companyId, timeZone }, session }, lead, {
          nextFollowUpAt: mentionsFollowUpDate ? input.nextFollowUpAt : undefined,
          ownerId: input.followUpOwnerId,
        });

        lead.updatedAt = new Date();
        await lead.save({ session });

        if (salesReassigned && lead.assignedSalesId != null) {
          await notifyLeadAssigned({
            companyId,
            leadId: lead._id,
            referenceNumber: lead.referenceNumber,
            customerName: lead.customerName,
            assignedSalesId: lead.assignedSalesId,
            isReassignment: true,
            session,
          });
        }

        if (changes.length > 0) {
          await recordCrmActivity({
            companyId,
            leadId: lead._id,
            customerId: lead.customerId,
            type: "note",
            title: "Lead Updated",
            description: changes.join("; "),
            performedBy: userId,
            session,
          });
        }
      });

      kickCalendarSync();
      return apiSuccess({ id: current._id, updated: true });
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
