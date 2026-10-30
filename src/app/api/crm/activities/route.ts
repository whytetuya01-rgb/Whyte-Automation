import { connectMongoDB } from "@/lib/mongodb";
import { CrmActivity, Customer, Lead, Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createCrmActivitySchema } from "@/lib/validation/crm";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";
import { canViewQuotation } from "@/lib/quotationAccess";

/**
 * Every activity belongs to a lead, customer and/or quotation. Anyone using it must be allowed to see each of those:
 * CRM records through the CRM visibility rules, the quotation through the normal quotation access rules.
 */
async function assertCanSee(
  actor: { role: string; userId: number; permissions: string[]; companyId: number },
  target: { leadId?: string | null; customerId?: number | null; quotationId?: string | null },
  mode: "read" | "write"
): Promise<void> {
  const { role, userId, permissions, companyId } = actor;
  const visibility = crmVisibilityFilter({ role, userId });
  if (target.leadId) {
    if (!hasPermission(role, permissions, mode === "read" ? "leads:read" : "leads:manage")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to use lead activities.");
    }
    if (!(await Lead.exists({ _id: target.leadId, companyId, ...visibility }))) throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
  }
  if (target.customerId) {
    if (!hasPermission(role, permissions, mode === "read" ? "customers:read" : "customers:manage")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to use customer activities.");
    }
    if (!(await Customer.exists({ _id: target.customerId, companyId, ...visibility }))) throw new ApiError("NOT_FOUND", "Customer not found or access denied.");
  }
  if (target.quotationId) {
    const quotation = await Quotation.findById(target.quotationId).select("dealerId assignedSalesId createdBy").lean();
    if (!quotation || !canViewQuotation(role, userId, quotation, permissions)) throw new ApiError("NOT_FOUND", "Quotation not found or access denied.");
  }
}

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/activities — Query chronological activities for a lead or customer.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const url = new URL(req.url);
      const leadId = url.searchParams.get("leadId");
      const customerIdParam = url.searchParams.get("customerId");
      const quotationId = url.searchParams.get("quotationId");

      if (!leadId && !customerIdParam && !quotationId) {
        throw new ApiError("VALIDATION_ERROR", "At least one of leadId, customerId, or quotationId is required.");
      }
      const customerId = customerIdParam ? Number(customerIdParam) : null;
      if (customerIdParam && (!Number.isInteger(customerId) || (customerId as number) < 1)) {
        throw new ApiError("VALIDATION_ERROR", "customerId must be a positive whole number.", { field: "customerId" });
      }

      await connectMongoDB();
      await assertCanSee({ role, userId, permissions, companyId }, { leadId, customerId, quotationId }, "read");
      const query: Record<string, unknown> = { companyId };
      if (leadId) query.leadId = leadId;
      if (customerId) query.customerId = customerId;
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
      if (!input.leadId && !input.customerId && !input.quotationId) {
        throw new ApiError("VALIDATION_ERROR", "An activity must belong to a lead, a customer or a quotation.");
      }
      await assertCanSee({ role, userId, permissions, companyId }, input, "write");

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

