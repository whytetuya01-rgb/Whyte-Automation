import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { crmVisibilityFilter, scopedQuery } from "@/lib/crmService";
import { countTags } from "@/lib/leadTags";

export const dynamic = "force-dynamic";

/** The most tags one answer lists, and the most leads read to count them. */
const TAG_LIST_LIMIT = 100;
const TAG_SCAN_LIMIT = 5000;

/**
 * GET /api/crm/lead-tags
 *
 * The tags in use on the leads the caller may see, most used first, each with its lead count: the suggestions in the lead
 * form and the filter chips on the pipeline. Counted ignoring case. Same visibility rule as the leads themselves
 * (`crmVisibilityFilter`), always inside the caller's own company.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:read") && !hasPermission(role, permissions, "leads:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view lead tags.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const query = scopedQuery(companyId, crmVisibilityFilter({ role, userId }), [{ "tags.0": { $exists: true } }]);
      const rows = await Lead.find(query).select("tags").sort({ createdAt: -1 }).limit(TAG_SCAN_LIMIT).lean();
      return apiSuccess({ tags: countTags(rows.map((row) => row.tags)).slice(0, TAG_LIST_LIMIT) });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/lead-tags" });
  }
}
