import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseIntQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/my/leads
 *
 * The leads assigned to the signed-in Sales Executive, newest first, with only what a salesperson needs to follow up
 * (name, mobile, project, budget, stage, priority, next follow-up). Sales Executives have no CRM screens, so this is their
 * own narrow view: it filters on the session's user id and company, never on anything the client sends, and returns no
 * internal notes, costs or other people's records.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, companyId }) => {
      if (role !== "sales_executive") throw new ApiError("FORBIDDEN", "Only Sales Executives have a My Leads list.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const limit = parseIntQueryParam(new URL(req.url).searchParams, "limit", { defaultValue: 100, min: 1, max: 200 });
      const rows = await Lead.find({ companyId, assignedSalesId: userId })
        .select("referenceNumber customerName phone whatsapp projectType estimatedBudget status priority nextFollowUpAt expectedClosingDate createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit ?? 100)
        .lean();

      return apiSuccess({
        items: rows.map((lead) => ({
          id: lead._id,
          referenceNumber: lead.referenceNumber,
          customerName: lead.customerName,
          phone: lead.phone ?? null,
          whatsapp: lead.whatsapp ?? null,
          projectType: lead.projectType ?? null,
          estimatedBudget: lead.estimatedBudget ?? null,
          status: lead.status,
          priority: lead.priority,
          nextFollowUpAt: lead.nextFollowUpAt ?? null,
          expectedClosingDate: lead.expectedClosingDate ?? null,
          createdAt: lead.createdAt,
        })),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/my/leads" });
  }
}
