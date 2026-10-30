import { connectMongoDB } from "@/lib/mongodb";
import { Customer, Quotation, Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createCustomerSchema } from "@/lib/validation/crm";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam, parseIntQueryParam } from "@/lib/validation/common";
import { getNextSequence } from "@/lib/counter";
import { assertValidLeadAssignees, crmVisibilityFilter, findCustomerByContact, isDuplicateKey, recordCrmActivity, scopedQuery, settleNewCustomer } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/customers — List & search customers.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const { searchParams } = new URL(req.url);
      const pagination = parsePaginationParams(searchParams);
      const search = parseSearchQueryParam(searchParams, "search");
      const customerType = parseStringQueryParam(searchParams, "customerType", { max: 30 });
      const salesId = parseIntQueryParam(searchParams, "assignedSalesId");
      const dealerId = parseIntQueryParam(searchParams, "dealerId");

      // Visibility and every requested filter must all hold: a parameter can only narrow the result.
      const requested: Array<Record<string, unknown>> = [];
      if (customerType && customerType !== "all") requested.push({ customerType });
      if (salesId) requested.push({ assignedSalesId: salesId });
      if (dealerId) requested.push({ dealerId });
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        requested.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }, { gstNumber: rx }, { billingAddress: rx }, { siteAddress: rx }] });
      }
      const query = scopedQuery(companyId, crmVisibilityFilter({ role, userId }), requested);

      const total = await Customer.countDocuments(query);
      const customers = await Customer.find(query)
        .populate({ path: "assignedSales", select: "name firstName lastName email" })
        .populate({ path: "dealer", select: "name firstName lastName companyName" })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean();

      // Enrich with linked quotations count
      const customerIds = customers.map((c) => c._id);
      const quotationCounts = await Quotation.aggregate<{ _id: number; count: number }>([
        { $match: { companyId, customerId: { $in: customerIds } } },
        { $group: { _id: "$customerId", count: { $sum: 1 } } },
      ]);
      const countsMap = new Map<number, number>();
      for (const item of quotationCounts) {
        if (item._id) countsMap.set(item._id, item.count);
      }

      return apiSuccess(
        createPaginatedResponse(
          customers.map((c) => ({
            ...c,
            id: c._id,
            quotationsCount: countsMap.get(c._id) || 0,
          })),
          total,
          pagination
        )
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/customers" });
  }
}

/**
 * POST /api/crm/customers — Create a central customer record.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to create customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createCustomerSchema.parse(body);

      // One customer per phone number (in any format) or email in this company
      const duplicateError = (existing: { name: string; email: string | null }) => {
        const sameEmail = Boolean(input.email) && existing.email === input.email?.toLowerCase();
        return new ApiError("CONFLICT", `A customer with this ${sameEmail ? "email" : "phone number"} already exists (${existing.name}).`, {
          field: sameEmail ? "email" : "phone",
        });
      };
      const existing = await findCustomerByContact(companyId, input.phone, input.email);
      if (existing) throw duplicateError(existing);

      // The assigned dealer and salesperson must be active people of this company.
      const dealerId = role === "dealer" ? userId : (input.dealerId ?? null);
      await assertValidLeadAssignees({ companyId, dealerId: role === "dealer" ? null : dealerId, assignedSalesId: input.assignedSalesId ?? null });

      const nextId = await getNextSequence("customer", Customer);
      let customer;
      try {
        customer = await Customer.create({
          _id: nextId,
          companyId,
          name: input.name,
          phone: input.phone ?? null,
          whatsapp: input.whatsapp ?? input.phone ?? null,
          email: input.email ?? null,
          billingAddress: input.billingAddress ?? null,
          siteAddress: input.siteAddress ?? null,
          gstNumber: input.gstNumber ?? null,
          customerType: input.customerType,
          assignedSalesId: input.assignedSalesId ?? null,
          dealerId,
          notes: input.notes ?? null,
          createdBy: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (error) {
        // The unique phone index refused this one: an identical request created the customer a moment earlier.
        // Answer with the controlled duplicate response, never the database's own error.
        if (!isDuplicateKey(error)) throw error;
        const winner = await findCustomerByContact(companyId, input.phone, input.email);
        throw duplicateError(winner ?? { name: "an existing customer", email: null });
      }

      // If an identical request got in first, only the older record is kept and this one is refused.
      const winnerId = await settleNewCustomer(companyId, customer._id, input.phone ?? null, input.email ?? null);
      if (winnerId !== null) {
        const winner = await findCustomerByContact(companyId, input.phone, input.email);
        throw duplicateError(winner ?? { name: "an existing customer", email: null });
      }

      await recordCrmActivity({
        companyId,
        customerId: customer._id,
        type: "note",
        title: "Customer Created",
        description: `Customer profile created for ${customer.name}.`,
        performedBy: userId,
      });

      return apiSuccess({ id: customer._id, name: customer.name }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/customers" });
  }
}
