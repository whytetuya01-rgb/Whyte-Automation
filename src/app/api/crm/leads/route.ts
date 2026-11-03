import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createLeadSchema } from "@/lib/validation/crm";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam, parseIntQueryParam } from "@/lib/validation/common";
import { getNextLeadSequence } from "@/lib/counter";
import { withRequiredTransaction } from "@/lib/transaction";
import { kickCalendarSync } from "@/lib/googleCalendar/kick";
import { createLeadFollowUp } from "@/lib/followUpService";
import { assertValidLeadAssignees, crmVisibilityFilter, findCustomerByContact, phoneMatchRegex, recordCrmActivity, resolveLeadReferences, scopedQuery } from "@/lib/crmService";
import { determineLeadAssignee, notifyLeadAssigned } from "@/lib/leadAssignmentService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/leads — Paginated and filterable leads list.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view leads.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      await connectMongoDB();
      const { searchParams } = new URL(req.url);
      const pagination = parsePaginationParams(searchParams);
      const search = parseSearchQueryParam(searchParams, "search");
      const status = parseStringQueryParam(searchParams, "status", { max: 30 });
      const priority = parseStringQueryParam(searchParams, "priority", { max: 30 });
      const salesId = parseIntQueryParam(searchParams, "assignedSalesId");
      const dealerId = parseIntQueryParam(searchParams, "dealerId");
      const tag = parseStringQueryParam(searchParams, "tag", { max: 60 });

      // Visibility and every requested filter must all hold: a parameter can only narrow the result.
      const requested: Array<Record<string, unknown>> = [];
      if (status && status !== "all") requested.push({ status });
      if (priority && priority !== "all") requested.push({ priority });
      if (salesId) requested.push({ assignedSalesId: salesId });
      if (dealerId) requested.push({ dealerId });
      if (tag) requested.push({ tags: new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        requested.push({
          $or: [{ customerName: rx }, { referenceNumber: rx }, { phone: rx }, { email: rx }, { projectType: rx }, { location: rx }],
        });
      }
      const query = scopedQuery(companyId, crmVisibilityFilter({ role, userId }), requested);

      const total = await Lead.countDocuments(query);
      const leads = await Lead.find(query)
        .populate({ path: "assignedSales", select: "name firstName lastName email" })
        .populate({ path: "dealer", select: "name firstName lastName companyName" })
        .populate({ path: "convertedQuotation", select: "quotationNumber status" })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean();

      return apiSuccess(
        createPaginatedResponse(
          leads.map((l) => ({
            ...l,
            id: l._id,
          })),
          total,
          pagination
        )
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/leads" });
  }
}

