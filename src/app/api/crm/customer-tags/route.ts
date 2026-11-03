import { connectMongoDB } from "@/lib/mongodb";
import { Customer } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { crmVisibilityFilter, scopedQuery } from "@/lib/crmService";
import { countTags } from "@/lib/leadTags";

export const dynamic = "force-dynamic";

const TAG_LIST_LIMIT = 100;
const TAG_SCAN_LIMIT = 5000;

/**
 * GET /api/crm/customer-tags
 *
 * The tags in use on the contacts the caller may see, most used first, each with its count (ignoring case): the
 * suggestions in the contact form and the filter chips on the contacts list. Same visibility rule as the contacts
 * themselves, always inside the caller's own company.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view contact tags.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const query = scopedQuery(companyId, crmVisibilityFilter({ role, userId }), [{ "tags.0": { $exists: true } }]);
      const rows = await Customer.find(query).select("tags").sort({ createdAt: -1 }).limit(TAG_SCAN_LIMIT).lean();
      return apiSuccess({ tags: countTags(rows.map((row) => row.tags)).slice(0, TAG_LIST_LIMIT) });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/customer-tags" });
  }
}
