import { connectMongoDB } from "@/lib/mongodb";
import { Customer } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parseIntQueryParam, parseSearchQueryParam } from "@/lib/validation/common";
import { crmVisibilityFilter, scopedQuery } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/** The most customers one lookup returns; typing narrows the list on the server. */
const CUSTOMER_LOOKUP_LIMIT = 100;

/**
 * GET /api/customers/lookup?search=&id=
 *
 * The customer picker on the quotation form: the customers the caller may link to a quotation, A to Z, each with only
 * the details the form fills in (name, mobile, WhatsApp, email, addresses, GSTIN, type) and, for roles that may assign
 * a quotation, the customer's salesperson and dealer ids so the form can pre-select them. No counts, no internal notes,
 * and no paging: one list of up to CUSTOMER_LOOKUP_LIMIT, narrowed by `search` (name, mobile or
 * email), or one customer by `id`.
 *
 * Who: anyone with `customers:read`, and Dealers, who have no CRM screens but may link their OWN customers (the ones
 * whose dealer is them) to their quotations. The same visibility rule as the CRM applies (`crmVisibilityFilter`: a
 * Dealer sees only customers where they are the dealer), always inside the caller's own company.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:read") && role !== "dealer") {
        throw new ApiError("FORBIDDEN", "You do not have permission to view customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const { searchParams } = new URL(req.url);
      const search = parseSearchQueryParam(searchParams, "search");
      const id = parseIntQueryParam(searchParams, "id");

      const requested: Array<Record<string, unknown>> = [];
      if (id) requested.push({ _id: id });
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        requested.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }] });
      }
      const query = scopedQuery(companyId, crmVisibilityFilter({ role, userId }), requested);

      const rows = await Customer.find(query)
        .select("name phone whatsapp email billingAddress siteAddress gstNumber customerType assignedSalesId dealerId")
        .collation({ locale: "en", strength: 2 })
        .sort({ name: 1, _id: 1 })
        .limit(CUSTOMER_LOOKUP_LIMIT + 1)
        .lean();

      const items = rows.slice(0, CUSTOMER_LOOKUP_LIMIT).map((c) => ({
        id: c._id,
        name: c.name,
        phone: c.phone ?? null,
        whatsapp: c.whatsapp ?? null,
        email: c.email ?? null,
        billingAddress: c.billingAddress ?? null,
        siteAddress: c.siteAddress ?? null,
        gstNumber: c.gstNumber ?? null,
        customerType: c.customerType,
        // A Dealer's own customers are all theirs: nothing to pre-select, and nothing more to tell them.
        ...(role === "dealer" ? {} : { assignedSalesId: c.assignedSalesId ?? null, dealerId: c.dealerId ?? null }),
      }));
      return apiSuccess({ items, truncated: rows.length > CUSTOMER_LOOKUP_LIMIT });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/customers/lookup" });
  }
}
