import { connectMongoDB } from "@/lib/mongodb";
import { Lead, Customer, LeadSource } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createLeadSchema } from "@/lib/validation/crm";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam, parseIntQueryParam } from "@/lib/validation/common";
import { getNextLeadSequence } from "@/lib/counter";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";

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

      const query: Record<string, unknown> = {
        companyId,
        ...crmVisibilityFilter({ role, userId }),
      };

      if (status && status !== "all") query.status = status;
      if (priority && priority !== "all") query.priority = priority;
      if (salesId) query.assignedSalesId = salesId;
      if (dealerId) query.dealerId = dealerId;

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [
          { customerName: rx },
          { referenceNumber: rx },
          { phone: rx },
          { email: rx },
          { projectType: rx },
          { location: rx },
        ];
      }

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
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to create leads.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "Company context required.");
      }

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createLeadSchema.parse(body);

      const createdOn = new Date();
      const year = createdOn.getFullYear();
      const seq = await getNextLeadSequence(year);
      const referenceNumber = `LD-${year}-${String(seq).padStart(4, "0")}`;
      const leadId = `ld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      // Resolve source name if sourceId was passed
      let sourceName = input.sourceName || null;
      if (input.sourceId && !sourceName) {
        const src = await LeadSource.findById(input.sourceId).select("name").lean();
        if (src) sourceName = src.name;
      }

      // Enforce assignment scoping: dealers can only assign to themselves
      let assignedDealerId = input.dealerId ?? null;
      let assignedSalesId = input.assignedSalesId ?? null;
      if (role === "dealer") {
        assignedDealerId = userId;
      }

      const newLead = await Lead.create({
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
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        createdBy: userId,
        createdAt: createdOn,
        updatedAt: createdOn,
      });

      // Record activity in CRM timeline
      await recordCrmActivity({
        companyId,
        leadId,
        customerId: input.customerId ?? null,
        type: "status_change",
        title: "Lead Created",
        description: `Lead ${referenceNumber} created for ${input.customerName}.`,
        performedBy: userId,
      });

      return apiSuccess({ id: newLead._id, referenceNumber: newLead.referenceNumber }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads" });
  }
}
