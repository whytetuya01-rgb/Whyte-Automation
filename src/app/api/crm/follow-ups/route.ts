import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { createPaginatedResponse, parsePaginationParams } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";
import { crmVisibilityFilter, scopedQuery } from "@/lib/crmService";
import { businessDayBounds, followUpBucket, followUpDayOffset } from "@/lib/followUps";

export const dynamic = "force-dynamic";

const VIEWS = ["all", "overdue", "today", "upcoming"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/**
 * GET /api/crm/follow-ups?view=all|overdue|today|upcoming&search=&priority=&page=&pageSize=
 *
 * The open leads (not won or lost) that have a next follow-up date, earliest first, limited to the leads the caller may
 * see in the CRM. Overdue / today / upcoming are decided by the Indian business day. `summary` always counts all three
 * (it ignores the search and priority filter) so the tabs can show their numbers. Default page size is 10.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:read")) throw new ApiError("FORBIDDEN", "You do not have permission to view follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { searchParams } = new URL(req.url);
      const view = (parseStringQueryParam(searchParams, "view", { max: 12, allowed: VIEWS }) ?? "all") as (typeof VIEWS)[number];
      const priority = parseStringQueryParam(searchParams, "priority", { max: 12, allowed: PRIORITIES });
      const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
      const pagination = parsePaginationParams(searchParams, { defaultPageSize: 10, maxPageSize: 100 });

      await connectMongoDB();
      const now = new Date();
      const { start, end } = businessDayBounds(now);
      const visibility = crmVisibilityFilter({ role, userId });
      const open = [{ status: { $nin: ["won", "lost"] } }];
      const range = (bucket: (typeof VIEWS)[number]): Record<string, unknown> =>
        bucket === "overdue" ? { nextFollowUpAt: { $ne: null, $lt: start } }
        : bucket === "today" ? { nextFollowUpAt: { $gte: start, $lt: end } }
        : bucket === "upcoming" ? { nextFollowUpAt: { $gte: end } }
        : { nextFollowUpAt: { $ne: null } };

      const filters: Array<Record<string, unknown>> = [...open, range(view)];
      if (priority) filters.push({ priority });
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filters.push({ $or: [{ customerName: rx }, { referenceNumber: rx }, { phone: rx }, { projectType: rx }] });
      }
      const query = scopedQuery(companyId, visibility, filters);
      const count = (bucket: (typeof VIEWS)[number]) => Lead.countDocuments(scopedQuery(companyId, visibility, [...open, range(bucket)]));

      const [total, leads, overdue, today, upcoming] = await Promise.all([
        Lead.countDocuments(query),
        Lead.find(query)
          .populate({ path: "assignedSales", select: "name firstName lastName email" })
          .sort({ nextFollowUpAt: 1, _id: 1 })
          .skip(pagination.skip)
          .limit(pagination.take)
          .lean(),
        count("overdue"),
        count("today"),
        count("upcoming"),
      ]);

      const data = leads.map((lead) => {
        const due = new Date(lead.nextFollowUpAt as Date);
        const owner = (lead as unknown as { assignedSales?: { name?: string; firstName?: string; lastName?: string; email?: string } | null }).assignedSales;
        return {
          id: String(lead._id),
          referenceNumber: lead.referenceNumber,
          customerName: lead.customerName,
          phone: lead.phone ?? null,
          whatsapp: lead.whatsapp ?? null,
          projectType: lead.projectType ?? null,
          location: lead.location ?? null,
          priority: lead.priority,
          status: lead.status,
          notes: lead.notes ? lead.notes.slice(0, 300) : null,
          nextFollowUpAt: due.toISOString(),
          lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : null,
          bucket: followUpBucket(due, now),
          dayOffset: followUpDayOffset(due, now),
          assignedSalesName: owner ? owner.name || `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null : null,
        };
      });

      return apiSuccess({ ...createPaginatedResponse(data, total, pagination), summary: { overdue, today, upcoming } });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/follow-ups" });
  }
}