/**
 * POST /api/crm/leads — Create a new lead.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId, timeZone }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to create leads.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createLeadSchema.parse(body);

      // Enforce assignment scoping: dealers can only assign to themselves
      const assignedDealerId = role === "dealer" ? userId : (input.dealerId ?? null);
      let assignedSalesId = input.assignedSalesId ?? null;
      let assignmentRuleUsed = "none";
      let assignedSalesName: string | null = null;

      if (assignedSalesId != null) {
        await assertValidLeadAssignees({ companyId, dealerId: assignedDealerId, assignedSalesId });
        assignmentRuleUsed = "explicit";
      } else {
        // Run automatic lead assignment if not explicitly chosen
        const assignment = await determineLeadAssignee(companyId, {
          sourceId: input.sourceId,
          explicitSalesId: null,
        });
        assignedSalesId = assignment.assignedSalesId;
        assignmentRuleUsed = assignment.ruleUsed;
        assignedSalesName = assignment.salesExecutiveName ?? null;
      }

      const references = await resolveLeadReferences({ companyId, role, userId, customerId: input.customerId, sourceId: input.sourceId });

      const createdOn = new Date();
      const year = createdOn.getFullYear();
      const seq = await getNextLeadSequence(year);
      const referenceNumber = `LD-${year}-${String(seq).padStart(4, "0")}`;
      const leadId = `ld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      // The source's own name is used when a source is chosen; free text only applies without one.
      const sourceName = input.sourceId ? references.sourceName : input.sourceName || null;

      if (input.followUpOwnerId != null && !input.nextFollowUpAt) {
        throw new ApiError("VALIDATION_ERROR", "Set a follow-up date before choosing its owner.", { field: "followUpOwnerId" });
      }

      // The lead, its follow-up task and the timeline entry are created together, or not at all.
      const newLead = await withRequiredTransaction(async (session) => {
        const [created] = await Lead.create(
          [
            {
              _id: leadId,
              referenceNumber,
              companyId,
              customerId: input.customerId ?? null,
              customerName: input.customerName,
              phone: input.phone ?? null,
              whatsapp: input.whatsapp ?? input.phone ?? null,
              email: input.email ?? null,
              siteAddress: input.siteAddress ?? null,
              location: input.location ?? null,
              projectType: input.projectType ?? null,
              estimatedBudget: input.estimatedBudget ?? null,
              expectedClosingDate: input.expectedClosingDate ?? null,
              sourceId: input.sourceId ?? null,
              sourceName,
              assignedSalesId,
              dealerId: assignedDealerId,
              description: input.description ?? null,
              status: input.status,
              priority: input.priority,
              notes: input.notes ?? null,
              tags: input.tags ?? [],
              nextFollowUpAt: input.nextFollowUpAt ?? null,
              createdBy: userId,
              createdAt: createdOn,
              updatedAt: createdOn,
            },
          ],
          { session }
        );

        if (input.nextFollowUpAt) {
          await createLeadFollowUp({ actor: { userId, role, permissions, companyId, timeZone }, session }, created, { dueAt: input.nextFollowUpAt, ownerId: input.followUpOwnerId });
        }

        // Record activity in CRM timeline
        await recordCrmActivity({
          companyId,
          leadId,
          customerId: input.customerId ?? null,
          type: "status_change",
          title: "Lead Created",
          description: `Lead ${referenceNumber} created for ${input.customerName}.`,
          performedBy: userId,
          session,
        });

        if (assignedSalesId != null) {
          let ruleDesc = `Lead assigned manually.`;
          if (assignmentRuleUsed === "round_robin") {
            ruleDesc = `Assigned${assignedSalesName ? ` to ${assignedSalesName}` : ""} via Round-Robin rule.`;
          } else if (assignmentRuleUsed === "least_open_leads") {
            ruleDesc = `Assigned${assignedSalesName ? ` to ${assignedSalesName}` : ""} via Least Open Leads rule.`;
          } else if (assignmentRuleUsed === "source_mapping") {
            ruleDesc = `Assigned${assignedSalesName ? ` to ${assignedSalesName}` : ""} via Source Mapping rule (${sourceName || "Source"}).`;
          } else if (assignmentRuleUsed === "fallback") {
            ruleDesc = `Assigned${assignedSalesName ? ` to ${assignedSalesName}` : ""} via Fallback owner rule.`;
          }

          await recordCrmActivity({
            companyId,
            leadId,
            customerId: input.customerId ?? null,
            type: "status_change",
            title: "Lead Assigned",
            description: ruleDesc,
            performedBy: userId,
            session,
          });

          await notifyLeadAssigned({
            companyId,
            leadId,
            referenceNumber,
            customerName: input.customerName,
            assignedSalesId,
            session,
          });
        }
        return created;
      });

      // Warn (never block) when the same person is already in the CRM: other open leads and the saved customer.
      const phoneMatch = phoneMatchRegex(input.phone) ?? (input.phone?.trim() || null);
      const sameContact = [
        ...(phoneMatch ? [{ phone: phoneMatch }] : []),
        ...(input.email ? [{ email: input.email.trim().toLowerCase() }] : []),
      ];
      const duplicateLeads = sameContact.length
        ? await Lead.find({ companyId, _id: { $ne: leadId }, status: { $nin: ["won", "lost"] }, $or: sameContact })
            .select("_id referenceNumber customerName status")
            .sort({ createdAt: 1 })
            .limit(5)
            .lean()
        : [];
      const existingCustomer = await findCustomerByContact(companyId, input.phone, input.email);

      if (input.nextFollowUpAt) kickCalendarSync();
      return apiSuccess(
        {
          id: newLead._id,
          referenceNumber: newLead.referenceNumber,
          possibleDuplicates: {
            leads: duplicateLeads.map((l) => ({ id: l._id, referenceNumber: l.referenceNumber, customerName: l.customerName, status: l.status })),
            customer: existingCustomer ? { id: existingCustomer._id, name: existingCustomer.name } : null,
          },
        },
        { status: 201 }
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads" });
  }
}
